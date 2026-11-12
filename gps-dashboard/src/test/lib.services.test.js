// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fetchDrivingRoute } from '../lib/routing';
import { searchPlaces } from '../lib/geocode';
import { deleteVehicle } from '../lib/vehicleActions';
import { supabase } from '../lib/supabase';

vi.mock('../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    }
  },
  withAuthRetry: vi.fn((fn) => fn())
}));

describe('lib services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('routing.js', () => {
    it('returns formatted route data from OSRM response', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 'Ok',
          routes: [{
            geometry: { coordinates: [[-74.0, 4.6], [-74.1, 4.7]] },
            distance: 1200,
            duration: 360
          }]
        })
      });

      const result = await fetchDrivingRoute([4.6, -74.0], [4.7, -74.1]);
      
      expect(result).not.toBeNull();
      expect(result.distanceM).toBe(1200);
      expect(result.durationS).toBe(360);
      expect(result.coords).toEqual([[4.6, -74.0], [4.7, -74.1]]); // Coordinates flipped to lat, lng
    });

    it('throws error if OSRM returns an error', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(fetchDrivingRoute([4.6, -74.0], [4.7, -74.1])).rejects.toThrow('Ruta no disponible (500)');
    });
  });

  describe('geocode.js', () => {
    it('returns array of places from Nominatim response', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          {
            place_id: '123',
            display_name: 'Calle 100, Bogotá, Colombia',
            lat: '4.6',
            lon: '-74.0',
            address: { road: 'Calle 100', city: 'Bogotá' }
          }
        ])
      });

      const result = await searchPlaces('Calle 100');
      
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('123');
      expect(result[0].label).toBe('Calle 100, Bogotá');
      expect(result[0].position).toEqual([4.6, -74.0]);
    });

    it('throws error if fetch fails with non-ok response', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 502
      });
      
      await expect(searchPlaces('Bogota')).rejects.toThrow('Búsqueda no disponible (502)');
    });
  });

  describe('vehicleActions.js', () => {
    it('calls delete-device-user Edge Function successfully', async () => {
      supabase.functions.invoke.mockResolvedValueOnce({
        data: { message: 'Deleted' },
        error: null
      });

      const result = await deleteVehicle('dev1', 'device');
      expect(result).toEqual({ remote: true });
      expect(supabase.functions.invoke).toHaveBeenCalledWith('delete-device-user', {
        body: { device_id: 'dev1' }
      });
    });

    it('returns { remote: false, error } and logs error if Edge Function fails', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      supabase.functions.invoke.mockResolvedValueOnce({
        data: null,
        error: new Error('Permission denied')
      });

      const result = await deleteVehicle('dev1', 'device');
      expect(result.remote).toBe(false);
      expect(result.error).toBeDefined();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    // ── Casos de comportamiento real ───────────────────────────────────────

    it('envía vehicle_id (no device_id) cuando kind es "vehicle"', async () => {
      supabase.functions.invoke.mockResolvedValueOnce({ data: { ok: true }, error: null });

      await deleteVehicle('veh-99', 'vehicle');

      expect(supabase.functions.invoke).toHaveBeenCalledWith('delete-device-user', {
        body: { vehicle_id: 'veh-99' }
      });
    });

    it('relanza el error si el status es 401 (para que withAuthRetry renueve el token)', async () => {
      const authError = new Error('Unauthorized');
      authError.status = 401;
      supabase.functions.invoke.mockResolvedValueOnce({
        data: null,
        error: authError,
      });

      // withAuthRetry en el mock llama fn() directamente, así que el 401
      // debe propagarse hacia arriba en lugar de ser capturado silenciosamente.
      await expect(deleteVehicle('dev1', 'device')).rejects.toMatchObject({ status: 401 });
    });
  });

  // ── routing.js — casos de borde no cubiertos ─────────────────────────────
  describe('routing.js — casos de borde', () => {
    it('retorna null sin llamar a fetch si las coordenadas son inválidas (lat > 90)', async () => {
      const { fetchDrivingRoute } = await import('../lib/routing');
      const result = await fetchDrivingRoute([91, 0], [4.7, -74.1]);
      expect(result).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('retorna null sin llamar a fetch si el destino es null', async () => {
      const { fetchDrivingRoute } = await import('../lib/routing');
      const result = await fetchDrivingRoute([4.6, -74.0], null);
      expect(result).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('retorna null si la respuesta OSRM no tiene rutas', async () => {
      const { fetchDrivingRoute } = await import('../lib/routing');
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 'Ok', routes: [] }),
      });
      const result = await fetchDrivingRoute([4.6, -74.0], [4.7, -74.1]);
      expect(result).toBeNull();
    });

    it('las coordenadas retornadas están en formato [lat, lng] (no [lng, lat] de OSRM)', async () => {
      const { fetchDrivingRoute } = await import('../lib/routing');
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 'Ok',
          routes: [{
            geometry: { coordinates: [[-74.0, 4.6]] }, // OSRM da [lng, lat]
            distance: 100,
            duration: 30,
          }],
        }),
      });
      const result = await fetchDrivingRoute([4.6, -74.0], [4.6, -74.0]);
      // Debe invertirse a [lat, lng]
      expect(result.coords[0]).toEqual([4.6, -74.0]);
    });
  });
});

