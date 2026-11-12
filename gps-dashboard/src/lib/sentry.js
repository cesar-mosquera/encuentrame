/**
 * Sentry — inicialización y helpers de observabilidad.
 *
 * Se importa como singleton desde main.jsx (antes de React) y desde cualquier
 * módulo que necesite reportar errores o breadcrumbs.
 *
 * Reglas de PII:
 *   - device_id  → SÍ se envía (identifica el dispositivo, no al usuario).
 *   - access_token, refresh_token → NUNCA se envían.
 */
import * as SentryCapacitor from '@sentry/capacitor';
import * as Sentry from '@sentry/react';
import { Capacitor } from '@capacitor/core';

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN || '';
const IS_DEV = import.meta.env.DEV;

/** true cuando Sentry está realmente inicializado (DSN válido + producción). */
let _initialized = false;

/**
 * Inicializa Sentry. Llamar UNA vez en main.jsx, antes de createRoot.
 * En desarrollo (DEV=true) no envía eventos a menos que VITE_SENTRY_DSN esté
 * explícitamente configurado (útil para probar la integración en local).
 */
export function initSentry() {
  if (_initialized) return;
  if (!SENTRY_DSN) {
    if (!IS_DEV) {
      console.warn('[Sentry] VITE_SENTRY_DSN no configurado. Los errores no se reportarán.');
    }
    return;
  }

  SentryCapacitor.init({
    dsn: SENTRY_DSN,
    environment: IS_DEV ? 'development' : 'production',
    // En desarrollo capturar todo; en producción solo errores (sin breadcrumbs de debug).
    tracesSampleRate: IS_DEV ? 1.0 : 0.2,
    // No enviar eventos puramente de desarrollo.
    enabled: !IS_DEV || Boolean(SENTRY_DSN),
    enableNative: true,
    enableNativeNagger: false,

    integrations: [
      Sentry.browserTracingIntegration(),
      // Captura errores no manejados de promesas.
      Sentry.globalHandlersIntegration({ onerror: true, onunhandledrejection: true }),
    ],

    beforeSend(event) {
      // Limpiar PII: eliminar tokens de cualquier campo de datos extra.
      scrubPII(event);
      return event;
    },

    beforeBreadcrumb(breadcrumb) {
      // Filtrar breadcrumbs de XHR/fetch a Sentry mismo para evitar recursión.
      if (breadcrumb.category === 'xhr' || breadcrumb.category === 'fetch') {
        if (breadcrumb.data?.url?.includes('sentry.io')) return null;
      }
      return breadcrumb;
    },
  }, Sentry.init);

  // Contexto global: plataforma (web/android/ios).
  Sentry.setTag('platform', Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web');

  _initialized = true;
}

// ─── Helpers públicos ────────────────────────────────────────────────────────

/**
 * Asocia el device_id al usuario de Sentry para filtrar eventos por dispositivo.
 */
export function setDeviceUser(deviceId) {
  if (!_initialized || !deviceId) return;
  Sentry.setUser({ id: deviceId });
}

/**
 * Captura una excepción con contexto opcional.
 * @param {Error}  error
 * @param {Object} [context]  — pares clave-valor que se adjuntan al evento.
 */
export function captureException(error, context) {
  if (!_initialized) {
    console.error('[Sentry:offline]', error, context);
    return;
  }
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

/**
 * Captura un mensaje informativo o de advertencia.
 */
export function captureMessage(message, level = 'info') {
  if (!_initialized) {
    console.log(`[Sentry:offline:${level}]`, message);
    return;
  }
  Sentry.captureMessage(message, level);
}

/**
 * Añade un breadcrumb (migaja) al trail del usuario.
 * Útil para reconstruir la secuencia de acciones antes de un crash.
 */
export function addBreadcrumb(crumb) {
  if (!_initialized) return;
  Sentry.addBreadcrumb(crumb);
}

/**
 * Clasifica un error de Supabase/red en una categoría legible.
 * @returns {'auth'|'network'|'constraint'|'server'|'unknown'}
 */
export function classifyError(error) {
  if (!error) return 'unknown';
  const status = error?.status || error?.code;
  const msg = String(error?.message || '').toLowerCase();

  if (status === 401 || msg.includes('jwt') || msg.includes('unauthorized')) return 'auth';
  if (msg.includes('fetch') || msg.includes('network') || msg.includes('failed to fetch') || msg.includes('aborterror')) return 'network';
  if (msg.includes('violates check constraint') || msg.includes('duplicate key') || msg.includes('not-null')) return 'constraint';
  if (Number(status) >= 500) return 'server';
  return 'unknown';
}

// ─── Re-exportar ErrorBoundary de Sentry ─────────────────────────────────────

/**
 * ErrorBoundary de Sentry que captura errores de renderizado de React.
 * Se usa como wrapper en App.jsx. Si Sentry no está inicializado, se
 * comporta como un ErrorBoundary básico.
 */
export const SentryErrorBoundary = Sentry.ErrorBoundary;

// ─── Internas ────────────────────────────────────────────────────────────────

/** Elimina tokens de los extras/tags de un evento. */
function scrubPII(event) {
  const sensitiveKeys = ['access_token', 'refresh_token', 'authorization', 'password', 'secret'];
  const scrub = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      if (sensitiveKeys.some(s => key.toLowerCase().includes(s))) {
        obj[key] = '[FILTERED]';
      } else if (typeof obj[key] === 'object') {
        scrub(obj[key]);
      }
    }
  };
  scrub(event.extra);
  scrub(event.contexts);
  if (event.request?.headers) {
    scrub(event.request.headers);
  }
}
