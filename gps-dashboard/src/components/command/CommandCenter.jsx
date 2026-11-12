import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
const MapArea = React.lazy(() => import('../MapArea'))
import TopBar from './TopBar'
import DetailPanel from './DetailPanel'
import FleetPanel from './FleetPanel'
import BottomBar from './BottomBar'
import OriginCard from './OriginCard'
import { useSimulatedFleet } from './useSimulatedFleet'
import { useRouteHistory } from '../../hooks'
import { normalizeEntity } from './normalize'
import { useDashboardContext } from '../../context/dashboard-context'
import { deleteVehicle } from '../../lib/vehicleActions'

const toMapShape = (e, original = null) => ({
  id: e.id,
  name: e.name,
  plate: e.plate,
  driver: e.driver || (e._kind === 'vehicle' ? 'Dispositivo GPS' : null),
  status: e.status || 'offline',
  speed: e.speed || 0,
  bearing: e.bearing || 0,
  battery: e.battery ?? 0,
  accuracy: e.accuracy ?? null,
  lastUpdate: e.lastUpdate || '--',
  position: e.position || null,
  historicalPosition: e.historicalPosition || e.position || null,
  route: e.route || [],
  controlState: original?.controlState,
})

const CommandCenter = () => {
  const { state, dispatch, data } = useDashboardContext();
  const { category, selectedEntity, flyToTrigger, isPlacingOnMap, pendingCenter, pendingGeofenceConfirm, userLocation, locateUserTrigger, isFollowingRoute, origin, alertFocusTrigger, routeFocusTrigger } = state;
  const { vehiclesList, devicesList, alerts, geofences, activeNetworkError, fleetLoading, vehiclesStale, devicesStale, vehiclesSyncTime, devicesSyncTime, hideEphemeral, refetchVehicles, refetchDevices, signOut } = data;

  const [baseLayer, setBaseLayer] = useState('dark')
  const [fleetOpen, setFleetOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [isDesktop, setIsDesktop] = useState(typeof window !== 'undefined' ? window.innerWidth >= 1280 : true)

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => setIsDesktop(window.innerWidth >= 1280)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const onSelectVehicle = (entity) => {
    if (!entity) return;
    dispatch({ type: 'SET_SELECTED_ENTITY', payload: { ...entity, controlState: undefined } });
    if (entity.position) {
      dispatch({ type: 'SET_FLY_TO', payload: { coords: entity.position, zoom: 16, timestamp: Date.now() } });
    }
  }
  
  const onSelectRef = useRef(onSelectVehicle)
  useEffect(() => {
    onSelectRef.current = onSelectVehicle
  }, [selectedEntity]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Flota consolidada (reales + simulados cuando hay poca data) ---
  const realFleet = useMemo(() => {
    const list =
      category === 'devices'
        ? devicesList.map((e) => ({ ...normalizeEntity(e), _kind: 'device' }))
        : category === 'vehicles'
          ? vehiclesList.map((e) => ({ ...normalizeEntity(e), _kind: 'vehicle' }))
          : [
              ...vehiclesList.map((e) => ({ ...normalizeEntity(e), _kind: 'vehicle' })),
              ...devicesList.map((e) => ({ ...normalizeEntity(e), _kind: 'device' })),
            ]

    const seen = new Set()
    return list.filter((e) => {
      if (seen.has(e.id)) return false
      seen.add(e.id)
      return true
    })
  }, [category, devicesList, vehiclesList])

  const simulated = useSimulatedFleet(realFleet.length)
  const combined = useMemo(() => [...realFleet, ...simulated.units], [realFleet, simulated.units])

  // --- Entidad activa ---
  const active = useMemo(() => {
    if (selectedEntity) return normalizeEntity(selectedEntity)
    return combined[0] || null
  }, [selectedEntity, combined])

  const activeOriginal = selectedEntity || null

  // Historial de ruta de la entidad activa (embebida o telemetría de gps_locations)
  const { route: historyRoute, loading: historyLoading } = useRouteHistory(active)

  // Auto-seleccionar la primera entidad cuando no hay ninguna
  useEffect(() => {
    if (active || combined.length === 0) return undefined
    onSelectRef.current(combined[0])
    return undefined
  }, [active, combined]) // eslint-disable-line react-hooks/exhaustive-deps/exhaustive-deps

  // Entidades para el mapa
  const mapEntities = useMemo(() => combined.map((e) => toMapShape(e)), [combined])
  const selectedVehicle = useMemo(() => (active ? toMapShape(active, activeOriginal) : null), [active, activeOriginal])

  const stats = useMemo(() => {
    const online = combined.filter((e) => e.status === 'active' || e.status === 'online').length
    return { total: combined.length, online, offline: combined.length - online }
  }, [combined])

  const handleSelectFromFleet = (entity) => {
    onSelectRef.current(entity)
    setFleetOpen(false)
    setDetailOpen(true)
  }

  const handleToggleRouteFollow = () => {
    const target = active?.position ? active : selectedEntity;
    if (!target?.position) {
      dispatch({ type: 'SET_FOLLOWING_ROUTE', payload: false });
      dispatch({ type: 'SET_OPERATION_MESSAGE', payload: 'Sin posición GPS para seguir' });
      return;
    }
    if (active?.position) onSelectRef.current(active)
    const next = !isFollowingRoute;
    dispatch({ type: 'SET_FOLLOWING_ROUTE', payload: next });
    if (next && !origin && !userLocation?.position) {
      dispatch({ type: 'SET_LOCATE_USER_TRIGGER', payload: { timestamp: Date.now(), coords: userLocation?.position } })
      dispatch({ type: 'SET_OPERATION_MESSAGE', payload: 'Punto de partida no definido: escribe tu calle o actívalo con tu ubicación GPS' });
    }
  }

  const handleDeleteEntity = async (entity) => {
    if (!entity) return
    if (entity?._mock) {
      simulated.removeUnit(entity.id)
      return
    }
    if (entity?._ephemeral) {
      hideEphemeral?.(entity.id)
      return
    }
    const kind = entity?._kind === 'vehicle' ? 'vehicle' : 'device'
    
    const result = await deleteVehicle(entity.id, kind)
    if (result.error) {
      dispatch({ type: 'SET_OPERATION_MESSAGE', payload: `No se pudo eliminar: ${result.error.message || 'Error desconocido'}` })
      return
    }
    dispatch({ type: 'SET_SELECTED_ENTITY', payload: null })
    if (kind === 'vehicle') {
      if (result.remote && refetchVehicles) await refetchVehicles();
      dispatch({ type: 'SET_LOCAL_VEHICLES', payload: state.localVehicles?.filter((v) => v.id !== entity.id) || [] })
    } else {
      if (result.remote && refetchDevices) await refetchDevices();
      hideEphemeral(entity.id)
    }
    dispatch({ type: 'SET_OPERATION_MESSAGE', payload: result.remote ? (kind === 'vehicle' ? 'Vehículo eliminado' : 'Dispositivo eliminado') : 'Eliminado del panel local' })
  }

  // useCallback: sin esto la prop cambia de identidad en cada render, lo que
  // rompe la memoización de MapArea y reinicia el watcher de posición del mapa
  // en cada cambio de estado del dashboard.
  const handleUserLocation = useCallback(
    (loc) => dispatch({ type: 'SET_USER_LOCATION', payload: loc }),
    [dispatch]
  )

  const handleCategoryChange = (next) => dispatch({ type: 'SET_CATEGORY', payload: next })

  const handleSelectAlert = (alert) => {
    if (Number.isFinite(alert.lat) && Number.isFinite(alert.lng)) {
      dispatch({ type: 'SET_FLY_TO', payload: { coords: [alert.lat, alert.lng], zoom: 16, timestamp: Date.now() } });
      dispatch({ type: 'SET_ALERT_FOCUS', payload: { id: alert.id, coords: [alert.lat, alert.lng], zoom: 16, timestamp: Date.now() } });
    }
    const relatedVehicle = vehiclesList.find((v) => v.id === alert.vehicleId);
    const relatedDevice = devicesList.find((d) => d.id === alert.vehicleId);

    if (relatedVehicle) {
      if (category !== 'vehicles' && category !== 'all') handleCategoryChange('vehicles');
      onSelectVehicle(relatedVehicle);
    } else if (relatedDevice) {
      if (category !== 'devices' && category !== 'all') handleCategoryChange('devices');
      onSelectVehicle(relatedDevice);
    }
  }

  const handleFocusRoute = () => {
    if (!active) return;
    const points = Array.isArray(historyRoute) ? historyRoute.filter(
      (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]))
    ) : [];
    if (points.length < 2) return;
    dispatch({ type: 'SET_ROUTE_FOCUS', payload: { route: points, timestamp: Date.now() } });
  }

  const lastSyncLabel = useMemo(() => {
    if (activeNetworkError) return 'Sin conexión (Desactualizado)';
    if ((category === 'vehicles' && vehiclesStale) || (category === 'devices' && devicesStale)) return 'Sin conexión (Desactualizado)';

    if (category === 'vehicles' && vehiclesSyncTime) {
      const date = new Date(vehiclesSyncTime);
      return `Act. ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    }
    if (category === 'devices' && devicesSyncTime) {
      const date = new Date(devicesSyncTime);
      return `Act. ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    }

    const lastUpdate = active?.lastUpdate;
    if (!lastUpdate || lastUpdate === '--') return 'Sin reporte';
    if (lastUpdate === 'En línea') return 'En línea';
    if (lastUpdate === 'Ahora') return 'Actualizado';
    return lastUpdate;
  }, [activeNetworkError, active?.lastUpdate, category, vehiclesStale, devicesStale, vehiclesSyncTime, devicesSyncTime]);

  const handleShareRoute = async () => {
    if (!active) return;
    const routeUrl = new URL(window.location.href);
    routeUrl.searchParams.set('vehicle', active.id);
    routeUrl.searchParams.set('category', category);
    routeUrl.searchParams.set('follow', '1');
    const shareData = {
      title: `Ubicación de ${active.name}`,
      text: `Ubicación GPS de ${active.name} (${active.plate || active.id})`,
      url: routeUrl.toString(),
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(shareData.url);
        dispatch({ type: 'SET_OPERATION_MESSAGE', payload: 'Enlace copiado' });
      }
    } catch (error) {
      if (error?.name !== 'AbortError') dispatch({ type: 'SET_OPERATION_MESSAGE', payload: 'No se pudo compartir' });
    }
  }

  return (
    <div className="reference-dashboard cmd-center relative h-full w-full overflow-hidden bg-[#0b0f19] text-slate-100">
      {/* Mapa de fondo a pantalla completa */}
      <div className="absolute inset-0 z-0">
        <React.Suspense fallback={<div className="w-full h-full bg-[#0b0f19]" />}>
        <MapArea
          category={category}
          vehicles={mapEntities}
          selectedVehicle={selectedVehicle}
          onSelectVehicle={onSelectVehicle}
          alerts={alerts}
          onSelectAlert={handleSelectAlert}
          geofences={geofences}
          isPlacingOnMap={isPlacingOnMap}
          pendingCenter={pendingGeofenceConfirm ? pendingGeofenceConfirm.center : (isPlacingOnMap ? pendingCenter : null)}
          onMapClick={(latlng) => {
            dispatch({ type: 'SET_PLACING_ON_MAP', payload: false });
            dispatch({ type: 'SET_PENDING_CENTER', payload: null });
            dispatch({ type: 'SET_GEOFENCE_RADIUS', payload: 300 });
            dispatch({ type: 'SET_PENDING_GEOFENCE_CONFIRM', payload: { center: latlng, name: 'Nueva geocerca' } });
          }}
          onMapHover={(latlng) => dispatch({ type: 'SET_PENDING_CENTER', payload: latlng })}
          isFollowingRoute={isFollowingRoute}
          onToggleRouteFollow={handleToggleRouteFollow}
          onShareRoute={handleShareRoute}
          userLocation={userLocation}
          origin={origin}
          onLocationChange={handleUserLocation}
          locateUserTrigger={locateUserTrigger}
          flyToTrigger={flyToTrigger}
          focusTrigger={alertFocusTrigger}
          routeFocusTrigger={routeFocusTrigger}
          baseLayer={baseLayer}
          onBaseLayerChange={setBaseLayer}
          hideControls
          hideSelectionBar
        />
        </React.Suspense>
      </div>

      {/* Grid HUD decorativo */}
      <div className="pointer-events-none absolute inset-0 z-[1] cmd-grid" />

      {/* Overlays */}
      <TopBar
        category={category}
        onCategoryChange={handleCategoryChange}
        stats={stats}
        alertsCount={(alerts || []).filter((a) => a.status !== 'resolved').length}
        onMenuClick={() => setFleetOpen(true)}
        onLogout={signOut}
        lastSyncLabel={lastSyncLabel}
      />

      {/* Tarjeta manual de punto de partida */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-[138px] sm:top-[146px] z-30 flex justify-center px-4 ${
          isPlacingOnMap ? 'hidden' : (fleetOpen || detailOpen ? (isDesktop ? '' : 'hidden') : '')
        }`}
      >
        <div className="pointer-events-auto">
          <OriginCard
            origin={origin}
            onSelectOrigin={(o) => dispatch({ type: 'SET_ORIGIN', payload: o })}
            onUseGps={() => dispatch({ type: 'SET_LOCATE_USER_TRIGGER', payload: { timestamp: Date.now(), coords: userLocation?.position } })}
            hasGps={Boolean(userLocation?.position)}
            isFollowingRoute={isFollowingRoute}
            onToggleFollow={handleToggleRouteFollow}
            hasTarget={Boolean(active?.position)}
          />
        </div>
      </div>

      {/* Panel izquierdo - Detalle (condicional render) */}
      {(isDesktop || (detailOpen && active)) && (
        <div className={`pointer-events-none absolute ${isDesktop ? 'left-4 top-[150px] bottom-36 xl:block hidden' : 'inset-x-0 top-[150px] bottom-36 mx-auto w-[94%] max-w-md'} z-[45]`}>
          <div className="pointer-events-auto max-h-full overflow-y-auto cmd-scroll">
            <div className={!isDesktop ? "relative rounded-2xl border border-cyan-500/25 bg-slate-900/90 p-3 shadow-[0_0_30px_rgba(6,182,212,0.25)] backdrop-blur-md" : ""}>
              {!isDesktop && (
                <button
                  type="button"
                  onClick={() => setDetailOpen(false)}
                  className="absolute -top-2.5 right-3 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-cyan-500/30 bg-slate-900 text-cyan-300 shadow-lg transition-all hover:bg-cyan-500/10"
                >
                  <span className="text-[13px] font-bold leading-none">×</span>
                </button>
              )}
              <DetailPanel
                entity={active}
                category={category}
                onToggleRouteFollow={handleToggleRouteFollow}
                isFollowingRoute={isFollowingRoute}
                onShareRoute={handleShareRoute}
                onDeleteEntity={handleDeleteEntity}
                onEditVehicle={(e) => dispatch({ type: 'SET_ENTITY_TO_EDIT', payload: e })}
                historyRoute={historyRoute}
                historyLoading={historyLoading}
                onFocusRoute={handleFocusRoute}
              />
            </div>
          </div>
        </div>
      )}

      {/* Panel derecho - Flota (condicional render) */}
      {(isDesktop || fleetOpen) && (
        <div className={`pointer-events-none absolute ${isDesktop ? 'right-4 top-[150px] bottom-36 hidden lg:block' : 'inset-0 z-50 lg:hidden'} z-20`}>
          {!isDesktop && <button type="button" className="pointer-events-auto absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setFleetOpen(false)} />}
          <div className={`pointer-events-auto max-h-full overflow-y-auto cmd-scroll ${!isDesktop ? 'absolute right-0 top-0 h-full max-h-[88vh] p-3' : ''}`}>
            <FleetPanel
              entities={combined}
              selectedId={active?.id}
              onSelectEntity={handleSelectFromFleet}
              onDeleteEntity={handleDeleteEntity}
              onResetDemos={simulated.resetDemos}
              userLocation={userLocation}
              onLocateUser={() => dispatch({ type: 'SET_LOCATE_USER_TRIGGER', payload: { timestamp: Date.now(), coords: userLocation?.position } })}
              onSetGeofence={() => { dispatch({ type: 'SET_PLACING_ON_MAP', payload: true }); dispatch({ type: 'SET_PENDING_CENTER', payload: null }); }}
              alerts={alerts}
              onSelectAlert={handleSelectAlert}
              isLoading={fleetLoading}
            />
          </div>
        </div>
      )}

      {/* Aviso al colocar geocerca */}
      {isPlacingOnMap && (
        <div className="absolute left-1/2 top-[150px] z-30 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[#f59e0b] bg-[#23200f]/90 px-4 py-2 text-[11px] font-bold text-[#fbbf24] shadow-[0_4px_20px_rgba(245,158,11,0.35)] backdrop-blur-md">
          Toca o haz clic en el mapa para ubicar la geocerca
          <button
            type="button"
            onClick={() => { dispatch({ type: 'SET_PLACING_ON_MAP', payload: false }); dispatch({ type: 'SET_PENDING_CENTER', payload: null }); }}
            className="rounded-full bg-[#f59e0b]/20 px-2.5 py-0.5 text-[9px] uppercase tracking-wider text-[#fcd34d] hover:bg-[#f59e0b]/30"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Barra inferior */}
      <BottomBar
        entity={active}
        onToggleRouteFollow={handleToggleRouteFollow}
        isFollowingRoute={isFollowingRoute}
        baseLayer={baseLayer}
        onBaseLayerChange={setBaseLayer}
        onShowDetail={() => setDetailOpen(true)}
      />
    </div>
  )
}

export default CommandCenter