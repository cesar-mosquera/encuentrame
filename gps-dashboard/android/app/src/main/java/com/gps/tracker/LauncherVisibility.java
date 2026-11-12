package com.gps.tracker;

import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.util.Log;

/**
     * Oculta el icono del cajon de aplicaciones una vez que el dispositivo queda
     * configurado, sin interrumpir nada de lo que ya funciona.
 *
 * Que solo desaparezca el icono no basta para que la app "no se duerma": lo que la
 * mantiene viva es el foreground service del plugin, el watchdog y el arranque tras
 * reboot. Ninguno de esos depende del componente del cajon, asi que desactivarlo no
 * afecta al rastreo.
 *
 * Por que se desactiva el alias y no MainActivity: el icono del cajon lo genera el
 * unico filtro MAIN + LAUNCHER, que vive en el activity-alias .LauncherAlias. La
 * Activity conserva, ademas, MAIN + CATEGORY_INFO, los deep links y el contentIntent
 * de la notificacion. Desactivar MainActivity dejaria esos tres caminos rotos con
 * ActivityNotFoundException, entre ellos el arranque de BootReceiver que sostiene el
 * tracking tras un reinicio.
 *
 * Vias de vuelta al icono, todas necesarias porque ocultar deja la app sin entrada
 * en el cajon:
 *   - sync() en cada onResume, que restaura el icono si el propietario revocó un
 *     permiso o la app perdio el aprovisionamiento.
 *   - deep link https://app.gpstracker.com/activate?icon=show.
 *   - el toque en la notificacion de tracking, que sigue resolviendo via MAIN +
 *     CATEGORY_INFO aunque el alias este desactivado.
 *
 * El estado se persiste en el PackageManager (sobrevive a reinicios y a
 * MY_PACKAGE_REPLACED). La preferencia solo evita repetir la llamada en cada resume.
 */
public final class LauncherVisibility {

    private static final String TAG = "LauncherVisibility";

    /** Debe coincidir con android:name del activity-alias en el manifest. */
    private static final String ALIAS_CLASS = "com.gps.tracker.LauncherAlias";

    private static final String PREFS = "gps_app_prefs";
    private static final String KEY_LAUNCHER_HIDDEN = "launcher_hidden_v1";

    private LauncherVisibility() {
    }

    private static ComponentName alias(Context context) {
        return new ComponentName(context.getPackageName(), ALIAS_CLASS);
    }

    public static boolean isHidden(Context context) {
        if (context == null) return false;
        try {
            int state = context.getPackageManager().getComponentEnabledSetting(alias(context));
            return state == PackageManager.COMPONENT_ENABLED_STATE_DISABLED
                    || state == PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER;
        } catch (Exception e) {
            Log.w(TAG, "No se pudo leer el estado del alias de launcher", e);
            return false;
        }
    }

    /**
     * DONT_KILL_APP es obligatorio: sin el, desactivar un componente puede matar el
     * proceso que aloja el foreground service de geolocalizacion.
     */
    public static void hide(Context context) {
        applyState(context, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, true);
    }

    public static void show(Context context) {
        applyState(context, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, false);
    }

    private static void applyState(Context context, int state, boolean hidden) {
        if (context == null) return;
        // Sin DONT_KILL_APP el sistema puede matar el proceso del foreground service.
        int flags = PackageManager.DONT_KILL_APP;
        try {
            context.getPackageManager().setComponentEnabledSetting(alias(context), state, flags);
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putBoolean(KEY_LAUNCHER_HIDDEN, hidden)
                    .commit();
            Log.i(TAG, hidden
                    ? "Alias del launcher desactivado: icono oculto, rastreo intacto."
                    : "Alias del launcher reactivado: icono restaurado.");
        } catch (Exception e) {
            Log.w(TAG, "No se pudo cambiar el estado del alias del launcher", e);
        }
    }

