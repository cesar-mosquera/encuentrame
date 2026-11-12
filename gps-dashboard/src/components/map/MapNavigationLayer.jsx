import React, { useEffect, useRef, useState } from 'react';
import { Polyline } from 'react-leaflet';
import { fetchDrivingRoute } from '../../lib/routing';

// Distancia minima que debe moverse el origen para recalcular contra OSRM.
const RECALC_MIN_MOVE_M = 25;
const RECALC_INTERVAL_MS = 20000;

const metersBetween = (a, b) => {
  if (!a || !b) return Infinity;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
};

export const MapNavigationLayer = ({
  isFollowingRoute,
  originPosition, // origin.position or userLocation.position
  targetPosition, // selectedVehicle.position
  followRoute = [], // active route ahead or projected path
  onNavStateChange,
}) => {
  // El estado guarda la sesion a la que pertenece cada ruta. Antes se vaciaba con
  // setNavRoute([]) dentro del efecto, lo que añadia un render en cascada y dejaba
  // dibujada la ruta del vehiculo anterior durante el frame en que la nueva peticion
  // aun no habia resuelto. Comparando la sesion en render, el cambio es inmediato.
  const sessionId = isFollowingRoute ? 1 : 0;
  const [routeState, setRouteState] = useState({ session: 0, coords: [] });

  const latestOriginRef = useRef(originPosition);
  const latestTargetRef = useRef(targetPosition);
  const onNavStateChangeRef = useRef(onNavStateChange);
  const lastRequestedOriginRef = useRef(null);

  // Keep refs updated to avoid re-triggering the interval effect
  useEffect(() => {
    latestOriginRef.current = originPosition;
    latestTargetRef.current = targetPosition;
    onNavStateChangeRef.current = onNavStateChange;
  }, [originPosition, targetPosition, onNavStateChange]);

  useEffect(() => {
    if (!isFollowingRoute) return undefined;

    let active = true;
    let controller = null;
    // Solo recalcula si el origen se movio lo suficiente. Con un tick de GPS cada
    // ~5 s, pedir ruta a OSRM cada 8 s agotaba su cuota y devolvia 429 en modo
    // seguimiento prolongado; ademas la ruta no cambia entre 20-25 m recorridos.
    let lastOrigin = null;

    const loadRoute = async () => {
      const originPos = latestOriginRef.current;
      const destination = latestTargetRef.current;
      if (!originPos || !destination) return;

      if (lastOrigin && metersBetween(lastOrigin, originPos) < RECALC_MIN_MOVE_M) return;

      if (controller) {
        controller.abort();
      }

      const ctrl = new AbortController();
      controller = ctrl;
      try {
        const result = await fetchDrivingRoute(originPos, destination, { signal: ctrl.signal });
        if (!active) return;
        if (result) {
          lastOrigin = originPos;
          lastRequestedOriginRef.current = originPos;
          setRouteState({ session: sessionId, coords: result.coords });
          if (onNavStateChangeRef.current) onNavStateChangeRef.current({ navRoute: result.coords, navMeta: { distanceM: result.distanceM, durationS: result.durationS }, navError: false });
        } else {
          setRouteState({ session: sessionId, coords: [] });
          if (onNavStateChangeRef.current) onNavStateChangeRef.current({ navRoute: [], navMeta: null, navError: true });
        }
      } catch (err) {
        if (!active) return;
        if (err.name === 'AbortError') return;
        setRouteState({ session: sessionId, coords: [] });
        if (onNavStateChangeRef.current) onNavStateChangeRef.current({ navRoute: [], navMeta: null, navError: true });
      }
    };

    // Initial load
    lastOrigin = null;
    lastRequestedOriginRef.current = null;
    loadRoute();

    // Recalcular conforme el dispositivo avanza, no por reloj.
    const interval = setInterval(loadRoute, RECALC_INTERVAL_MS);

    return () => {
      active = false;
      if (controller) controller.abort();
      clearInterval(interval);
    };
  }, [isFollowingRoute, sessionId]); // We ONLY depend on the follow session now!

  const navRoute = routeState.session === sessionId ? routeState.coords : [];

  return (
    <>
      {isFollowingRoute && navRoute.length >= 2 && (
        <>
          <Polyline
            positions={navRoute}
            className="route-follow"
            pathOptions={{ color: '#22d3ee', weight: 4.5, opacity: 0.95, dashArray: '8 12', lineCap: 'round', lineJoin: 'round' }}
          />
          <Polyline
            positions={navRoute}
            pathOptions={{ color: '#22d3ee', weight: 11, opacity: 0.18 }}
          />
        </>
      )}

      {isFollowingRoute && navRoute.length < 2 && followRoute.length >= 2 && (
        <>
          <Polyline
            positions={followRoute}
            className="route-follow"
            pathOptions={{ color: '#22d3ee', weight: 4.5, opacity: 0.95, dashArray: '8 12', lineCap: 'round', lineJoin: 'round' }}
          />
          <Polyline
            positions={followRoute}
            pathOptions={{ color: '#22d3ee', weight: 11, opacity: 0.18 }}
          />
        </>
      )}
    </>
  );
};