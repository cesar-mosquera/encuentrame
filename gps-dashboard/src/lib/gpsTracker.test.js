// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { cacheLocation, getCachedLocations, clearCache, clearAllGpsCaches, gpsTracker } from './gpsTracker';

describe('gpsTracker & offline cache', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('guarda posiciones en localStorage asociadas al deviceId', () => {
    const mockLocation = {
      latitude: 4.6097,
      longitude: -74.0817,
      speed: 40,
      accuracy: 5,
      bearing: 180,
      timestamp: '2026-01-01T12:00:00.000Z',
    };

    cacheLocation(mockLocation, 'device-101');
    cacheLocation(mockLocation, 'device-202');

    const cached1 = getCachedLocations('device-101');
    const cached2 = getCachedLocations('device-202');

    expect(cached1).toHaveLength(1);
    expect(cached2).toHaveLength(1);

    clearCache('device-101');
    expect(getCachedLocations('device-101')).toHaveLength(0);
    expect(getCachedLocations('device-202')).toHaveLength(1);

    clearAllGpsCaches();
    expect(getCachedLocations('device-202')).toHaveLength(0);
  });

  it('evita solapamientos de intervalos con la bandera tickInFlight', async () => {
    expect(gpsTracker.tickInFlight).toBe(false);

    gpsTracker.tickInFlight = true;
    await gpsTracker.tick();

    // Con tickInFlight activo, tick no debe ejecutar un segundo proceso.
    expect(gpsTracker.tickInFlight).toBe(true);
    gpsTracker.tickInFlight = false;
  });

  it('invalida ejecuciones previas al llamar a stop()', async () => {
    gpsTracker.start(5000);
    const initialRunId = gpsTracker.currentRunId;

    gpsTracker.stop();
    expect(gpsTracker.currentRunId).toBeGreaterThan(initialRunId);
    expect(gpsTracker.isRunning).toBe(false);

    // Un tick invocación con el runId viejo debe retornar inmediatamente sin alterar isRunning
    await gpsTracker.tick(initialRunId);
    expect(gpsTracker.isRunning).toBe(false);
  });

  it('no cancela el primer tick por usar un flag distinto al de seguimiento', async () => {
    // Regresión: start() ponía isRunning=true y tick() usaba ese mismo flag como
    // guard, así que el primer tick se cancelaba solo y el dashboard se quedaba sin
    // posición hasta el siguiente intervalo (30 s).
    const getCurrentPosition = vi.fn((success) => {
      success({ coords: { latitude: 4.61, longitude: -74.08, accuracy: 5 }, timestamp: Date.now() });
    });
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    const sendSpy = vi.spyOn(gpsTracker, 'sendCurrentLocation').mockResolvedValue(undefined);

    gpsTracker.start(30000);

    expect(gpsTracker.isRunning).toBe(true);
    // El primer tick se dispara de inmediato y no se autodescarta.
    expect(getCurrentPosition).toHaveBeenCalled();

    gpsTracker.stop();
    vi.unstubAllGlobals();
    sendSpy.mockRestore();
  });
});
