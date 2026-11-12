import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { addBreadcrumb, captureException, classifyError } from './sentry';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabaseConfig = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl !== 'https://your-project.supabase.co'
);

export const getNativeDeviceAuth = () => {
  try {
    if (typeof window !== 'undefined' && window.CapacitorDeviceAuth?.getDeviceAuthJson) {
      const raw = window.CapacitorDeviceAuth.getDeviceAuthJson();
      if (raw && typeof raw === 'string') {
        const parsed = JSON.parse(raw);
        if (parsed.access_token) return parsed;
      }
    }
  } catch (e) {
    console.warn('Error leyendo autenticación nativa de Capacitor:', e);
  }
  return null;
};

export const getDeviceId = () => {
  const nativeAuth = getNativeDeviceAuth();
  if (nativeAuth?.device_id) {
    localStorage.setItem('gps_device_id', nativeAuth.device_id);
    return nativeAuth.device_id;
  }

  let deviceId = localStorage.getItem('gps_device_id');

  if (!deviceId) {
    const randomId = globalThis.crypto?.randomUUID?.() || Date.now();
    deviceId = `device-${randomId}`;
    localStorage.setItem('gps_device_id', deviceId);
  }

  return deviceId;
};

export const getStoredDeviceId = () => {
  const nativeAuth = getNativeDeviceAuth();
  if (nativeAuth?.device_id) return nativeAuth.device_id;
  return localStorage.getItem('gps_device_id');
};

const nativeAuth = getNativeDeviceAuth();
let currentNativeToken = nativeAuth?.access_token || null;

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // Bug #8: En móviles, usar localStorage causa carreras con Native y guarda en plano
        persistSession: !Capacitor.isNativePlatform(),
        autoRefreshToken: true,
      },
      global: {
        fetch: (url, options) => {
          if (currentNativeToken) {
            options = options || {};
            options.headers = options.headers || new Headers();
            if (options.headers instanceof Headers) {
              options.headers.set('Authorization', `Bearer ${currentNativeToken}`);
            } else {
              options.headers['Authorization'] = `Bearer ${currentNativeToken}`;
            }
          }
          return fetch(url, options);
        },
      },
    })
  : null;

export const setNativeAuthToken = (token) => {
  currentNativeToken = token;
  if (supabase) {
    if (supabase.realtime) {
      try { supabase.realtime.setAuth(token); } catch {}
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('native-auth-changed', { detail: { token } }));
  }
};

if (typeof window !== 'undefined') {
  window.setNativeAuthToken = setNativeAuthToken;
}

export const refreshNativeSession = async () => {
  const freshNative = getNativeDeviceAuth();
  if (freshNative?.access_token) {
    currentNativeToken = freshNative.access_token;

    if (supabase) {
      // Configurar el Realtime
      if (supabase.realtime) {
        try { supabase.realtime.setAuth(freshNative.access_token); } catch {}
      }

      // Solo invocar setSession si se dispone de un refresh_token válido para evitar excepciones del cliente Supabase JS
      if (freshNative.refresh_token && typeof freshNative.refresh_token === 'string' && freshNative.refresh_token.trim() !== '') {
        try {
          await supabase.auth.setSession({
            access_token: freshNative.access_token,
            refresh_token: freshNative.refresh_token,
          });
        } catch (err) {
          console.warn('Error al actualizar la sesión de Supabase con refresh_token:', err);
          captureException(err, { context: 'refreshNativeSession.setSession' });
        }
      }
    }

    return freshNative.access_token;
  }
  return null;
};

/**
 * Objeto de dependencias internas. Al exponerlo como export, vi.mock puede
 * reemplazar sus propiedades y withAuthRetry usará la versión mockeada.
 */
export const _deps = {
  refreshNativeSession,
};


export const withAuthRetry = async (queryFn, context = 'withAuthRetry') => {
  try {
    const res = await queryFn();
    // El status HTTP viene en res.error.status, no en res.status (que no existe en Supabase JS).
    if ((res?.error && res.error?.status === 401) || String(res?.error?.message || '').includes('JWT')) {
      addBreadcrumb({
        category: 'auth',
        message: `withAuthRetry: error ${res.error?.status || 'JWT'} detectado, renovando token`,
        level: 'warning',
        data: { status: res.error?.status, errorMessage: res.error?.message },
      });
      // Llamamos a través de _deps para que vi.mock pueda interceptarlo en tests.
      const newToken = await _deps.refreshNativeSession();
      if (newToken) {
        return await queryFn();
      }
      // No se pudo renovar: reportar el error original.
      captureException(new Error(`withAuthRetry: token refresh falló (error original: ${res.error?.message})`), {
        category: classifyError(res.error),
        originalStatus: res.error?.status,
      });
    }
    return res;
  } catch (err) {
    if (err?.status === 401 || String(err?.message || '').includes('JWT')) {
      addBreadcrumb({
        category: 'auth',
        message: `withAuthRetry: excepción ${err?.status || 'JWT'} capturada, renovando token`,
        level: 'warning',
      });
      const newToken = await _deps.refreshNativeSession();
      if (newToken) {
        try {
          return await queryFn();
        } catch (retryError) {
          captureException(retryError, {
            context,
            category: classifyError(retryError),
            afterAuthRetry: true,
          });
          throw retryError;
        }
      }
    }
    captureException(err, { context, category: classifyError(err) });
    throw err;
  }
};

export const setupAuthSync = () => {
  if (!supabase) return () => {};
  
  if (nativeAuth?.access_token) {
    refreshNativeSession().catch((err) => console.warn('No se pudo establecer la sesión Supabase nativa inicial:', err));
  }

  if (typeof window === 'undefined') return () => {};

  const interval = window.setInterval(() => {
    refreshNativeSession();
  }, 5 * 60 * 1000);

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      refreshNativeSession();
    }
  };

  window.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    window.clearInterval(interval);
    window.removeEventListener('visibilitychange', handleVisibilityChange);
  };
};

if (!hasSupabaseConfig) {
  console.warn('Supabase no configurado. La app usará modo local/fallback.');
}