import React, { useCallback, useEffect, useRef } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabase';
import CommandCenter from './command/CommandCenter';
import { updateEntity } from '../lib/vehicleActions';
import { createGeofence } from '../lib/queries';
import { EditEntityModal } from './EditEntityModal';
import { DashboardProvider } from '../context/DashboardContext';
import { useDashboardContext } from '../context/dashboard-context';

const DashboardInner = () => {
  const { state, dispatch, data } = useDashboardContext();
  const { category, geofenceRadius, pendingGeofenceConfirm, entityToEdit, operationMessage } = state;
  const { vehiclesList, devicesList, activeNetworkError, refetchVehicles, refetchDevices, refetchGeofences } = data;

  const sharedVehicleId = new URLSearchParams(window.location.search).get('vehicle');

  // useCallback: `dispatch` viene de useReducer y es estable, así que ambos handlers
  // puedenmemoizarse. Necesario para incluirlos en las deps del efecto de deep-link
  // sin provocar re-renders infinitos.
  const handleCategoryChange = useCallback(
    (next) => {
      dispatch({ type: 'SET_CATEGORY', payload: next });
    },
    [dispatch]
  );

  const selectEntity = useCallback((entity) => {
    if (!entity) return;
    dispatch({ type: 'SET_SELECTED_ENTITY', payload: { ...entity, controlState: undefined } });
    if (entity.position) {
      dispatch({ type: 'SET_FLY_TO', payload: { coords: entity.position, zoom: 16, timestamp: Date.now() } });
    }
  }, [dispatch]);

  const handleConfirmGeofence = async () => {
    if (!pendingGeofenceConfirm) return;
    const { center, name } = pendingGeofenceConfirm;
    const newGeo = {
      name, type: 'circle', center, positions: [center], radius: geofenceRadius, color: '#168ca4', rule: 'outside', active: true,
    };
    if (hasSupabaseConfig && supabase) {
      try {
        const saved = await createGeofence(newGeo);
        if (saved) {
          if (refetchGeofences) await refetchGeofences();
          dispatch({ type: 'SET_OPERATION_MESSAGE', payload: 'Geocerca guardada con éxito' });
          dispatch({ type: 'SET_PENDING_GEOFENCE_CONFIRM', payload: null });
          dispatch({ type: 'SET_PENDING_CENTER', payload: null });
        }
      } catch (err) {
        dispatch({ type: 'SET_OPERATION_MESSAGE', payload: `Error al guardar geocerca: ${err.message || 'Sin permisos'}. Puedes reintentar.` });
      }
    } else {
      dispatch({ type: 'SET_LOCAL_GEOFENCES', payload: [{ id: `GEOF-${Date.now()}`, ...newGeo }, ...state.localGeofences] });
      dispatch({ type: 'SET_OPERATION_MESSAGE', payload: 'Geocerca guardada localmente' });
      dispatch({ type: 'SET_PENDING_GEOFENCE_CONFIRM', payload: null });
      dispatch({ type: 'SET_PENDING_CENTER', payload: null });
    }
  };

  const handleCancelGeofence = () => {
    dispatch({ type: 'SET_PENDING_GEOFENCE_CONFIRM', payload: null });
    dispatch({ type: 'SET_PENDING_CENTER', payload: null });
  };

  const handleSaveEntity = async (entityId, currentCategory, updates) => {
    const result = await updateEntity(entityId, currentCategory, updates);
    if (result.error) throw new Error(result.error.message || 'Error al guardar los cambios');
    dispatch({ type: 'SET_OPERATION_MESSAGE', payload: 'Cambios guardados con éxito' });
    if (currentCategory === 'vehicles' && refetchVehicles) refetchVehicles();
    if (currentCategory === 'devices' && refetchDevices) refetchDevices();
  };

  const hasCenteredOnVehicle = useRef(false);

  useEffect(() => {
    if (!sharedVehicleId) return;
    if (hasCenteredOnVehicle.current) return;

    const sharedCategory = new URLSearchParams(window.location.search).get('category');
    const inVehicles = vehiclesList.find((v) => v.id === sharedVehicleId);
    const inDevices = devicesList.find((d) => d.id === sharedVehicleId);
    const targetCategory = sharedCategory === 'devices'
      ? (inDevices ? 'devices' : null)
      : (sharedCategory === 'vehicles' ? (inVehicles ? 'vehicles' : null) : null);
    const resolvedCategory = targetCategory || (inDevices && !inVehicles ? 'devices' : (inVehicles ? 'vehicles' : (inDevices ? 'devices' : null)));
    const targetEntity = resolvedCategory === 'devices' ? inDevices : (resolvedCategory === 'vehicles' ? inVehicles : null);

    // Orden CRÍTICO: SET_CATEGORY resetea `selectedEntity` a null (DashboardContext.jsx:51).
    // Si se despacha DESPUÉS de SET_SELECTED_ENTITY, borra la selección y el panel de
    // detalle nunca abre. Ambos dispatch van en el mismo tick, así que React los
    // procesa en orden y el estado final es categoría correcta + entidad seleccionada.
    if (resolvedCategory && category !== resolvedCategory) {
      handleCategoryChange(resolvedCategory);
    }

    if (targetEntity) {
      selectEntity(targetEntity);
      hasCenteredOnVehicle.current = true;
      const url = new URL(window.location);
      url.searchParams.delete('vehicle');
      url.searchParams.delete('category');
      url.searchParams.delete('follow');
      window.history.replaceState({}, '', url);
    } else if (!data.fleetLoading) {
      // Si ya cargó la flota y no encontró el vehículo, limpiamos la URL
      // para evitar que en futuros renders siga intentando buscar un ID inválido.
      const url = new URL(window.location);
      url.searchParams.delete('vehicle');
      url.searchParams.delete('category');
      url.searchParams.delete('follow');
      window.history.replaceState({}, '', url);
      hasCenteredOnVehicle.current = true; // Prevenir múltiples ejecuciones
    }
  }, [sharedVehicleId, vehiclesList, devicesList, category, handleCategoryChange, selectEntity, data.fleetLoading]);

  return (
    <div className="relative flex w-full flex-col bg-[#0b0f19] h-[100dvh] overflow-hidden">
      <CommandCenter />

      {operationMessage && (
        <button type="button" className="dashboard-toast" onClick={() => dispatch({ type: 'SET_OPERATION_MESSAGE', payload: '' })} aria-label="Cerrar mensaje">
          {operationMessage}
        </button>
      )}

      {!operationMessage && activeNetworkError && (
        <div className="dashboard-toast border border-[#ef5c72]/60 bg-[#250d12]/95 text-[#fca5a5]">
          ⚠️ Sin conexión a la red. Mostrando datos locales previamente cargados.
        </div>
      )}

      {pendingGeofenceConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Confirmar geocerca">
          <div className="w-full max-w-sm rounded-xl border border-[#28566a] bg-[#081825] p-5 shadow-2xl">
            <h3 className="text-[15px] font-bold text-[#effcff]">Confirmar Nueva Geocerca</h3>
            <p className="mt-2 text-[12px] text-[#89a9b5]">
              Crea una geocerca circular en las coordenadas seleccionadas. Usa el radio para que el dispositivo se detecte como «fuera de zona».
            </p>
            <fieldset className="mt-4">
              <legend className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-[#89a9b5]">Radio de la zona</legend>
              <div className="flex flex-wrap gap-1.5">
                {[100, 200, 300, 600, 1000].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => dispatch({ type: 'SET_GEOFENCE_RADIUS', payload: r })}
                    aria-pressed={geofenceRadius === r}
                    className={`rounded-md border px-2.5 py-1.5 font-mono text-[11px] font-bold transition-all ${
                      geofenceRadius === r
                        ? 'border-[#b8f36b]/70 bg-[#b8f36b]/15 text-[#effcff] shadow-[0_0_10px_rgba(184,243,107,0.15)]'
                        : 'border-[#28566a] text-[#89a9b5] hover:border-[#3f7c94] hover:text-[#effcff]'
                    }`}
                  >
                    {r} m
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelGeofence}
                className="rounded-lg border border-[#28566a] bg-[#102b38] px-3.5 py-2 text-[11px] font-bold text-[#89a9b5] hover:text-[#effcff]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmGeofence}
                className="rounded-lg bg-[#b8f36b] px-4 py-2 text-[11px] font-extrabold text-[#07111c] shadow-[0_0_12px_rgba(184,243,107,0.2)] hover:bg-[#cbfb88]"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {entityToEdit && (
        <EditEntityModal
          entity={entityToEdit}
          category={entityToEdit._kind === 'vehicle' ? 'vehicles' : 'devices'}
          onClose={() => dispatch({ type: 'SET_ENTITY_TO_EDIT', payload: null })}
          onSave={handleSaveEntity}
        />
      )}
    </div>
  );
};

const Dashboard = () => (
  <DashboardProvider>
    <DashboardInner />
  </DashboardProvider>
);

export default Dashboard;