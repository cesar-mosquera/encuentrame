// @vitest-environment jsdom
/**
 * Pruebas de estrés de red / Offline First.
 *
 * Simulan la pérdida de conexión mientras el vehículo se desplaza y verifican
 * el contrato que importa antes de liberar:
 *   1. Ninguna coordenada se pierde: se encola en localStorage.
 *   2. Al volver la red, la cola se vacía por lotes hacia Supabase.
 *   3. Los reintentos son idempotentes (mismo event_id, onConflict).
 *   4. Un fallo parcial conserva solo lo no confirmado.
 *   5. La cola tiene tope y descarta lo más antiguo, no lo más reciente.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const upsert = vi.fn();
  const from = vi.fn(() => ({ upsert }));
  const getSession = vi.fn();
  return { upsert, from, getSession };
});

vi.mock('./supabase', () => ({
  supabase: {
    auth: { getSession: mocks.getSession },
    from: mocks.from,
  },
  getDeviceId: vi.fn(() => 'dev-offline'),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
  registerPlugin: () => ({
    addWatcher: vi.fn(),
    removeWatcher: vi.fn(),
    openSettings: vi.fn(),
  }),
}));

import {
  cacheLocation,
  getCachedLocations,
  flushCachedLocations,
  MAX_CACHED_LOCATIONS,
  generateEventId,
  gpsTracker,
} from './gpsTracker';

const DEVICE_ID = 'dev-1';
const NETWORK_ERROR = new Error('Network request failed');

const position = (latitude, longitude, timestamp = Date.now()) => ({
  coords: { latitude, longitude, speed: 10, accuracy: 5, heading: 90 },
  timestamp,
});

const seed = (count, deviceId = DEVICE_ID) => {
  for (let i = 0; i < count; i += 1) {
    cacheLocation(
      {
        latitude: 4.6 + i * 0.0001,
        longitude: -74.08,
        speed: 30,
        accuracy: 4,
        bearing: 90,
        timestamp: new Date(1_700_000_000_000 + i * 1000).toISOString(),
      },
      deviceId
    );
  }
};

const sentPayloads = () => mocks.upsert.mock.calls.map(([payload]) => payload);

describe('Offline First: pérdida de red durante el desplazamiento', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.upsert.mockReset().mockResolvedValue({ error: null });
    mocks.getSession.mockReset().mockResolvedValue({
      data: { session: { user: { app_metadata: { device_id: DEVICE_ID } } } },
      error: null,
    });
    mocks.from.mockImplementation(() => ({ upsert: mocks.upsert }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('encola TODAS las coordenadas cuando no hay red, sin perder ninguna', async () => {
    mocks.upsert.mockRejectedValue(NETWORK_ERROR);

    await gpsTracker.sendCurrentLocation(position(4.6, -74.08, 1_700_000_000_000));
    await gpsTracker.sendCurrentLocation(position(4.6001, -74.0801, 1_700_000_030_000));
    await gpsTracker.sendCurrentLocation(position(4.6002, -74.0802, 1_700_000_060_000));

    const cached = getCachedLocations(DEVICE_ID);
    expect(cached).toHaveLength(3);
    expect(cached.map((c) => c.latitude)).toEqual([4.6, 4.6001, 4.6002]);
    expect(cached[0].longitude).toBe(-74.08);
  });

  it('preserva el timestamp real del fix GPS al encolar (no la hora del reintento)', async () => {
    mocks.upsert.mockRejectedValue(NETWORK_ERROR);
    const fixTime = 1_700_000_123_000;

    await gpsTracker.sendCurrentLocation(position(4.61, -74.09, fixTime));

    expect(getCachedLocations(DEVICE_ID)[0].timestamp).toBe(new Date(fixTime).toISOString());
  });

  it('aplica los mismos clamps de la DB antes de encolar (speed, bearing, accuracy)', async () => {
    mocks.upsert.mockRejectedValue(NETWORK_ERROR);

    await gpsTracker.sendCurrentLocation({
      coords: { latitude: 4.6, longitude: -74.0, speed: -50, accuracy: -3, heading: 999 },
      timestamp: Date.now(),
    });

    const [cached] = getCachedLocations(DEVICE_ID);
    expect(cached.speed).toBe(0);
    expect(cached.accuracy).toBe(0);
    expect(cached.bearing).toBe(360);
  });

  it('vacía la cola completa cuando la red vuelve', async () => {
    mocks.upsert.mockRejectedValue(NETWORK_ERROR);
    await gpsTracker.sendCurrentLocation(position(4.6, -74.08, 1_700_000_000_000));
    await gpsTracker.sendCurrentLocation(position(4.6001, -74.0801, 1_700_000_030_000));
    expect(getCachedLocations(DEVICE_ID)).toHaveLength(2);

    mocks.upsert.mockReset();
    mocks.upsert.mockResolvedValue({ error: null });

    await flushCachedLocations(DEVICE_ID);

    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(sentPayloads()[0]).toHaveLength(2);
    expect(getCachedLocations(DEVICE_ID)).toHaveLength(0);
  });

  it('envía la cola en lotes de 50 y no en un roundtrip por posición', async () => {
    seed(120);
    mocks.upsert.mockResolvedValue({ error: null });

    await flushCachedLocations(DEVICE_ID);

    expect(mocks.upsert).toHaveBeenCalledTimes(3);
    expect(sentPayloads().map((batch) => batch.length)).toEqual([50, 50, 20]);
    expect(getCachedLocations(DEVICE_ID)).toHaveLength(0);
  });

  it('usa upsert idempotente con onConflict device_id,event_id', async () => {
    seed(2);

    await flushCachedLocations(DEVICE_ID);

    for (const [, options] of mocks.upsert.mock.calls) {
      expect(options).toEqual({ onConflict: 'device_id,event_id', ignoreDuplicates: true });
    }
    for (const row of sentPayloads()[0]) {
      expect(row.event_id).toMatch(/^evt-/);
      expect(row.device_id).toBe(DEVICE_ID);
    }
  });

  it('reintenta con el MISMO event_id: un reintento no puede duplicar la trayectoria', async () => {
    const timestamp = '2026-10-02T12:00:00.000Z';
    cacheLocation(
      { latitude: 4.6, longitude: -74.08, timestamp, event_id: 'evt-fixed-1' },
      DEVICE_ID
    );
    mocks.upsert.mockResolvedValueOnce({ error: { message: 'timeout' } });

    await flushCachedLocations(DEVICE_ID);
    expect(getCachedLocations(DEVICE_ID)).toHaveLength(1);

    mocks.upsert.mockResolvedValueOnce({ error: null });
    await flushCachedLocations(DEVICE_ID);

    const retryPayload = sentPayloads()[1][0];
    expect(retryPayload.event_id).toBe('evt-fixed-1');
    expect(getCachedLocations(DEVICE_ID)).toHaveLength(0);
  });

  it('en reintento posterior genera event_id determinista para datos antiguos sin event_id', async () => {
    const timestamp = '2026-10-02T12:00:00.000Z';
    cacheLocation({ latitude: 4.6, longitude: -74.08, timestamp }, DEVICE_ID);
    mocks.upsert.mockResolvedValueOnce({ error: { message: 'timeout' } });

    await flushCachedLocations(DEVICE_ID);
    mocks.upsert.mockResolvedValueOnce({ error: null });
    await flushCachedLocations(DEVICE_ID);

    expect(sentPayloads()[1][0].event_id).toBe(
      generateEventId(DEVICE_ID, timestamp, 4.6, -74.08)
    );
  });

  it('conserva el lote que falló y descarta solo los lotes confirmados', async () => {
    seed(120);
    mocks.upsert
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'dead connection' } })
      .mockResolvedValueOnce({ error: null });

    await flushCachedLocations(DEVICE_ID);

    const remaining = getCachedLocations(DEVICE_ID);
    expect(remaining).toHaveLength(50);
    // El lote 2 (índices 50..99) es el único que no se confirmó.
    expect(remaining[0].latitude).toBeCloseTo(4.6 + 50 * 0.0001, 6);
    expect(remaining.at(-1).latitude).toBeCloseTo(4.6 + 99 * 0.0001, 6);
  });

  it('si el fetch lanza (sin red), la cola permanece intacta para el próximo intento', async () => {
    seed(3);
    expect(getCachedLocations(DEVICE_ID)).toHaveLength(3);
    mocks.upsert.mockRejectedValue(NETWORK_ERROR);

    // flush no propaga el fallo: lo reporta y conserva la cola.
    await expect(flushCachedLocations(DEVICE_ID)).resolves.toBeUndefined();
    expect(getCachedLocations(DEVICE_ID)).toHaveLength(3);
  });

  it('trunca la cola al tope conservando las posiciones más recientes', () => {
    seed(MAX_CACHED_LOCATIONS + 25);

    const cached = getCachedLocations(DEVICE_ID);
    expect(cached).toHaveLength(MAX_CACHED_LOCATIONS);
    // Se descartaron las 25 más antiguas, no las nuevas.
    expect(cached[0].latitude).toBeCloseTo(4.6 + 25 * 0.0001, 6);
    expect(cached.at(-1).latitude).toBeCloseTo(
      4.6 + (MAX_CACHED_LOCATIONS + 24) * 0.0001,
      6
    );
  });

  it('sin sesión también encola (no pierde el fix por un fallo de auth)', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });

    await gpsTracker.sendCurrentLocation(position(4.6, -74.08));

    // El fallback usa getDeviceId(); en este mock devuelve dev-offline.
    expect(getCachedLocations('dev-offline')).toHaveLength(1);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
