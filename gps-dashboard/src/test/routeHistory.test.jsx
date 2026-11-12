import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useRouteHistory } from '../hooks/useRouteHistory';
import { normalizeEntity } from '../components/command/normalize';

vi.mock('../lib/queries', async () => {
  const actual = await vi.importActual('../lib/queries');
  return {
    ...actual,
    fetchDeviceRouteHistory: vi.fn(async () => [
      [-0.28, -78.53],
      [-0.27, -78.52],
    ]),
  };
});

import { fetchDeviceRouteHistory } from '../lib/queries';

const vehicleEntity = (route = []) => ({
  ...normalizeEntity({ id: 'veh-1', device_id: 'dev-abc', name: 'Camion', route }),
  _kind: 'vehicle',
});

describe('useRouteHistory', () => {
  beforeEach(() => {
    fetchDeviceRouteHistory.mockClear();
    fetchDeviceRouteHistory.mockResolvedValue([
      [-0.28, -78.53],
      [-0.27, -78.52],
    ]);
  });

  it('pide historial por deviceId para un vehiculo sin ruta embebida', async () => {
    const { result } = renderHook(() => useRouteHistory(vehicleEntity()));

    await waitFor(() => {
      expect(fetchDeviceRouteHistory).toHaveBeenCalledWith('dev-abc', 250);
    });
    await waitFor(() => {
      expect(result.current.route.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('no lee device_id: normalizeEntity solo expone deviceId', () => {
    const entity = vehicleEntity();
    expect(entity.device_id).toBeUndefined();
    expect(entity.deviceId).toBe('dev-abc');
  });

  it('respeta la ruta embebida sin golpear la base de datos', async () => {
    const embedded = [
      [-0.3, -78.5],
      [-0.29, -78.49],
    ];
    const { result } = renderHook(() => useRouteHistory(vehicleEntity(embedded)));

    await waitFor(() => {
      expect(result.current.hasEmbeddedRoute).toBe(true);
    });
    expect(fetchDeviceRouteHistory).not.toHaveBeenCalled();
    expect(result.current.route).toEqual(embedded);
  });

  it('un vehiculo sin deviceId no dispara consultas', async () => {
    const entity = { ...normalizeEntity({ id: 'veh-sin-device', route: [] }), _kind: 'vehicle' };
    const { result } = renderHook(() => useRouteHistory(entity));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(fetchDeviceRouteHistory).not.toHaveBeenCalled();
  });

  it('un dispositivo sigue usando su propio id', async () => {
    const device = { ...normalizeEntity({ id: 'dev-1', route: [] }), _kind: 'device' };
    renderHook(() => useRouteHistory(device));

    await waitFor(() => {
      expect(fetchDeviceRouteHistory).toHaveBeenCalledWith('dev-1', 250);
    });
  });
});
