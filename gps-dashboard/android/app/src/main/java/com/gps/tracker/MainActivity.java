package com.gps.tracker;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import android.widget.Toast;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MainActivity";
    private static final int LOCATION_PERMISSION_REQUEST = 42;
    private static final int BG_LOCATION_PERMISSION_REQUEST = 43;

    private final java.util.concurrent.ExecutorService activationExecutor = java.util.concurrent.Executors.newSingleThreadExecutor();
    private java.util.concurrent.Future<?> pendingActivationFuture = null;
    private volatile boolean isActivationInProgress = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setupWebviewBridge();
        maybeRestoreLauncherIcon(getIntent());
        boolean activationInProgress = processActivationIntent(getIntent());
        if (!activationInProgress) {
            startOnboardingSequence();
        }
        // Aprovisionar ya en el primer arranque (sin esperar a que la webview pida
        // el token) y lanzar el servicio nativo en cuanto haya credenciales. Sin esto,
        // tras reinstalar/borrar, isProvisioned() era false y el servicio nunca arrancaba.
        new Thread(() -> {
            try {
                DeviceAuthManager authManager = new DeviceAuthManager(getApplicationContext());
                String token = authManager.getAccessToken();
                if (token != null) {
                    Log.i(TAG, "Aprovisionamiento OK en arranque; iniciando rastreo nativo.");
                    NativeTrackingService.startNativeTracking(getApplicationContext());
                } else {
                    Log.w(TAG, "Aprovisionamiento no disponible aun: " + authManager.getNextAuthRetrySeconds());
                }
            } catch (Exception e) {
                Log.w(TAG, "Error en aprovisionamiento de arranque", e);
            }
        }, "boot-provisioning").start();
    }

    private void setupWebviewBridge() {
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().addJavascriptInterface(new DeviceAuthJavascriptInterface(), "CapacitorDeviceAuth");
            bridge.getWebView().addJavascriptInterface(new TrackingBridge(), "CapacitorTracking");
        }
    }

    /**
     * Puente que mantiene vivo el watchdog de seguimiento.
     *
     * El servicio de foreground del plugin corre en el proceso de la app y no se
     * reinicia solo si Android lo mata. El webview avisa cuándo registra el watcher
     * y con cada posición recibida, de modo que el watchdog nativo sabe distinguir
     * "el servicio está vivo" de "el proceso murió y hay que relanzar".
     */
    public class TrackingBridge {
        @android.webkit.JavascriptInterface
        public void setTrackingEnabled(boolean enabled) {
            if (enabled) {
                // El webview asume el envio de posiciones: el servicio nativo se apaga
                // para no duplicar muestras. Si el webview muere, los receivers del
                // watchdog vuelven a levantar el servicio nativo.
                NativeTrackingService.stopNativeTracking(MainActivity.this);
            }
            TrackingWatchdog.setTrackingEnabled(MainActivity.this, enabled);
            // Deliberadamente no se restaura aqui el icono: gpsTracker.start() llama
            // a stop() antes de arrancar, asi que este puente recibe false en cada
            // inicio y volver a mostrar el icono ahi lo haria parpadear.
        }

        @android.webkit.JavascriptInterface
        public void heartbeat() {
            TrackingWatchdog.heartbeat(MainActivity.this);
        }

        @android.webkit.JavascriptInterface
        public boolean isTrackingEnabled() {
            return TrackingWatchdog.isTrackingEnabled(MainActivity.this);
        }
    }

    public class DeviceAuthJavascriptInterface {
        @android.webkit.JavascriptInterface
        public String getDeviceAuthJson() {
            try {
                DeviceAuthManager authManager = new DeviceAuthManager(MainActivity.this);
                org.json.JSONObject obj = new org.json.JSONObject();
                obj.put("access_token", authManager.getAccessToken());
                obj.put("refresh_token", authManager.getRefreshToken());
                obj.put("device_id", authManager.getDeviceId());
                return obj.toString();
            } catch (Exception e) {
                Log.e(TAG, "Error generando DeviceAuthJson para Webview", e);
                return "{}";
            }
        }
    }



    @Override
    public void onResume() {
        super.onResume();
        if (isActivationInProgress) {
            return;
        }
        SharedPreferences appPrefs = getSharedPreferences("gps_app_prefs", MODE_PRIVATE);
        boolean pendingPermPrompt = appPrefs.getBoolean("pending_perm_prompt", false);
        boolean locationGranted = PermissionUtils.hasAnyLocationPermission(this);
        boolean notificationGranted = PermissionUtils.hasNotificationPermission(this);

        if (pendingPermPrompt) {
            if (locationGranted && notificationGranted) {
                startOnboardingSequence();
            }
        }
        LauncherVisibility.sync(this);

        boolean fromSystemTrigger = getIntent() != null &&
                (getIntent().getBooleanExtra("watchdog_launch", false)
                        || getIntent().getBooleanExtra("recovery_launch", false));
        if (!fromSystemTrigger && LauncherVisibility.isFullyConfigured(this)) {
            moveTaskToBack(true);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        maybeRestoreLauncherIcon(intent);
        processActivationIntent(intent);

        if (intent.getBooleanExtra("watchdog_launch", false) || intent.getBooleanExtra("recovery_launch", false)) {
            Log.i(TAG, "onNewIntent notificando a JS sobre watchdog/recovery_launch");
            if (bridge != null && bridge.getWebView() != null) {
                // Notificar a JS para que se despierte y procese, en lugar de forzar un mount (reload) costoso
                bridge.getWebView().evaluateJavascript("window.dispatchEvent(new CustomEvent('appRestored'));", null);
            }
        }
    }

    /**
     * Ancla de soporte para recuperar el icono: con el alias desactivado la app se
     * sigue abriendo por deep link, pero conviene un camino explicito e inequivoco
     * documentado para soporte (https://app.gpstracker.com/activate?icon=show).
     */
    private void maybeRestoreLauncherIcon(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data == null) return;
        String icon = data.getQueryParameter("icon");
        if ("show".equalsIgnoreCase(icon)) {
            LauncherVisibility.show(this);
        }
    }

    private synchronized boolean processActivationIntent(Intent intent) {
        if (intent == null) return false;
        String code = intent.getStringExtra("activation_code");
        if (code == null && intent.getData() != null) {
            Uri uri = intent.getData();
            code = uri.getQueryParameter("code");
            if (code == null) {
                code = uri.getQueryParameter("activation_code");
            }
            if (code == null) {
                String path = uri.getPath();
                if (path != null) {
                    if (path.contains("/activate/")) {
                        int idx = path.indexOf("/activate/");
                        code = path.substring(idx + "/activate/".length());
                        if (code.contains("/")) {
                            code = code.substring(0, code.indexOf('/'));
                        }
                    } else if (path.length() > 1) {
                        String lastSegment = uri.getLastPathSegment();
                        if (lastSegment != null && !"activate".equalsIgnoreCase(lastSegment)) {
                            code = lastSegment;
                        }
                    }
                }
            }
            if (code != null) {
                code = Uri.decode(code);
            }
        }
        if (code != null) {
            String trimmed = code.trim();
            if (isValidActivationCode(trimmed)) {
                DeviceAuthManager authManager = new DeviceAuthManager(getApplicationContext());
                authManager.setActivationCode(trimmed);
                String masked = maskCode(trimmed);
                Log.i(TAG, "Código de activación configurado desde Intent/DeepLink: " + masked + ". Reiniciando aprovisionamiento.");
                Toast.makeText(this, "Procesando código de activación: " + masked, Toast.LENGTH_SHORT).show();

                if (pendingActivationFuture != null && !pendingActivationFuture.isDone()) {
                    pendingActivationFuture.cancel(true);
                }
                isActivationInProgress = true;

                pendingActivationFuture = activationExecutor.submit(() -> {
                    try {
                        String token = authManager.getAccessToken();
                        if (Thread.currentThread().isInterrupted()) return;
                        if (token != null) {
                            Log.i(TAG, "Aprovisionamiento exitoso tras recepción de código de activación.");
                            safeRunOnUiThread(() -> {
                                Toast.makeText(MainActivity.this, "Dispositivo activado con éxito", Toast.LENGTH_SHORT).show();
                                if (bridge != null && bridge.getWebView() != null) {
                                    String jsCode = "var _retryAuth = function(t, c) { if (window.setNativeAuthToken) { window.setNativeAuthToken(t); } else if (c > 0) { setTimeout(function(){ _retryAuth(t, c-1); }, 500); } }; _retryAuth('" + token + "', 20);";
                                    bridge.getWebView().evaluateJavascript(jsCode, null);
                                }
                            });
                        } else {
                            Log.w(TAG, "Aprovisionamiento pendiente o fallido al procesar código.");
                        }
                    } finally {
                        isActivationInProgress = false;
                        safeRunOnUiThread(this::startOnboardingSequence);
                    }
                });
                return true;
            } else {
                Log.w(TAG, "Formato de código de activación rechazado por no cumplir requisitos de firma/longitud.");
            }
        }
        return false;
    }

    private void safeRunOnUiThread(Runnable action) {
        if (isFinishing() || isDestroyed()) {
            Log.w(TAG, "Omitiendo callback de UI sobre Activity destruida o finalizando.");
            return;
        }
        runOnUiThread(action);
    }


    private boolean isValidActivationCode(String code) {
        if (code == null || code.length() < 4 || code.length() > 64) return false;
        return code.matches("^[A-Za-z0-9_-]+$");
    }

    private String maskCode(String code) {
        if (code == null) return "****";
        if (code.length() <= 4) return "****";
        return code.substring(0, 2) + "****" + code.substring(code.length() - 2);
    }

    private void startOnboardingSequence() {
        SharedPreferences appPrefs = getSharedPreferences("gps_app_prefs", MODE_PRIVATE);
        boolean pendingPermPrompt = appPrefs.getBoolean("pending_perm_prompt", false);
        if (pendingPermPrompt) {
            appPrefs.edit().remove("pending_perm_prompt").commit();
            Toast.makeText(this, "El servicio de rastreo requiere permisos de ubicación y notificaciones para activarse.", Toast.LENGTH_LONG).show();
        }

        // Paso 1: Ubicación (precisa o aproximada) y notificaciones (primer plano)
        boolean locationGranted = PermissionUtils.hasAnyLocationPermission(this);

        boolean notificationGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;

        if (!locationGranted || !notificationGranted) {
            String[] perms;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                perms = new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.POST_NOTIFICATIONS};
            } else {
                perms = new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION};
            }
            ActivityCompat.requestPermissions(this, perms, LOCATION_PERMISSION_REQUEST);
            return;
        }

        // Paso 2: Ubicación en segundo plano (solicitud adaptada para Android 10 vs Android 11+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            boolean bgGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                    == PackageManager.PERMISSION_GRANTED;
            if (!bgGranted) {
                SharedPreferences prefs = getSharedPreferences("gps_app_prefs", MODE_PRIVATE);
                boolean bgPrompted = prefs.getBoolean("bg_loc_prompted_v2", false);
                if (!bgPrompted) {
                    prefs.edit().putBoolean("bg_loc_prompted_v2", true).commit();
                    Toast.makeText(this, "Para rastreo continuo en segundo plano, selecciona 'Permitir todo el tiempo'.", Toast.LENGTH_LONG).show();
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        try {
                            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                            intent.setData(Uri.parse("package:" + getPackageName()));
                            startActivity(intent);
                        } catch (Exception e) {
                            Log.w(TAG, "No se pudo abrir Ajustes para permiso de segundo plano en Android 11+", e);
                            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, BG_LOCATION_PERMISSION_REQUEST);
                        }
                    } else {
                        ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, BG_LOCATION_PERMISSION_REQUEST);
                    }
                    return;
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    boolean settingsPrompted = prefs.getBoolean("bg_loc_settings_prompted_v1", false);
                    if (!settingsPrompted) {
                        prefs.edit().putBoolean("bg_loc_settings_prompted_v1", true).commit();
                        Toast.makeText(this, "Por favor activa 'Permitir todo el tiempo' en Permisos -> Ubicación.", Toast.LENGTH_LONG).show();
                        try {
                            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                            intent.setData(Uri.parse("package:" + getPackageName()));
                            startActivity(intent);
                        } catch (Exception e) {
                            Log.w(TAG, "No se pudo abrir Ajustes de la aplicación", e);
                        }
                    }
                }
            }
        }

        // Paso 3: Exención de optimización de batería (secuencial sin solapar diálogos)
        requestBatteryOptimizationExemptionSequential();

        // Solo se llega aqui tras conceder ubicacion (incluido background) y
        // notificaciones: es el punto en que el dispositivo queda configurado y el
        // icono puede desaparecer sin dejar la app inaccesible.
        LauncherVisibility.sync(this);

        if (LauncherVisibility.isFullyConfigured(this)) {
            moveTaskToBack(true);
        }
    }

    private void requestBatteryOptimizationExemptionSequential() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                SharedPreferences prefs = getSharedPreferences("gps_app_prefs", MODE_PRIVATE);
                boolean prompted = prefs.getBoolean("battery_opt_prompted_v1", false);
                if (!prompted) {
                    try {
                        prefs.edit().putBoolean("battery_opt_prompted_v1", true).commit();
                        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                        intent.setData(Uri.parse("package:" + getPackageName()));
                        startActivity(intent);
                        
                        // Después de lanzar el oficial, lanzamos el OEM si existe y es diferente
                        requestOEMAutoStart();
                    } catch (Exception e) {
                        Log.w(TAG, "No se pudo solicitar exención de batería", e);
                        requestOEMAutoStart();
                    }
                }
            } else {
                // Si ya ignoramos optimizaciones de batería, verificamos si falta Autostart OEM
                SharedPreferences prefs = getSharedPreferences("gps_app_prefs", MODE_PRIVATE);
                boolean promptedOem = prefs.getBoolean("oem_autostart_prompted_v1", false);
                if (!promptedOem) {
                    requestOEMAutoStart();
                }
            }
        }
    }

    private void requestOEMAutoStart() {
        SharedPreferences prefs = getSharedPreferences("gps_app_prefs", MODE_PRIVATE);
        prefs.edit().putBoolean("oem_autostart_prompted_v1", true).commit();
        
        try {
            Intent[] intents = {
                new Intent().setComponent(new android.content.ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")),
                new Intent().setComponent(new android.content.ComponentName("com.letv.android.letvsafe", "com.letv.android.letvsafe.AutobootManageActivity")),
                new Intent().setComponent(new android.content.ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity")),
                new Intent().setComponent(new android.content.ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity")),
                new Intent().setComponent(new android.content.ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity")),
                new Intent().setComponent(new android.content.ComponentName("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity")),
                new Intent().setComponent(new android.content.ComponentName("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity")),
                new Intent().setComponent(new android.content.ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity")),
                new Intent().setComponent(new android.content.ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager")),
                new Intent().setComponent(new android.content.ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity")),
                new Intent().setComponent(new android.content.ComponentName("com.asus.mobilemanager", "com.asus.mobilemanager.entry.FunctionActivity")),
                new Intent().setComponent(new android.content.ComponentName("com.asus.mobilemanager", "com.asus.mobilemanager.autostart.AutoStartActivity")),
                new Intent().setComponent(new android.content.ComponentName("com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity")),
                new Intent().setComponent(new android.content.ComponentName("com.htc.pitroad", "com.htc.pitroad.landingpage.activity.LandingPageActivity")),
                new Intent().setComponent(new android.content.ComponentName("com.dewav.dwappmanager", "com.dewav.dwappmanager.memory.SmartCleanerActivity"))
            };

            for (Intent intent : intents) {
                if (getPackageManager().resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY) != null) {
                    Toast.makeText(this, "Por favor permite el Inicio Automático para el GPS", Toast.LENGTH_LONG).show();
                    startActivity(intent);
                    break;
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error lanzando OEM Autostart", e);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == LOCATION_PERMISSION_REQUEST) {
            boolean locationGranted = PermissionUtils.hasAnyLocationPermission(this);
            if (locationGranted) {
                startOnboardingSequence();
            } else {
                Toast.makeText(this, "Se requiere permiso de ubicación para activar el rastreo GPS.", Toast.LENGTH_LONG).show();
            }
        } else if (requestCode == BG_LOCATION_PERMISSION_REQUEST) {
            boolean bgGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                    == PackageManager.PERMISSION_GRANTED;
            if (bgGranted) {
                Toast.makeText(this, "Seguimiento en segundo plano activado.", Toast.LENGTH_SHORT).show();
            } else {
                Toast.makeText(this, "Seguimiento en segundo plano limitado. Abrir Ajustes si requieres rastreo continuo.", Toast.LENGTH_LONG).show();
            }
            startOnboardingSequence();
        }
    }

    @Override
    public void onDestroy() {
        if (pendingActivationFuture != null) {
            pendingActivationFuture.cancel(true);
        }
        activationExecutor.shutdownNow();
        super.onDestroy();
    }
}
