import { supabase, withAuthRetry } from './supabase';


export const deleteVehicle = async (entityId, kind = 'vehicle') => {
  if (!supabase) return { remote: false };

  return withAuthRetry(async () => {
    try {
      const isDevice = kind === 'device';
      const body = isDevice ? { device_id: entityId } : { vehicle_id: entityId };

      const { data, error } = await supabase.functions.invoke('delete-device-user', {
        body,
      });

      if (error) {
        // Preservar el código HTTP en el error para que withAuthRetry
        // pueda detectar 401 y renovar el token correctamente si corresponde.
        let detail = error.message || ''
        try {
          // FunctionsHttpError lleva la respuesta real en error.context
          const ctx = error.context
          if (ctx) {
            const body = typeof ctx.json === 'function' ? await ctx.clone().json().catch(() => null) : null
            detail = body?.error || body?.message || (typeof ctx === 'string' ? ctx : detail)
          }
        } catch { /* sin detalle */ }
        const err = new Error(detail || 'Error al eliminar el vehículo y dispositivo de forma segura');
        err.status = error.status || 500;
        throw err;
      }

      if (data && data.error) {
        const err = new Error(data.error);
        err.status = data.status || 400;
        throw err;
      }

      return { remote: true };
    } catch (error) {
      // Los 401 se relanzan para que withAuthRetry renueve el token y reintente.
      if (error?.status === 401) throw error;
      console.error('Error al invocar la función de eliminación segura:', error);
      return { remote: false, error };
    }
  });
};

export const updateEntity = async (entityId, category, updates) => {
  if (!supabase) return { remote: false };

  return withAuthRetry(async () => {
    const table = category === 'vehicles' ? 'vehicles' : 'devices';
    const { error } = await supabase.from(table).update(updates).eq('id', entityId);

    if (error) return { remote: false, error };
    return { remote: true };
  });
};
