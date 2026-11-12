import React, { useReducer, useMemo, useEffect, useCallback } from 'react';
import { useVehicles, useDevices, useAlerts, useGeofences } from '../hooks';
import { hasSupabaseConfig, supabase } from '../lib/supabase';
import { clearAllGpsCaches } from '../lib/gpsTracker';
import { clearQueryCaches } from '../lib/queries';
import { DashboardContext } from './dashboard-context';

const initialState = {
  category: 'devices',
  selectedEntity: null,
  flyToTrigger: null,
  isPlacingOnMap: false,
  pendingCenter: null,
  geofenceRadius: 300,
  pendingGeofenceConfirm: null,
  userLocation: null,
  locateUserTrigger: null,
  isFollowingRoute: false,
  origin: null,
  entityToEdit: null,
  operationMessage: '',
  alertFocusTrigger: null,
  routeFocusTrigger: null,
  localVehicles: [],
  localGeofences: [],
};

function init(state) {
  if (typeof window === 'undefined') return state;
  
  const queryCategory = new URLSearchParams(window.location.search).get('category');
  const queryFollow = new URLSearchParams(window.location.search).get('follow') === '1';
  let category = 'devices';
  
  if (queryCategory === 'devices' || queryCategory === 'vehicles' || queryCategory === 'all') {
    category = queryCategory;
  } else {
    const stored = localStorage.getItem('rg_category');
    if (stored === 'vehicles' || stored === 'all') category = stored;
  }

  return { ...state, category, isFollowingRoute: queryFollow };
}

function dashboardReducer(state, action) {
  switch (action.type) {
    case 'SET_CATEGORY':
      if (typeof window !== 'undefined') localStorage.setItem('rg_category', action.payload);
      return { ...state, category: action.payload, selectedEntity: null, flyToTrigger: null };
    case 'SET_SELECTED_ENTITY':
      return { ...state, selectedEntity: action.payload };
    case 'SET_FLY_TO':
      return { ...state, flyToTrigger: action.payload };
    case 'SET_PLACING_ON_MAP':
      return { ...state, isPlacingOnMap: action.payload };
    case 'SET_PENDING_CENTER':
      return { ...state, pendingCenter: action.payload };
    case 'SET_GEOFENCE_RADIUS':
      return { ...state, geofenceRadius: action.payload };
    case 'SET_PENDING_GEOFENCE_CONFIRM':
      return { ...state, pendingGeofenceConfirm: action.payload };
    case 'SET_USER_LOCATION':
      return { ...state, userLocation: action.payload };
    case 'SET_LOCATE_USER_TRIGGER':
      return { ...state, locateUserTrigger: action.payload };
    case 'SET_FOLLOWING_ROUTE':
      return { ...state, isFollowingRoute: action.payload };
    case 'SET_ORIGIN':
      return { ...state, origin: action.payload };
    case 'SET_ENTITY_TO_EDIT':
      return { ...state, entityToEdit: action.payload };
    case 'SET_OPERATION_MESSAGE':
      return { ...state, operationMessage: action.payload };
    case 'SET_ALERT_FOCUS':
      return { ...state, alertFocusTrigger: action.payload };
    case 'SET_ROUTE_FOCUS':
      return { ...state, routeFocusTrigger: action.payload };
    case 'SET_LOCAL_VEHICLES':
      return { ...state, localVehicles: action.payload };
    case 'SET_LOCAL_GEOFENCES':
      return { ...state, localGeofences: action.payload };
    default:
      return state;
  }
}

export const DashboardProvider = ({ children }) => {
  const [state, dispatch] = useReducer(dashboardReducer, initialState, init);

  // Hook data
  const { vehicles: supabaseVehicles, isLoading: vehiclesLoading, error: vehiclesError, lastSyncTime: vehiclesSyncTime, isStale: vehiclesStale, refetchVehicles } = useVehicles();
  const { devices: supabaseDevices, isLoading: devicesLoading, error: devicesError, isStale: devicesStale, lastSyncTime: devicesSyncTime, hideEphemeral, refetchDevices } = useDevices();
  const { alerts: supabaseAlerts, error: alertsError } = useAlerts();
  const { geofences: supabaseGeofences, refetchGeofences, error: geofencesError } = useGeofences();

  const vehicles = useMemo(() => (hasSupabaseConfig ? supabaseVehicles : state.localVehicles), [state.localVehicles, supabaseVehicles]);
  const devices = useMemo(() => (hasSupabaseConfig ? supabaseDevices : []), [supabaseDevices]);
  const alerts = useMemo(() => (hasSupabaseConfig ? supabaseAlerts : []), [supabaseAlerts]);
  const geofences = useMemo(() => (hasSupabaseConfig ? supabaseGeofences : state.localGeofences), [state.localGeofences, supabaseGeofences]);

  const activeNetworkError = (state.category === 'devices' ? devicesError : vehiclesError) || alertsError || geofencesError;
  const fleetLoading = state.category === 'devices' ? devicesLoading : state.category === 'vehicles' ? vehiclesLoading : (devicesLoading || vehiclesLoading);

  const devicesList = devices;
  const vehiclesList = vehicles;

  const signOut = useCallback(async () => {
    try {
      clearAllGpsCaches();
      clearQueryCaches();
      if (supabase) await supabase.auth.signOut();
    } catch (err) {
      console.error('Error al cerrar sesión:', err);
    }
  }, []);

  // Auto-select first entity.
  // Converge: se despacha solo cuando el objeto cambia de verdad, así que tras
  // el dispatch el efecto vuelve a correr, compara y termina.
  useEffect(() => {
    const list = state.category === 'all' ? devicesList : (state.category === 'vehicles' ? vehiclesList : devicesList);
    const previous = state.selectedEntity;

    if (!previous) {
      if (list.length > 0) dispatch({ type: 'SET_SELECTED_ENTITY', payload: list[0] });
      return;
    }

    const updated = list.find((item) => item.id === previous.id);
    if (!updated) return;

    const next = { ...updated, controlState: previous.controlState };
    if (JSON.stringify(next) === JSON.stringify(previous)) return;
    dispatch({ type: 'SET_SELECTED_ENTITY', payload: next });
  }, [state.category, devicesList, vehiclesList, state.selectedEntity]);

  const value = useMemo(() => ({
    state,
    dispatch,
    data: {
      vehicles,
      devices,
      alerts,
      geofences,
      vehiclesList,
      devicesList,
      activeNetworkError,
      fleetLoading,
      vehiclesStale,
      devicesStale,
      vehiclesSyncTime,
      devicesSyncTime,
      hideEphemeral,
      refetchVehicles,
      refetchDevices,
      refetchGeofences,
      signOut
    }
  }), [
    state, 
    vehicles, 
    devices, 
    alerts, 
    geofences, 
    vehiclesList, 
    devicesList, 
    activeNetworkError, 
    fleetLoading, 
    vehiclesStale, 
    devicesStale, 
    vehiclesSyncTime, 
    devicesSyncTime,
    hideEphemeral,
    refetchVehicles,
    // refetchDevices faltaba en la lista aunque se expone en `data`. Sin esta
    // dependencia, el valor del contexto podia quedar congelado en la primera
    // version de `refetchDevices` y los reintentos de red no llegaban a los hooks.
    // useLiveCollection lo envuelve en useCallback, asi que su identidad es estable
    // y añadirlo no genera renders extra.
    refetchDevices,
    refetchGeofences,
    signOut
  ]);

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
};
