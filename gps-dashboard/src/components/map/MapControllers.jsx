import React, { useEffect, useRef } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

export const MapController = () => {
  const map = useMap();
  
  useEffect(() => {
    let lastWidth = 0;
    let lastHeight = 0;
    let frameId = null;

    const handleResize = () => {
      const container = map.getContainer();
      const width = container.clientWidth;
      const height = container.clientHeight;

      if (width === lastWidth && height === lastHeight) return;

      lastWidth = width;
      lastHeight = height;
      if (frameId) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        map.invalidateSize({ animate: false, pan: false });
      });
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(map.getContainer());
    
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      resizeObserver.disconnect();
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [map]);

  return null;
};

export const MapFlyToHandler = ({ targetPosition, flyToTrigger }) => {
  const map = useMap();

  useEffect(() => {
    if (flyToTrigger && flyToTrigger.coords) {
      map.flyTo(flyToTrigger.coords, flyToTrigger.zoom || 16, {
        animate: true,
        duration: 1.5,
      });
    } else if (targetPosition) {
      map.flyTo(targetPosition, 16, {
        animate: true,
        duration: 1.2,
      });
    }
  }, [targetPosition, flyToTrigger, map]);

  return null;
};

export const AlertFocusHandler = ({ focusTrigger, markerRefs }) => {
  const map = useMap();

  useEffect(() => {
    if (!focusTrigger?.coords) return;
    map.flyTo(focusTrigger.coords, focusTrigger.zoom || 16, { animate: true, duration: 1 });
    
    let timerId;
    const marker = markerRefs.current[focusTrigger.id];
    if (marker) timerId = window.setTimeout(() => marker.openPopup(), 700);
    
    return () => {
      if (timerId) window.clearTimeout(timerId);
    };
  }, [focusTrigger, map, markerRefs]);

  return null;
};

export const RouteFocusHandler = ({ routeFocusTrigger }) => {
  const map = useMap();

  useEffect(() => {
    if (!routeFocusTrigger?.route || routeFocusTrigger.route.length < 2) return;
    const points = routeFocusTrigger.route.filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])));
    if (points.length < 2) return;
    const bounds = L.latLngBounds(points.map(([lat, lng]) => [Number(lat), Number(lng)]));
    map.fitBounds(bounds, { padding: [56, 56], maxZoom: 16 });
  }, [routeFocusTrigger, map]);

  return null;
};

export const MapClickHandler = ({ isPlacingOnMap, onMapClick, onMapHover }) => {
  const lastHoverRef = useRef(0);

  useMapEvents({
    click(e) {
      if (isPlacingOnMap && onMapClick) {
        onMapClick([e.latlng.lat, e.latlng.lng]);
      }
    },
    mousemove(e) {
      if (isPlacingOnMap && onMapHover) {
        const now = Date.now();
        if (now - lastHoverRef.current > 40) {
          lastHoverRef.current = now;
          onMapHover([e.latlng.lat, e.latlng.lng]);
        }
      }
    },
  });
  return null;
};

export const UserLocationTracker = ({ locateUserTrigger, onLocationChange }) => {
  const watchIdRef = useRef(null);

  useEffect(() => {
    if (!locateUserTrigger) return undefined;

    if (!navigator.geolocation) {
      onLocationChange?.({ error: 'Geolocalización no soportada en este navegador', code: 0 });
      return undefined;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        onLocationChange?.({
          position: [coords.latitude, coords.longitude],
          accuracy: coords.accuracy,
          speed: coords.speed,
        });
      },
      (error) => {
        let errorMsg = 'No se pudo obtener la ubicación GPS';
        if (error.code === error.PERMISSION_DENIED) {
          errorMsg = 'Permiso de ubicación denegado. Por favor concédelo en los ajustes.';
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          errorMsg = 'Señal GPS no disponible. Verifica que la ubicación esté activada.';
        } else if (error.code === error.TIMEOUT) {
          errorMsg = 'Tiempo de espera agotado buscando señal GPS.';
        }
        onLocationChange?.({ error: errorMsg, code: error.code });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 },
    );

    watchIdRef.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        onLocationChange?.({
          position: [coords.latitude, coords.longitude],
          accuracy: coords.accuracy,
          speed: coords.speed,
        });
      },
      (error) => {
        let errorMsg = 'No se pudo obtener la ubicación GPS';
        if (error.code === error.PERMISSION_DENIED) {
          errorMsg = 'Permiso de ubicación denegado. Por favor concédelo en los ajustes.';
        }
        onLocationChange?.({ error: errorMsg, code: error.code });
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 },
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [locateUserTrigger, onLocationChange]);

  return null;
};
