package com.gps.tracker;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.SystemClock;
import android.util.Log;
import android.app.NotificationManager;
import android.app.NotificationChannel;
import androidx.core.app.NotificationCompat;

/**
 * Se registra para BOOT_COMPLETED, USER_UNLOCKED y MY_PACKAGE_REPLACED.
 *
 * El tracking en background ya no depende del WebView de Capacitor (que solo
 * funciona si hay Activity viva), sino de NativeTrackingService, un
 * ForegroundService de tipo location. Es la unica via que Android permite arrancar
 * desde BOOT_COMPLETED sin violar las restricciones de background activity launch.
 */
public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "BootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !"android.intent.action.USER_UNLOCKED".equals(action)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            Log.w(TAG, "Omitiendo broadcast no reconocido en BootReceiver: " + action);
            return;
        }

        if (intent.getPackage() != null && !context.getPackageName().equals(intent.getPackage())) {
            Log.w(TAG, "Omitiendo intent en BootReceiver dirigido a paquete no autorizado: " + intent.getPackage());
            return;
        }

        // Deduplicación: ignorar eventos duplicados en ventana de 10s
        Context safeContext = context;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            safeContext = context.createDeviceProtectedStorageContext();
        }
        SharedPreferences bootPrefs = safeContext.getSharedPreferences("gps_boot_prefs", Context.MODE_PRIVATE);
        long lastHandled = bootPrefs.getLong("last_boot_handled_ms", 0L);
        long now = System.currentTimeMillis();
        if (now - lastHandled < 10_000L) {
            Log.d(TAG, "Omitiendo evento de arranque duplicado en ventana de 10s: " + action);
            return;
        }
        bootPrefs.edit().putLong("last_boot_handled_ms", now).commit();

        Log.i(TAG, "Reinicio o desbloqueo detectado (" + action + "); validando credenciales.");
        try {
            android.os.UserManager userManager = (android.os.UserManager) context.getSystemService(Context.USER_SERVICE);
            if (userManager != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && !userManager.isUserUnlocked()) {
                Log.w(TAG, "Dispositivo bloqueado (Direct Boot). Esperando ACTION_USER_UNLOCKED para leer credenciales.");
                return;
            }

            DeviceAuthManager authManager = new DeviceAuthManager(context);
            if (!authManager.hasCredentials() || authManager.isRevoked()) {
                Log.w(TAG, "Dispositivo sin credenciales o revocado. Se pospone arranque automático.");
                return;
            }

            if (!authManager.isProvisioned()) {
                long nextRetrySec = authManager.getNextAuthRetrySeconds();
                long nowSec = System.currentTimeMillis() / 1000;
                long delayMs = Math.max(1000L, (nextRetrySec - nowSec) * 1000L);
                Log.w(TAG, "Dispositivo en ventana de reintento de autenticación. Programando alarma de recuperación en " + (delayMs / 1000) + "s.");
                scheduleRecoveryAlarm(context, delayMs);
                return;
            }

            if (!PermissionUtils.hasRequiredTrackingPermissions(context)) {
                Log.w(TAG, "Permisos de ubicación insuficientes tras el arranque. Marcando pending_perm_prompt=true.");
                context.getSharedPreferences("gps_app_prefs", Context.MODE_PRIVATE)
                        .edit().putBoolean("pending_perm_prompt", true).commit();
                showMissingPermissionNotification(context);
                return;
            }

            // Arranca el rastreo nativo. Abrir MainActivity desde aqui NO es una
            // alternativa valida: Android 10+ bloquea el background activity launch
            // y el bloqueo no lanza excepcion, asi que el intento reportaria exito sin
            // hacer nada. Un ForegroundService de tipo location si puede iniciarse
            // desde BOOT_COMPLETED.
            NativeTrackingService.startNativeTracking(context);
            Log.i(TAG, "NativeTrackingService lanzado tras reinicio.");

        } catch (Exception e) {
            Log.e(TAG, "Excepción en BootReceiver al lanzar MainActivity: " + e.getMessage(), e);
            // Programar reintento en 30s si hubo un error inesperado
            scheduleRecoveryAlarm(context, 30_000L);
        }

    }

    private void showMissingPermissionNotification(Context context) {
        try {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            String channelId = "recovery_channel";
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel channel = new NotificationChannel(channelId, "Recuperación de Rastreo", NotificationManager.IMPORTANCE_HIGH);
                nm.createNotificationChannel(channel);
            }
            
            Intent intent = new Intent(context, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT : PendingIntent.FLAG_UPDATE_CURRENT;
            PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, intent, flags);
            
            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
                    .setSmallIcon(android.R.drawable.ic_dialog_alert)
                    .setContentTitle("Rastreo Detenido")
                    .setContentText("Toca aquí para otorgar los permisos necesarios de ubicación en segundo plano.")
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setAutoCancel(true)
                    .setContentIntent(pendingIntent);
            
            nm.notify(1001, builder.build());
        } catch (Exception e) {
            Log.e(TAG, "Error mostrando notificación de permisos", e);
        }
    }

    private void scheduleRecoveryAlarm(Context context, long delayMs) {
        try {
            Intent recoveryIntent = new Intent(context, AlarmRecoveryReceiver.class);
            recoveryIntent.setAction(AlarmRecoveryReceiver.ACTION_RECOVER_SERVICE);
            recoveryIntent.setPackage(context.getPackageName());
            PendingIntent pendingIntent = PendingIntent.getBroadcast(
                    context, 42, recoveryIntent,
                    PendingIntent.FLAG_ONE_SHOT | PendingIntent.FLAG_IMMUTABLE);
            AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (alarmManager != null) {
                long triggerAt = SystemClock.elapsedRealtime() + delayMs;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    if (alarmManager.canScheduleExactAlarms()) {
                        long triggerAtRtc = System.currentTimeMillis() + delayMs;
                        AlarmManager.AlarmClockInfo info = new AlarmManager.AlarmClockInfo(triggerAtRtc, null);
                        alarmManager.setAlarmClock(info, pendingIntent);
                    } else {
                        alarmManager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pendingIntent);
                    }
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmManager.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pendingIntent);
                } else {
                    alarmManager.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pendingIntent);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error programando alarma de recuperación desde BootReceiver", e);
        }
    }
}
