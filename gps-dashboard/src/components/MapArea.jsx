import React, { useRef, useState } from 'react';
import { MapContainer, TileLayer, Circle, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Plus, Minus, Crosshair, Navigation, Share2, Maximize, Layers } from 'lucide-react';
import { routeColorForSpeed, routeAhead, projectedPath } from '../lib/mapLogic';
import { sanitizeRoute } from '../lib/queries';
import { formatNavDistance, formatNavDuration } from '../lib/routing';
import { MapController, MapFlyToHandler, AlertFocusHandler, RouteFocusHandler, MapClickHandler, UserLocationTracker } from './map/MapControllers';
import { createUserLocationIcon, createOriginIcon } from './map/MapIcons';
import { MapGeofences } from './map/MapGeofences';
import { MapNavigationLayer } from './map/MapNavigationLayer';
import { MapRoutesLayer } from './map/MapRoutesLayer';
import { MapFleetLayer } from './map/MapFleetLayer';

const MapArea = ({ 
  category = 'devices', 
  vehicles = [], 
  selectedVehicle, 
  onSelectVehicle, 
  alerts = [],
  onSelectAlert,
  focusTrigger,
  geofences = [],
  isPlacingOnMap = false,
  pendingCenter = null,
  onMapClick,
  onMapHover,
  flyToTrigger,
  isFollowingRoute = false,
  onToggleRouteFollow,
  onShareRoute,
  isVehicleDetailOpen = false,
  userLocation = null,
  onLocationChange,
  locateUserTrigger,
  origin = null,
  baseLayer: baseLayerProp,
  onBaseLayerChange,
  hideControls = false,
  hideSelectionBar = false,
  routeFocusTrigger = null,
}) => {
  const mapRef = useRef(null);
  const alertMarkerRefs = useRef({});
  const [internalBaseLayer, setInternalBaseLayer] = useState('dark');
  const [navState, setNavState] = useState({ navRoute: [], navMeta: null, navError: false });
  const baseLayer = baseLayerProp ?? internalBaseLayer;
  
  const changeBaseLayer = (next) => {
    setInternalBaseLayer(next);
    if (onBaseLayerChange) onBaseLayerChange(next);
  };

  const defaultCenter = [-0.279758, -78.539656]; // Quicentro Sur, Quito, Ecuador
  const currentPinPosition = selectedVehicle?.position || defaultCenter;

  const handleZoomIn = () => {
    if (mapRef.current) mapRef.current.zoomIn();
  };

  const handleZoomOut = () => {
    if (mapRef.current) mapRef.current.zoomOut();
  };

  const handleRecenter = () => {
    if (mapRef.current && userLocation?.position) {
      mapRef.current.flyTo(userLocation.position, 16, { animate: true, duration: 1 });
    } else if (mapRef.current && selectedVehicle?.position) {
      mapRef.current.flyTo(selectedVehicle.position, 16, { animate: true, duration: 1 });
    }
  };

  const handleFitFleet = () => {
    const positions = vehicles.filter((vehicle) => vehicle.position).map((vehicle) => vehicle.position);
    if (mapRef.current && positions.length > 0) mapRef.current.fitBounds(L.latLngBounds(positions), { padding: [36, 36], maxZoom: 15 });
  };

  const routeColor = routeColorForSpeed(selectedVehicle?.speed);
  const activeRoute = selectedVehicle?.route ? sanitizeRoute(selectedVehicle.route) : [];
  
  const sourcePos = origin?.position || userLocation?.position;
  
  const followRoute = isFollowingRoute && selectedVehicle?.position
    ? (activeRoute.length >= 2
        ? routeAhead(selectedVehicle.position, activeRoute)
        : projectedPath(selectedVehicle.position, selectedVehicle.bearing || 0))
    : [];

  return (
    <div className="relative h-full min-h-0 min-w-0 w-full overflow-hidden rounded-[10px] bg-[#162126] select-none">
      <MapContainer 
        ref={mapRef}
        center={currentPinPosition} 
        zoom={15} 
        zoomControl={false}
        className={baseLayer === 'dark' ? 'w-full h-full z-0 cyber-tiles dark-mode' : 'w-full h-full z-0 cyber-tiles'}
        style={{ height: '100%', width: '100%' }}
      >
        <MapController />
        <MapFlyToHandler 
          targetPosition={isFollowingRoute ? selectedVehicle?.position : null}
          flyToTrigger={flyToTrigger} 
        />
        <AlertFocusHandler focusTrigger={focusTrigger} markerRefs={alertMarkerRefs} />
        <RouteFocusHandler routeFocusTrigger={routeFocusTrigger} />
        <UserLocationTracker locateUserTrigger={locateUserTrigger} onLocationChange={onLocationChange} />
        {locateUserTrigger && userLocation?.position && (
          <MapFlyToHandler targetPosition={userLocation.position} flyToTrigger={locateUserTrigger} />
        )}
        
        <TileLayer
          url={baseLayer === 'satellite'
            ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
            : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'}
          subdomains={[]}
          attribution={baseLayer === 'satellite'
            ? '&copy; Esri, Maxar, Earthstar Geographics'
            : '&copy; OpenStreetMap contributors'}
          maxZoom={21}
          maxNativeZoom={20}
          keepBuffer={6}
          updateWhenIdle={false}
          updateWhenZooming={true}
        />

        <MapClickHandler isPlacingOnMap={isPlacingOnMap} onMapClick={onMapClick} onMapHover={onMapHover} />

        {userLocation?.position && (
          <>
            <Circle
              center={userLocation.position}
              radius={userLocation.accuracy || 35}
              pathOptions={{ color: '#168ca4', fillColor: '#5ad6e7', fillOpacity: 0.14, weight: 1.5 }}
            />
            <Marker position={userLocation.position} icon={createUserLocationIcon()}>
              <Popup>Tu ubicación actual</Popup>
            </Marker>
          </>
        )}

        {origin?.position && !(userLocation && userLocation.position[0] === origin.position[0] && userLocation.position[1] === origin.position[1]) && (
          <Marker position={origin.position} icon={createOriginIcon()}>
            <Popup>
              <div className="font-bold">Punto de partida</div>
              <div className="text-[10px] text-slate-500">{origin.label}</div>
            </Popup>
          </Marker>
        )}

        <MapGeofences 
          geofences={geofences} 
          selectedVehicle={selectedVehicle} 
          pendingCenter={pendingCenter} 
        />

        <MapNavigationLayer 
          isFollowingRoute={isFollowingRoute}
          originPosition={sourcePos}
          targetPosition={selectedVehicle?.position}
          followRoute={followRoute}
          onNavStateChange={setNavState}
        />

        <MapRoutesLayer 
          activeRoute={activeRoute}
          routeColor={routeColor}
        />

        <MapFleetLayer 
          vehicles={vehicles}
          category={category}
          selectedVehicle={selectedVehicle}
          onSelectVehicle={onSelectVehicle}
          alerts={alerts}
          onSelectAlert={onSelectAlert}
          onToggleRouteFollow={onToggleRouteFollow}
          isFollowingRoute={isFollowingRoute}
          onShareRoute={onShareRoute}
          routeColor={routeColor}
          alertMarkerRefs={alertMarkerRefs}
          baseLayer={baseLayer}
        />

      </MapContainer>

      {selectedVehicle && !isVehicleDetailOpen && !hideSelectionBar && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 w-[90%] max-w-[400px] bg-[#0b1221]/95 backdrop-blur-xl border border-cyan-500/30 shadow-[0_10px_40px_rgba(0,0,0,0.6)] rounded-2xl p-4 flex flex-col gap-3 transition-all">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`w-3 h-3 rounded-full shadow-[0_0_10px_currentColor] ${selectedVehicle.status === 'active' ? 'bg-green-400 text-green-400' : selectedVehicle.status === 'stopped' ? 'bg-yellow-400 text-yellow-400' : 'bg-gray-400 text-gray-400'}`} />
              <div>
                <strong className="block text-white text-base leading-none mb-1">{selectedVehicle.name}</strong>
                <span className="text-cyan-300 text-xs font-mono">{selectedVehicle.plate || selectedVehicle.id} · {selectedVehicle.speed || 0} km/h</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2 w-full">
            <button
              type="button"
              onClick={onToggleRouteFollow}
              disabled={!selectedVehicle?.position}
              className={`flex-1 h-10 flex items-center justify-center gap-2 rounded-xl text-sm font-bold transition-all ${isFollowingRoute && selectedVehicle?.position ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50' : 'bg-[#162133] text-gray-300 border border-gray-600/50 hover:bg-[#1f2d44]'} ${!selectedVehicle?.position ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Navigation size={16} />
              {isFollowingRoute && selectedVehicle?.position ? 'Siguiendo' : 'Seguir'}
            </button>
            <button 
              type="button" 
              onClick={onShareRoute} 
              className="flex-1 h-10 flex items-center justify-center gap-2 rounded-xl bg-[#162133] text-gray-300 border border-gray-600/50 hover:bg-[#1f2d44] text-sm font-bold transition-all"
            >
              <Share2 size={16} />
              Compartir
            </button>
          </div>
        </div>
      )}

      {/* Modern UI Overlays */}
      <div className="absolute inset-0 pointer-events-none z-10 p-4">
        {!hideControls && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col gap-4 pointer-events-auto">
            <div className="bg-[#0b1221]/90 backdrop-blur-xl rounded-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden">
              <button
                onClick={handleZoomIn}
                aria-label="Acercar mapa"
                className="w-12 h-12 sm:w-10 sm:h-10 flex items-center justify-center text-white hover:bg-white/10 transition-colors border-b border-white/10 active:bg-white/20"
              >
                <Plus size={24} />
              </button>
              <button
                onClick={handleZoomOut}
                aria-label="Alejar mapa"
                className="w-12 h-12 sm:w-10 sm:h-10 flex items-center justify-center text-white hover:bg-white/10 transition-colors active:bg-white/20"
              >
                <Minus size={24} />
              </button>
            </div>

            <div className="bg-[#0b1221]/90 backdrop-blur-xl rounded-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden">
              <button onClick={handleRecenter} title="Centrar vehículo activo" className="w-12 h-12 sm:w-10 sm:h-10 flex items-center justify-center text-cyan-400 hover:bg-white/10 transition-colors border-b border-white/10 active:bg-white/20"><Crosshair size={20} /></button>
              <button onClick={handleFitFleet} title="Ver toda la flota" className="w-12 h-12 sm:w-10 sm:h-10 flex items-center justify-center text-cyan-400 hover:bg-white/10 transition-colors border-b border-white/10 active:bg-white/20"><Maximize size={20} /></button>
              <button onClick={() => changeBaseLayer(baseLayer === 'dark' ? 'satellite' : 'dark')} title="Cambiar capa del mapa" className="w-12 h-12 sm:w-10 sm:h-10 flex items-center justify-center text-cyan-400 hover:bg-white/10 transition-colors active:bg-white/20"><Layers size={20} /></button>
            </div>
          </div>
        )}

        {isFollowingRoute && (navState.navRoute.length >= 2 || navState.navError) && (
          <div className="absolute left-4 top-4 pointer-events-auto bg-[#0b1221]/95 backdrop-blur-xl rounded-2xl border border-cyan-500/40 shadow-[0_0_30px_rgba(34,211,238,0.15)] px-4 py-3 max-w-[280px]">
            <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase tracking-wider text-xs">
              <Navigation size={14} />
              Ruta activa
            </div>
            {navState.navError && navState.navRoute.length < 2 && (
              <div className="mt-2 text-xs text-red-400 leading-tight">
                No se pudo trazar la ruta. Intenta con otra posición.
              </div>
            )}
            {navState.navMeta && (
              <div className="flex flex-col gap-1 mt-2 text-sm text-slate-200">
                <div className="font-bold text-white text-lg">{formatNavDuration(navState.navMeta.durationS)}</div>
                <div className="text-cyan-200/70">{formatNavDistance(navState.navMeta.distanceM)}</div>
              </div>
            )}
          </div>
        )}

        <div className="absolute bottom-2 right-4 pointer-events-auto">
          <div />
          <div className="text-gray-500 text-xs">
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">OpenStreetMap</a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MapArea;
