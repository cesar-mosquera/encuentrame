import React from 'react';
import { Polygon, Circle, Marker, Popup } from 'react-leaflet';
import { isVehicleInsideCircle, isVehicleInsidePolygon } from '../../lib/mapLogic';
import { createZoneLabel } from './MapIcons';

const isInsideGeofence = (vehicle, geofence) => {
  if (!vehicle?.position || !geofence) return false;
  if (geofence.type === 'polygon') {
    const positions = geofence.positions || geofence.coordinates || [];
    return isVehicleInsidePolygon(vehicle.position, positions);
  }
  if (!geofence?.center) return false;
  return isVehicleInsideCircle(vehicle.position, geofence.center, Number(geofence.radius || 600));
};

const getGeofenceType = (geofence) => {
  if (geofence.mode) return geofence.mode;
  if (geofence.zoneType) return geofence.zoneType;
  const ruleStr = String(geofence.rule || '').toLowerCase();
  if (ruleStr.includes('prohibid') || ruleStr.includes('inside') || ruleStr.includes('ingreso no autoriz')) return 'forbidden';
  if (ruleStr.includes('entrada') || ruleStr.includes('ingreso')) return 'entry';
  if (ruleStr.includes('salida') || ruleStr.includes('egreso')) return 'exit';
  return 'allowed'; // Zona permitida por defecto
};

const isGeofenceBreach = (vehicle, geofence) => {
  if (!vehicle?.position || !geofence) return false;
  const inside = isInsideGeofence(vehicle, geofence);
  const type = getGeofenceType(geofence);

  switch (type) {
    case 'forbidden':
      return inside;
    case 'entry':
      return inside;
    case 'exit':
      return !inside;
    case 'allowed':
    default:
      return !inside;
  }
};

const getGeofenceStatusText = (geo, isBreach) => {
  if (!isBreach) return '';
  const type = getGeofenceType(geo);
  switch (type) {
    case 'forbidden':
      return ' · Intrusión: vehículo en zona prohibida';
    case 'entry':
      return ' · Entrada registrada';
    case 'exit':
      return ' · Salida registrada';
    case 'allowed':
    default:
      return ' · Intrusión: vehículo fuera de zona permitida';
  }
};

// La app tiene un sanitizer de color equivalente en map/MapIcons.js (sanitizeColorSafe).
// Este se mantiene local y sin export para no mezclar dos copias de la misma regla: las
// clases de color se terminaban de filtrando por rutas distintas según el componente.
const sanitizeColor = (color) => {
  if (typeof color !== 'string') return '#00E676';
  const trimmed = color.trim();
  if (/^#([0-9a-fA-F]{3}){1,2}$/.test(trimmed) || /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)$/.test(trimmed)) {
    return trimmed;
  }
  return '#00E676';
};

// Radio por defecto de una geocerca circular. Antes el circulo fantasma de colocacion
// usaba 300 m mientras que el resto de la app (lectura de la zona y popup) asumia 600 m,
// asi que el vehiculo se veia dentro del fantasma pero fuera de la geocerca guardada.
// Un unico valor evita que vuelvan a divergir.
const DEFAULT_GEOFENCE_RADIUS_M = 600;

export const MapGeofences = ({ geofences, selectedVehicle, pendingCenter }) => {
  return (
    <>
      {geofences.filter(geo => geo.active).map((geo) => {
        const isPolygon = geo.type === 'polygon' && geo.positions && geo.positions.length > 0;
        const isBreach = isGeofenceBreach(selectedVehicle, geo);
        const geoColor = sanitizeColor(isBreach ? '#ef5c72' : geo.color || '#00E676');

        if (isPolygon) {
          return (
            <React.Fragment key={geo.id}>
              <Polygon 
                positions={geo.positions} 
                className="geofence-polygon"
                pathOptions={{
                  color: geoColor,
                  fillColor: geoColor,
                  fillOpacity: 0.035,
                  weight: 1.2,
                  dashArray: '5, 7',
                  opacity: 0.75,
                }}
              >
                <Popup className="dark-popup">
                  <div className="text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: geoColor, boxShadow: `0 0 8px ${geoColor}` }}></span>
                      <span className="font-bold text-white">{geo.name}</span>
                    </div>
                    <p className="text-[11px] text-[#94A3B8]">Zona Delimitada Poligonal{getGeofenceStatusText(geo, isBreach)}</p>
                    <div className="mt-2 text-[10px] text-[#00E676] font-mono">Regla: {geo.rule || 'Supervision'}</div>
                  </div>
                </Popup>
              </Polygon>
              {geo.center && (
                <Marker position={geo.center} icon={createZoneLabel(geo.name, geoColor)} />
              )}
            </React.Fragment>
          );
        } else if (geo.center) {
          return (
            <React.Fragment key={geo.id}>
              <Circle 
                center={geo.center}
                radius={geo.radius || DEFAULT_GEOFENCE_RADIUS_M}
                pathOptions={{
                  color: geoColor,
                  fillColor: geoColor,
                  fillOpacity: 0.045,
                  weight: 1.5,
                  dashArray: '5, 6',
                  opacity: 0.8,
                }}
              >
                <Popup className="dark-popup">
                  <div className="text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: geoColor, boxShadow: `0 0 8px ${geoColor}` }}></span>
                      <span className="font-bold text-white">{geo.name}</span>
                    </div>
                    <p className="text-[11px] text-[#94A3B8]">Zona Circular - Radio: {geo.radius || DEFAULT_GEOFENCE_RADIUS_M}m{getGeofenceStatusText(geo, isBreach)}</p>
                    <div className="mt-2 text-[10px] text-[#00E676] font-mono">Regla: {geo.rule || 'Supervision'}</div>
                  </div>
                </Popup>
              </Circle>
              <Marker position={geo.center} icon={createZoneLabel(geo.name, geoColor)} />
            </React.Fragment>
          );
        }
        return null;
      })}

      {/* Temporary Ghost Circle when placing or confirming geofence */}
      {pendingCenter && (
        <Circle 
          center={pendingCenter}
          radius={DEFAULT_GEOFENCE_RADIUS_M}
          pathOptions={{
            color: '#38bdf8',
            fillColor: '#0284c7',
            fillOpacity: 0.15,
            weight: 1.5,
            dashArray: '4, 4',
          }}
        />
      )}
    </>
  );
};
