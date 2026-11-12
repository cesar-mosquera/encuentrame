package com.gps.tracker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;


/**
 * Receptor de transmisión dedicado para alarmas de recuperación (Doze / reinicios).
 *
 * El tracking lo sostiene NativeTrackingService, un ForegroundService de tipo location
 * que no necesita Activity. Antes este receiver lanzaba MainActivity desde background,
 * algo que Android 10+ bloquea de forma silenciosa: el sistema registra "Background
 * activity launch blocked" en logcat y NO lanza excepcion, por lo que el codigo
 * reportaba "MainActivity lanzada exitosamente" mientras el rastreo seguia detenido.
 *
 * Este receiver usa PendingIntent.getBroadcast() porque Android 12+ (API 31+) puede
 * lanzar ForegroundServiceStartNotAllowedException al iniciar un FGS desde un
 * PendingIntent.getService() disparado en background.
 */
public class AlarmRecoveryReceiver extends BroadcastReceiver {
    private static final String TAG = "AlarmRecoveryReceiver";
    public static final String ACTION_RECOVER_SERVICE = "com.gps.tracker.ACTION_RECOVER_SERVICE";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (TrackingWatchdog.ACTION_WATCHDOG_CHECK.equals(action)) {
            handleWatchdogCheck(context);
            return;
        }
        if (!ACTION_RECOVER_SERVICE.equals(action)) return;
        Log.i(TAG, "Alarma de recuperación activada. Validando credenciales antes de reiniciar tracking.");
        try {
            android.os.UserManager userManager = (android.os.UserManager) context.getSystemService(Context.USER_SERVICE);
            if (userManager != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && !userManager.isUserUnlocked()) {
                Log.w(TAG, "Dispositivo bloqueado (Direct Boot). No se pueden leer credenciales desde alarma.");
                return;
            }

            DeviceAuthManager authManager = new DeviceAuthManager(context);
            if (!authManager.hasCredentials() || authManager.isRevoked()) {
                Log.w(TAG, "Dispositivo no provisionado o revocado. Abortando arranque desde alarma de recuperación.");
                return;
            }
            if (!PermissionUtils.hasRequiredTrackingPermissions(context)) {
                Log.w(TAG, "Permisos de ubicación insuficientes. Marcando pending_perm_prompt=true.");
                context.getSharedPreferences("gps_app_prefs", Context.MODE_PRIVATE)
                        .edit().putBoolean("pending_perm_prompt", true).commit();
                return;
            }

            NativeTrackingService.startNativeTracking(context);
            Log.i(TAG, "NativeTrackingService lanzado por la alarma de recuperacion.");
        } catch (Exception e) {
            Log.e(TAG, "Fallo al lanzar MainActivity desde AlarmRecoveryReceiver: " + e.getMessage(), e);
        }
    }

    /**
     * Comprobación periódica de salud del foreground service de geolocalización.
     *
     * Si el proceso murió con el servicio, no hay heartbeat reciente y hay que
     * relanzar MainActivity para que el plugin se vuelva a registrar. Si el servicio
     * sigue vivo, no se hace nada.
     */
    private void handleWatchdogCheck(Context context) {
        try {
            // Re-armar primero: setExactAndAllowWhileIdle es de un solo disparo, y
            // un fallo posterior no debe dejar el watchdog desarmado para siempre.
            if (TrackingWatchdog.isTrackingEnabled(context)) {
                TrackingWatchdog.schedule(context);
            }

            if (TrackingWatchdog.isAlive(context)) {
                Log.d(TAG, "Watchdog: seguimiento vivo (heartbeat reciente). Sin acción.");
                return;
            }

            Log.w(TAG, "Watchdog: sin heartbeat reciente. El servicio de rastreo murió; relanzandolo.");
            restartTracking(context, "watchdog_launch");
        } catch (Exception e) {
            Log.e(TAG, "Watchdog: fallo comprobando salud del seguimiento: " + e.getMessage(), e);
        }
    }

    /**
     * Recupera el rastreo tras una muerte del servicio.
     *
     * Antes esto relanzaba MainActivity. Android 10+ bloquea los background activity
     * launches y lo hace en silencio (solo un aviso en logcat), de modo que el codigo
     * creia haber recuperado el tracking cuando no habia recuperado nada. Se arranca
     * NativeTrackingService, que si esta permitido arrancar desde una alarma exacta.
     */
    private void restartTracking(Context context, String reason) {
        android.os.UserManager userManager =
                (android.os.UserManager) context.getSystemService(Context.USER_SERVICE);
        if (userManager != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && !userManager.isUserUnlocked()) {
            Log.w(TAG, "Dispositivo bloqueado (Direct Boot). El watchdog esperará al próximo ciclo.");
            return;
        }

        DeviceAuthManager authManager = new DeviceAuthManager(context);
        if (!authManager.hasCredentials() || authManager.isRevoked()) {
            Log.w(TAG, "Dispositivo no provisionado o revocado. Watchdog sin acción.");
            return;
        }
        if (!PermissionUtils.hasRequiredTrackingPermissions(context)) {
            Log.w(TAG, "Permisos de ubicación insuficientes. Marcando pending_perm_prompt=true.");
            context.getSharedPreferences("gps_app_prefs", Context.MODE_PRIVATE)
                    .edit().putBoolean("pending_perm_prompt", true).commit();
            return;
        }

        NativeTrackingService.startNativeTracking(context);
        Log.i(TAG, "NativeTrackingService relanzado por el watchdog (" + reason + ").");
    }
}
