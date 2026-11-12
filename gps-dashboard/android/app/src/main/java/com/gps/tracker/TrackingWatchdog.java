package com.gps.tracker;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.SystemClock;
import android.util.Log;

/**
 * Watchdog de seguimiento en background.
 *
 * Hay DOS caminos de rastreo y este watchdog los cubre a los dos:
 *
 * 1. Con la app abierta, el WebView registra un watcher en
 *    @capacitor-community/background-geolocation.
 * 2. Sin WebView (tras un reinicio, con la app en background o en Doze), el
 *    seguimiento lo sostiene NativeTrackingService, un foreground service propio
 *    de tipo location que no depende del plugin.
 *
 * Si Android mata cualquiera de los dos procesos, el started service NO se
 * reinicia solo y el dispositivo quedaría sin reportar posición hasta que el
 * usuario abra la app. Para acortar esa ventana, este watchdog programa una alarma
 * exacta que, cuando detecta el seguimiento muerto, lanza AlarmRecoveryReceiver,
 * que a su vez rearrange NativeTrackingService (nunca una Activity: ver abajo).
 *
 * Por qué una alarma EXACTA: en Android 10+ una app no puede lanzar Activities
 * desde background, pero las alarmas setExactAndAllowWhileIdle/setAndAllowWhileIdle
 * conceden un Power Allowlist temporal. Es la misma razón por la que el manifest
 * declara SCHEDULE_EXACT_ALARM.
 *
 * Nótese que el allowlist ya no es lo que habilita el relanzamiento: el receptor
 * arranca un foreground service, no una Activity. La versión anterior de este
 * watchdog sí relanzaba MainActivity, y en Android 10+ esa llamada se descartaba
 * en silencio cuando el proceso no estaba en foreground: el watchdog "funcionaba"
 * sin recuperar nunca el rastreo. La alarma exacta se conserva porque mantiene el
 * dispositivo despierto para que el servicio arranque antes de que el sistema lo
 * vuelva a suspender.
 *
 * El watchdog se arma SOLO cuando el rastreo está confirmado como activo, ya sea
 * por el WebView (setTrackingEnabled(true)) o por NativeTrackingService, para no
 * despertar el dispositivo cada 15 minutos en dispositivos que nunca han iniciado
 * el rastreo.
 */
public final class TrackingWatchdog {

    private static final String TAG = "TrackingWatchdog";

    /** Acción del broadcast que dispara la comprobación de salud. */
    public static final String ACTION_WATCHDOG_CHECK = "com.gps.tracker.ACTION_WATCHDOG_CHECK";

    private static final String PREFS = "gps_tracking_state";
    private static final String KEY_TRACKING_ENABLED = "tracking_enabled";
    private static final String KEY_LAST_HEARTBEAT_MS = "last_heartbeat_ms";
    private static final int REQUEST_CODE = 77;

    /** Cadencia de la comprobación. */
    public static final long WATCHDOG_INTERVAL_MS = 15L * 60L * 1000L;

    /**
     * Margen de gracia sobre la cadencia: si el último heartbeat es más viejo que
     * esto, el servicio se considera muerto. Debe ser MAYOR que el intervalo, para
     * tolerar Doze y un arranque lento.
     */
    public static final long STALE_AFTER_MS = 25L * 60L * 1000L;

    private TrackingWatchdog() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Llamado desde el webview cuando el watcher se registra o se detiene. */
    public static void setTrackingEnabled(Context context, boolean enabled) {
        prefs(context).edit()
                .putBoolean(KEY_TRACKING_ENABLED, enabled)
                .putLong(KEY_LAST_HEARTBEAT_MS, System.currentTimeMillis())
                .commit();
        if (enabled) {
            Log.i(TAG, "Seguimiento activo: armando watchdog cada " + (WATCHDOG_INTERVAL_MS / 60000) + " min.");
            schedule(context);
        } else {
            Log.i(TAG, "Seguimiento detenido: cancelando watchdog.");
            cancel(context);
        }
    }

    /** Llamado desde el callback de ubicación del plugin mientras el servicio vive. */
    public static void heartbeat(Context context) {
        prefs(context).edit()
                .putLong(KEY_LAST_HEARTBEAT_MS, System.currentTimeMillis())
                .apply();
    }

    public static boolean isTrackingEnabled(Context context) {
        return prefs(context).getBoolean(KEY_TRACKING_ENABLED, false);
    }

    /**
     * El seguimiento se considera vivo solo si está habilitado y el servicio de
     * foreground ha reportado posición dentro del margen de gracia.
     */
    public static boolean isAlive(Context context) {
        SharedPreferences p = prefs(context);
        if (!p.getBoolean(KEY_TRACKING_ENABLED, false)) return true; // nada que vigilar
        long last = p.getLong(KEY_LAST_HEARTBEAT_MS, 0L);
        long age = System.currentTimeMillis() - last;
        return age <= STALE_AFTER_MS;
    }

    static void schedule(Context context) {
        try {
            AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (alarmManager == null) return;

            PendingIntent pendingIntent = pendingIntent(context);
            long triggerAt = SystemClock.elapsedRealtime() + WATCHDOG_INTERVAL_MS;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (alarmManager.canScheduleExactAlarms()) {
                    alarmManager.setExactAndAllowWhileIdle(
                            AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pendingIntent);
                } else {
                    alarmManager.setAndAllowWhileIdle(
                            AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pendingIntent);
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setExactAndAllowWhileIdle(
                        AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pendingIntent);
            } else {
                alarmManager.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pendingIntent);
            }
            Log.d(TAG, "Watchdog programado para " + (WATCHDOG_INTERVAL_MS / 60000) + " min.");
        } catch (Exception e) {
            Log.e(TAG, "No se pudo programar el watchdog: " + e.getMessage(), e);
        }
    }

    static void cancel(Context context) {
        try {
            AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (alarmManager == null) return;
            alarmManager.cancel(pendingIntent(context));
            Log.d(TAG, "Watchdog cancelado.");
        } catch (Exception e) {
            Log.e(TAG, "No se pudo cancelar el watchdog: " + e.getMessage(), e);
        }
    }

    private static PendingIntent pendingIntent(Context context) {
        Intent intent = new Intent(context, AlarmRecoveryReceiver.class);
        intent.setAction(ACTION_WATCHDOG_CHECK);
        intent.setPackage(context.getPackageName());
        return PendingIntent.getBroadcast(
                context, REQUEST_CODE, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