    /**
     * Sincroniza el icono con el estado real del dispositivo. Solo actua al cruzar la
     * frontera de "configurado", para no escribir en el PackageManager en cada resume.
     *
     * El icono reaparece si el propietario revoca un permiso o la app pierde el
     * aprovisionamiento, que son los casos en los que el usuario necesita poder abrir
     * la app para arreglarlo.
     */
    public static void sync(Context context) {
        if (context == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        boolean hidden = prefs.getBoolean(KEY_LAUNCHER_HIDDEN, false);
        boolean configured = isFullyConfigured(context);
        if (configured && !hidden) {
            hide(context);
        } else if (!configured && hidden) {
            show(context);
        }
        if (!configured) {
            notifyMissingRequirements(context);
        }
    }

    private static void notifyMissingRequirements(Context context) {
        try {
            android.app.NotificationManager manager =
                    (android.app.NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) return;
            String channelId = "gps_permisos";
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                android.app.NotificationChannel channel = new android.app.NotificationChannel(
                        channelId, "Permisos GPS Tracker", android.app.NotificationManager.IMPORTANCE_HIGH);
                channel.setDescription("Avisos cuando faltan permisos para el rastreo.");
                manager.createNotificationChannel(channel);
            }
            android.content.Intent launch = new android.content.Intent(context, MainActivity.class);
            launch.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK | android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP);
            int flags = android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M
                    ? android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_UPDATE_CURRENT
                    : android.app.PendingIntent.FLAG_UPDATE_CURRENT;
            android.app.PendingIntent content = android.app.PendingIntent.getActivity(context, 1, launch, flags);

            java.util.List<String> faltantes = new java.util.ArrayList<>();
            if (!PermissionUtils.hasFineLocationPermission(context)) faltantes.add("ubicación precisa");
            if (!PermissionUtils.hasBackgroundLocationPermission(context)) faltantes.add("ubicación en segundo plano");
            if (!PermissionUtils.hasNotificationPermission(context)) faltantes.add("notificaciones");
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                android.os.PowerManager pm = (android.os.PowerManager) context.getSystemService(Context.POWER_SERVICE);
                if (pm != null && !pm.isIgnoringBatteryOptimizations(context.getPackageName())) {
                    faltantes.add("ignorar optimización de batería");
                }
            }
            String texto;
            try {
                texto = new DeviceAuthManager(context).isProvisioned() ? null : "aprovisionamiento";
            } catch (Exception e) {
                texto = "aprovisionamiento";
            }
            if (texto != null) faltantes.add(texto);

            androidx.core.app.NotificationCompat.Builder builder =
                    new androidx.core.app.NotificationCompat.Builder(context, channelId)
                            .setContentTitle("GPS Tracker necesita atención")
                            .setContentText(faltantes.isEmpty()
                                    ? "Toca para abrir y completar la configuración."
                                    : "Faltan: " + android.text.TextUtils.join(", ", faltantes) + ". Toca para configurar.")
                            .setSmallIcon(android.R.drawable.ic_dialog_alert)
                            .setPriority(androidx.core.app.NotificationCompat.PRIORITY_HIGH)
                            .setAutoCancel(true)
                            .setContentIntent(content);
            manager.notify(9001, builder.build());
        } catch (Exception e) {
            Log.w(TAG, "No se pudo notificar permisos faltantes", e);
        }
    }

    /**
     * Exige los tres permisos que el rastreo continuo necesita, no solo los que
     * comprueba PermissionUtils.hasRequiredTrackingPermissions: esa omite el
     * ACCESS_BACKGROUND_LOCATION, que es justamente el que permite seguir reportando
     * con la pantalla apagada. Ademas exige aprovisionamiento, porque sin credenciales
     * no hay nada que rastrear y la app sigue siendo una pantalla de onboarding.
     */
    public static boolean isFullyConfigured(Context context) {
        if (context == null) return false;
        if (!PermissionUtils.hasFineLocationPermission(context)) return false;
        if (!PermissionUtils.hasBackgroundLocationPermission(context)) return false;
        if (!PermissionUtils.hasNotificationPermission(context)) return false;
        
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            android.os.PowerManager pm = (android.os.PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(context.getPackageName())) {
                return false;
            }
        }

        try {
            return new DeviceAuthManager(context).isProvisioned();
        } catch (Exception e) {
            Log.w(TAG, "No se pudo leer el estado de aprovisionamiento", e);
            return false;
        }
    }
}