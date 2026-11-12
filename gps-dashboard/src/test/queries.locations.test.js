// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Cadena PostgREST minima: cada llamada a from() devuelve un objeto encadenable que
// resuelve en una respuesta distinta segun la tabla y el select solicitados.
const makeBuilder = (handler) => {
  const builder = {
    select: vi.fn((...args) => {
      builder.__select = args;
      return builder;
    }),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    then: (resolve, reject) => Promise.resolve(handler(builder.__select)).then(resolve, reject),
  };
  return builder;
};

const handlers = {
  'latest_gps_locations': vi.fn(),
  'devices': vi.fn(),
};

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table) => makeBuilder((select) => handlers[table](select)),
  },
  withAuthRetry: (fn) => fn(),
}));

const { fetchLatestLocations, clearQueryCaches, latestLocationsByDevice } = await import('../lib/queries');

const locationRow = (deviceId, lat) => ({
  device_id: deviceId,
  latitude: lat,
  longitude: -74.08,
  speed: 20,
  accuracy: 8,
  altitude: null,
  bearing: null,
  timestamp: '2026-10-05T12:00:00.000Z',
});

describe('fetchLatestLocations: embed devices sobre la vista latest_gps_locations', () => {
  beforeEach(() => {
    clearQueryCaches();
    vi.clearAllMocks();
  });

  it('usa el resultado del embed cuando PostgREST puede resolver la relacion', async () => {
    const embedded = [{ ...locationRow('disp-1', 4.61), devices: { battery: 80 } }];
    handlers['latest_gps_locations'].mockResolvedValueOnce({ data: embedded, error: null });

    const rows = await fetchLatestLocations();

    expect(rows).toEqual(embedded);
    // El camino feliz hace una sola consulta, sin tocar la tabla devices.
    expect(handlers.devices).not.toHaveBeenCalled();
  });

  it('cae a consulta simple + telemetria aparte si el embed falla con PGRST202', async () => {
    // latest_gps_locations es una VIEW. PostgREST deduce las relaciones embebidas de las
    // FK del catalogo, y una vista no declara ninguna, asi que devices(...) devuelve
    // PGRST202 aunque gps_locations y devices si esten relacionadas. Sin este fallback
    // el mapa entero se quedaba vacio.
    const error = { code: 'PGRST202', message: 'Could not find a relationship' };
    handlers['latest_gps_locations']
      .mockResolvedValueOnce({ data: null, error })
      .mockResolvedValueOnce({ data: [locationRow('disp-1', 4.61), locationRow('disp-2', 4.62)], error: null });
    handlers.devices.mockResolvedValueOnce({
      data: [{ id: 'disp-1', battery: 80, platform: 'android', model: 'Pixel', app_version: '2.0.0' }],
      error: null,
    });

    const rows = await fetchLatestLocations();

    // Misma forma que produce el embed, para que transformDevice no cambie.
    expect(rows[0].devices).toEqual({
      id: 'disp-1', battery: 80, platform: 'android', model: 'Pixel', app_version: '2.0.0',
    });
    // Un dispositivo sin fila en devices conserva su posicion, sin metadatos inventados.
    expect(rows[1].device_id).toBe('disp-2');
    expect(rows[1].devices).toBeUndefined();
    expect(latestLocationsByDevice(rows)).toHaveLength(2);
  });

  it('devuelve las posiciones aunque la telemetria de devices falle', async () => {
    // La telemetria es opcional. Un 403 en devices no puede vaciar el mapa.
    const error = { code: 'PGRST202', message: 'Could not find a relationship' };
    handlers['latest_gps_locations']
      .mockResolvedValueOnce({ data: null, error })
      .mockResolvedValueOnce({ data: [locationRow('disp-1', 4.61)], error: null });
    handlers.devices.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } });

    const rows = await fetchLatestLocations();

    expect(rows).toHaveLength(1);
    expect(rows[0].latitude).toBe(4.61);
    expect(rows[0].devices).toBeUndefined();
  });

  it('propaga el error si tampoco existe la vista, sin inventar datos', async () => {
    const error = { code: '42P01', message: 'relation "public.latest_gps_locations" does not exist' };
    handlers['latest_gps_locations']
      .mockResolvedValueOnce({ data: null, error })
      .mockResolvedValueOnce({ data: null, error });

    await expect(fetchLatestLocations()).rejects.toThrow(/latest_gps_locations/);
  });
});