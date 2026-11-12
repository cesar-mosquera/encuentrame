// @vitest-environment jsdom
/**
 * Lógica de conexión con Supabase (sin red real).
 *
 * Valida la resolución de identidad del dispositivo y la renovación de sesión
 * nativa, que son los dos puntos donde una regresión deja la app "conectada"
 * pero sin poder insertar posiciones.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const setSession = vi.fn().mockResolvedValue({ data: {}, error: null });
  const setAuth = vi.fn();
  const createClient = vi.fn(() => ({
    auth: { setSession },
    realtime: { setAuth },
  }));
  return { setSession, setAuth, createClient };
});

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));

import {
  hasSupabaseConfig,
  getNativeDeviceAuth,
  getDeviceId,
  getStoredDeviceId,
  refreshNativeSession,
} from './supabase';

// El cliente se crea una sola vez al importar el módulo; beforeEach limpia
// el historial de llamadas, así que lo capturamos aquí.
const clientCreatedAtImport = mocks.createClient.mock.calls.length;

const nativeAuth = (payload) => ({
  getDeviceAuthJson: () =>
    typeof payload === 'string' ? payload : JSON.stringify(payload),
});

describe('Supabase: configuración e identidad del dispositivo', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    delete window.CapacitorDeviceAuth;
  });

  afterEach(() => {
    delete window.CapacitorDeviceAuth;
  });

  it('detecta configuración válida desde las variables de entorno', () => {
    expect(hasSupabaseConfig).toBe(true);
    expect(clientCreatedAtImport).toBeGreaterThan(0);
  });

  it('devuelve null y no lanza si el puente nativo entrega JSON corrupto', () => {
    window.CapacitorDeviceAuth = nativeAuth('{esto no es json');
    expect(() => getNativeDeviceAuth()).not.toThrow();
    expect(getNativeDeviceAuth()).toBeNull();
  });

  it('prioriza el device_id provisionado por el nativo y lo persiste', () => {
    window.CapacitorDeviceAuth = nativeAuth({
      device_id: 'device-native-123',
      access_token: 'token-native',
    });

    expect(getDeviceId()).toBe('device-native-123');
    expect(localStorage.getItem('gps_device_id')).toBe('device-native-123');
    expect(getStoredDeviceId()).toBe('device-native-123');
  });

  it('genera y reutiliza un device_id estable en web sin credenciales nativas', () => {
    const first = getDeviceId();
    const second = getDeviceId();

    expect(first).toMatch(/^device-/);
    expect(second).toBe(first);
    expect(localStorage.getItem('gps_device_id')).toBe(first);
  });

  it('getStoredDeviceId no inventa un id si aún no existe', () => {
    expect(getStoredDeviceId()).toBeNull();
  });
});

describe('Supabase: renovación de sesión nativa', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    delete window.CapacitorDeviceAuth;
  });

  it('propaga el access_token a Realtime y a la sesión de Supabase', async () => {
    window.CapacitorDeviceAuth = nativeAuth({
      device_id: 'device-native-123',
      access_token: 'access-abc',
      refresh_token: 'refresh-xyz',
    });

    const token = await refreshNativeSession();

    expect(token).toBe('access-abc');
    expect(mocks.setAuth).toHaveBeenCalledWith('access-abc');
    expect(mocks.setSession).toHaveBeenCalledWith({
      access_token: 'access-abc',
      refresh_token: 'refresh-xyz',
    });
  });

  it('sin refresh_token no llama setSession (evita excepción del cliente)', async () => {
    window.CapacitorDeviceAuth = nativeAuth({
      device_id: 'device-native-123',
      access_token: 'access-solo',
    });

    const token = await refreshNativeSession();

    expect(token).toBe('access-solo');
    expect(mocks.setAuth).toHaveBeenCalledWith('access-solo');
    expect(mocks.setSession).not.toHaveBeenCalled();
  });

  it('sin sesión nativa devuelve null sin tocar Realtime', async () => {
    expect(await refreshNativeSession()).toBeNull();
    expect(mocks.setAuth).not.toHaveBeenCalled();
    expect(mocks.setSession).not.toHaveBeenCalled();
  });
});
