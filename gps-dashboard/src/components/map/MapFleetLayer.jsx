import React from 'react';
import { Marker, Tooltip, Popup, Circle } from 'react-leaflet';
import { sanitizeAccuracy, normalizeBattery } from '../../lib/queries';
import { createHeadingIcon, createHeroPinIcon, createFleetPinIcon, createAlertIncidentIcon } from './MapIcons';

export const MapFleetLayer = React.memo(({
  vehicles,
  category,
  selectedVehicle,
  onSelectVehicle,
  alerts,
  onSelectAlert,
  onToggleRouteFollow,
  isFollowingRoute,
  onShareRoute,
  routeColor,
  alertMarkerRefs,
  baseLayer,
}) => {
  const createVehicleEventHandlers = React.useCallback((v) => ({
    click: () => onSelectVehicle?.(v),
  }), [onSelectVehicle]);

  const createAlertEventHandlers = React.useCallback((alert) => ({
    click: () => onSelectAlert?.(alert),
  }), [onSelectAlert]);

  return (
    <>
      {/* Selected Primary Vehicle Pulsing Target Halo */}
      {selectedVehicle?.position && (
        <Circle 
          center={selectedVehicle.position}
          radius={80}
          pathOptions={{
            color: routeColor,
            fillColor: routeColor,
            fillOpacity: 0.12,
            weight: 1.5,
            dashArray: '4, 4',
          }}
        />
      )}

      {/* Fleet Vehicle Pins */}
      {vehicles.filter((v) => v.position || v.historicalPosition).map((v) => {
        const pos = v.position || v.historicalPosition;
        const isSelected = selectedVehicle?.id === v.id;
        const isOffline = !v.position;

        return (
          <React.Fragment key={v.id}>
            {!isOffline && v.bearing !== undefined && (
              <Marker position={pos} icon={createHeadingIcon(v.bearing)} interactive={false} />
            )}
            <Marker
              position={pos}
              icon={isSelected ? createHeroPinIcon(v.name, v.id, baseLayer) : createFleetPinIcon(isOffline ? 'offline' : v.status, baseLayer)}
              eventHandlers={createVehicleEventHandlers(v)}
            >
              {isOffline ? (
                <Tooltip direction="top" offset={[0, -18]} opacity={0.95}>
                  <span>Sin señal · última posición conocida · {v.lastUpdate || '--'}</span>
                </Tooltip>
              ) : (
                <Tooltip direction="top" offset={[0, -18]} opacity={0.95}>
                  <span>{v.speed || 0} km/h · precisión {sanitizeAccuracy(v.accuracy) !== null ? `${sanitizeAccuracy(v.accuracy)} m` : '--'} · {v.lastUpdate || 'sin reporte'}</span>
                </Tooltip>
              )}
            <Popup className="dark-popup">
              <div className="text-xs min-w-[170px]">
                <div className="flex items-center justify-between mb-1.5 pb-1.5 border-b border-white/10">
                  <span className="font-bold text-white text-sm">{v.name}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                    v.status === 'active' ? 'bg-[#00E676]/15 text-[#00E676]' : 
                    v.status === 'stopped' ? 'bg-amber-400/15 text-amber-400' : 'bg-rose-500/15 text-rose-400'
                  }`}>
                    {v.status === 'active' ? 'En ruta' : v.status === 'stopped' ? 'Detenido' : 'Offline'}
                  </span>
                </div>
                <div className="space-y-1 text-[11px] text-[#94A3B8]">
                  <p>Velocidad: <strong className="text-white font-mono">{v.speed} km/h</strong></p>
                  <p>Batería: <strong className="text-white font-mono">{normalizeBattery(v.battery)}%</strong></p>
                  {v.driver && <p>Conductor: <span className="text-white">{v.driver}</span></p>}
                  <p>{category === 'vehicles' ? 'Placa:' : 'ID:'} <span className="text-[#00E676] font-mono">{v.plate}</span></p>
                </div>
                {!isSelected ? (
                  <button
                    type="button"
                    onClick={() => onSelectVehicle?.(v)}
                    aria-label={`Seleccionar ${v.name || v.plate || v.id}`}
                    className="mt-3 w-full py-1.5 px-2 rounded-md bg-[#00E676]/20 hover:bg-[#00E676]/30 border border-[#00E676]/40 text-[#00E676] text-[10px] font-bold transition-colors"
                  >
                    Seleccionar {category === 'vehicles' ? 'moto' : 'dispositivo'}
                  </button>
                ) : (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => onToggleRouteFollow?.()}
                      aria-label={isFollowingRoute ? 'Dejar de seguir la ruta' : 'Seguir la ruta del dispositivo'}
                      className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2 py-1.5 text-[10px] font-bold text-cyan-200"
                    >
                      {isFollowingRoute ? 'Siguiendo' : 'Seguir ruta'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onShareRoute?.()}
                      aria-label="Compartir ubicación y ruta"
                      className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2 py-1.5 text-[10px] font-bold text-emerald-200"
                    >
                      Compartir
                    </button>
                  </div>
                )}
              </div>
            </Popup>
            </Marker>
          </React.Fragment>
        );
      })}

      {/* Active Incident Alarms on Map */}
      {alerts.filter(a => a.status !== 'resolved' && Number.isFinite(a.lat) && Number.isFinite(a.lng)).map((alert) => (
        <Marker
          key={alert.id}
          ref={(marker) => { if (marker) alertMarkerRefs.current[alert.id] = marker; }}
          position={[alert.lat, alert.lng]}
          icon={createAlertIncidentIcon(alert.severity)}
          eventHandlers={createAlertEventHandlers(alert)}
        >
          <Popup className="dark-popup">
            <div className="text-xs min-w-[190px]">
              <div className="flex items-center gap-2 mb-1.5 pb-1.5 border-b border-white/10">
                <span className="text-base">{alert.severity === 'critical' ? '!' : 'ALERTA'}</span>
                <div>
                  <span className="font-bold text-white text-xs block leading-tight">{alert.title}</span>
                  <span className="text-[10px] text-slate-400 font-mono">{alert.timestamp}</span>
                </div>
              </div>
              <p className="text-[11px] text-[#94A3B8] my-1 leading-snug">{alert.description}</p>
              <div className="text-[10px] text-[#00E676] font-mono mt-1 mb-2">
                {category === 'devices' ? 'Dispositivo' : 'Moto'}: {alert.vehicleName} - {alert.speed} km/h
              </div>
              <button
                onClick={() => onSelectAlert && onSelectAlert(alert)}
                aria-label={`Ver alerta: ${alert.title}`}
                className="w-full py-1.5 px-2 rounded-lg bg-[#00E676]/15 hover:bg-[#00E676]/25 border border-[#00E676]/40 text-[#00E676] text-[11px] font-bold transition-all shadow-[0_0_10px_rgba(0,240,255,0.2)]"
              >
                Ver alerta
              </button>
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
});
