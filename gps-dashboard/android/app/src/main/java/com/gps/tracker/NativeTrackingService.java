package com.gps.tracker;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.BatteryManager;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Rastreo GPS nativo en foreground, independiente del WebView.
 *
 * POR QUE EXISTE
 * El tracking de este proyecto quedo atado al plugin
 * @capacitor-community/background-geolocation, que solo funciona con el WebView de
 * Capacitor vivo: sus watchers se registran desde JS. Tras un reinicio o un Doze que
 * mata el proceso, el plugin no registra nada.
 *
 * Y la unica via que quedaba para "volver a arrancar" era abrir MainActivity desde
 * background, lo cual Android 10+ (API 29+) BLOQUEA: el sistema concede excepcion de
 * background activity launch a apps CON activity en una task visible o que el usuario
 * acaba de interactuar, no a una app que solo tiene un foreground service. El bloqueo
 * ademas NO lanza excepcion: se registra "Background activity launch blocked" en logcat,
 * de modo que el codigo que lo intentaba reportaba exito mientras no ocurria nada.
 *
 * Este servicio elimina esa dependencia: es un ForegroundService de tipo location, que
 * Android SI permite arrancar desde BOOT_COMPLETED, y envia las posiciones a Supabase
 * por REST con el JWT del dispositivo.
 *
 * COORDINACION CON EL WEBVIEW
 * Solo uno de los doswege debe enviar posicion; si ambos lo hacen se duplican las
 * muestras. Cuando MainActivity arranca y el webview registra su watcher, este servicio
 * se detiene (MainActivity.TrackingBridge.setTrackingEnabled(true)) y el webview queda
 * como unico emisor. Cuando el webview muere, los receivers vuelven a levantar este
 * servicio. Ambos caminos usan el MISMO event_id determinista, asi que aunque haya un
 * solape de unos segundos, el upsert con onConflict + ignoreDuplicates lo absorbe.
 */
public class NativeTrackingService extends Service {

    private static final String TAG = "NativeTracking";
    private static final String CHANNEL_ID = "native_tracking_channel";
    private static final int NOTIFICATION_ID = 28352;
    private static final int REQUEST_HEARTBEAT = 4242;

    /** Cadencia de muestreo. 15s mantiene el watchdog con vida aun con el vehiculo parado. */
    private static final long LOCATION_INTERVAL_MS = 15_000L;
    /** Techo de la cola offline en disco. Ver loadQueue(). */
    private static final int MAX_QUEUE = 1000;

    private static final String PREFS = "gps_native_tracking";
    private static final String KEY_ACTIVE = "native_tracking_active";

    private FusedLocationProviderClient fusedClient;
    private LocationCallback locationCallback;
    private DeviceAuthManager authManager;

    /** Ultimo instante en que se publico una posicion correcta: cuts heartbeats falsos. */
    private volatile long lastSuccessMs = 0L;

    private final Object queueLock = new Object();

    /**
     * Red en hilo propio.
     *
     * LocationCallback llega al main looper (asi lo registramos para no complicar la
     * coordinacion con el watchdog), y cada fix llama a scheduleFlush(), que abre
     * HttpURLConnection, refresca el token y escribe en disco. Con un fix cada 5-15 s
     * eso era I/O bloqueante en el main thread: si la red tardaba mas de 5 s, Android
     * mataba la app con ANR y el rastreo moria en produccion. El executor tambien
     * serializa los envios, de modo que dos flush simultaneos no repiten la cola.
     */
    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean flushScheduled = new AtomicBoolean(false);

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        fusedClient = LocationServices.getFusedLocationProviderClient(this);
        authManager = new DeviceAuthManager(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // startForeground DEBE ocurrir en los primeros ~5s o el sistema mata el proceso
        // con ForegroundServiceDidNotStartInTimeException.
        if (!promoteToForeground()) {
            return START_NOT_STICKY;
        }

        if (!preconditionsMet()) {
            Log.w(TAG, "Precondiciones no cumplidas; el rastreo nativo no arranca.");
            stopSelfSafely();
            return START_NOT_STICKY;
        }

        startLocationUpdates();
        scheduleFlush();

        TrackingWatchdog.setTrackingEnabled(this, true);
        setActive(true);

        // START_STICKY: si Android mata el proceso, el sistema lo reinicia sin extra.
        // El servicio relee su configuracion desde disco, asi que sobrevive.
        return START_STICKY;
    }

    /**
     * Un ForegroundService de tipo location exige permiso de ubicacion en runtime Y
     * que la ubicacion del sistema este habilitada. Si el usuario la desactivo, el
     * sistema lanza SecurityException al promover a foreground. Sin este catch la app
     * entera crashea al arrancar el dispositivo.
     */
    private boolean promoteToForeground() {
        Notification notification = buildNotification("Rastreo GPS activo");
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            return true;
        } catch (Exception e) {
            Log.e(TAG, "No se pudo promover a foreground (ubicacion desactivada o permiso retirado): " + e.getMessage(), e);
            return false;
        }
    }

    private boolean preconditionsMet() {
        if (!PermissionUtils.hasAnyLocationPermission(this)) {
            Log.w(TAG, "Sin permiso de ubicacion: rastreo nativo abortado.");
            return false;
        }
        if (!PermissionUtils.hasBackgroundLocationPermission(this)) {
            // Sin el permiso "permitir todo el tiempo", un FGS de tipo location iniciado
            // en background no puede acceder a la ubicacion. Fallar aqui es preferible a
            // registrar el servicio y no reportar nada nunca.
            Log.w(TAG, "Sin permiso de ubicacion en segundo plano: rastreo nativo abortado.");
            return false;
        }
        if (authManager.isRevoked()) {
            Log.w(TAG, "Dispositivo revocado: rastreo nativo abortado.");
            return false;
        }
        if (!authManager.isProvisioned()) {
            Log.w(TAG, "Dispositivo no aprovisionado o en backoff de auth: rastreo nativo abortado.");
            return false;
        }
        if (!isLocationEnabled()) {
            Log.w(TAG, "Ubicacion del sistema deshabilitada: rastreo nativo abortado.");
            return false;
        }
        return true;
    }

    /**
     * Comprueba la opcion global de localizacion sin depender de API nivelada.
     *
     * LocationManager.isLocationEnabled() es API 28 y el proyecto soporta API 24: en
     * Android 7 la llamada directa lanzaria NoSuchMethodError (un Error, no una Exception,
     * asi que el catch(Exception) de este metodo no la contenia) y el servicio no
     * arrancaba nunca en dispositivos antiguos. Por debajo de 28 se consulta la
     * localizacion de cada provider.
     */
    private boolean isLocationEnabled() {
        try {
            android.location.LocationManager lm = (android.location.LocationManager) getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return false;
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                return lm.isLocationEnabled();
            }
            for (String provider : new String[]{
                    android.location.LocationManager.GPS_PROVIDER,
                    android.location.LocationManager.NETWORK_PROVIDER}) {
                try {
                    if (lm.isProviderEnabled(provider)) return true;
                } catch (IllegalArgumentException ignored) {
                    // Provider no disponible en este dispositivo.
                }
            }
            return false;
        } catch (Exception | LinkageError e) {
            return false;
        }
    }

    private void startLocationUpdates() {
        if (locationCallback != null) return;

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                Location location = result.getLastLocation();
                if (location == null) return;
                enqueueLocation(location);
            }
        };

        LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, LOCATION_INTERVAL_MS)
                .setMinUpdateIntervalMillis(5_000L)
                // smallestDisplacement 0: el watchdog necesita latidos aunque el
                // vehiculo lleve minutos estacionado. Con displacement > 0 el servicio
                // queda mudo y el watchdog lo da por muerto.
                .setMinUpdateDistanceMeters(0f)
                .setWaitForAccurateLocation(false)
                .build();

        try {
            fusedClient.requestLocationUpdates(request, locationCallback, android.os.Looper.getMainLooper());
            Log.i(TAG, "Suscripcion a actualizaciones de ubicacion activa.");
        } catch (SecurityException e) {
            Log.e(TAG, "Permiso de ubicacion revocado en caliente: " + e.getMessage(), e);
            stopSelfSafely();
        }
    }

    private void stopLocationUpdates() {
        if (locationCallback == null) return;
        try {
            fusedClient.removeLocationUpdates(locationCallback);
        } catch (Exception e) {
            Log.w(TAG, "Error al cancelar actualizaciones de ubicacion: " + e.getMessage());
        }
        locationCallback = null;
    }

    // ---------------------------------------------------------------- envio

    private void enqueueLocation(Location location) {
        // Sin una posicion valida, marcar latido seria mentirle al watchdog: el envio
        // solo cuenta cuando el POST devuelve 2xx.
        try {
            JSONObject payload = buildPayload(location);
            if (payload == null) return;

            List<JSONObject> queue;
            synchronized (queueLock) {
                queue = loadQueue();
                queue.add(payload);
                if (queue.size() > MAX_QUEUE) {
                    queue = new ArrayList<>(queue.subList(queue.size() - MAX_QUEUE, queue.size()));
                }
                saveQueue(queue);
            }
            scheduleFlush();
        } catch (Exception e) {
            Log.e(TAG, "Error encolando posicion: " + e.getMessage(), e);
        }
    }

    private JSONObject buildPayload(Location location) throws JSONException {
        if (!location.hasAccuracy()) return null;
        double accuracy = location.getAccuracy();
        if (!Double.isFinite(accuracy) || accuracy < 0) return null;

        float speedMps = location.hasSpeed() ? location.getSpeed() : 0f;
        if (!Float.isFinite(speedMps)) speedMps = 0f;
        // m/s -> km/h. Los CHECK constraints de la tabla aceptan 0..400 km/h.
        double speedKmh = Math.min(400, Math.max(0, speedMps * 3.6));

        // Double boxed para poder omitir el campo: null = desconocido, que es distinto
        // de 0. Si se enviara 0 en lugar de null, el CHECK 0..360 lo aceptaria pero
        // el dashboard mostraria rumbo al norte cuando en realidad no lo hay.
        Double bearing = location.hasBearing() ? (double) location.getBearing() : null;
        if (bearing != null && (!Double.isFinite(bearing) || bearing < 0 || bearing > 360)) {
            bearing = null;
        }

        String deviceId = authManager.getDeviceId();
        String timestamp = formatTimestamp(location.getTime());

        JSONObject payload = new JSONObject();
        payload.put("device_id", deviceId);
        payload.put("latitude", location.getLatitude());
        payload.put("longitude", location.getLongitude());
        payload.put("speed", round2(speedKmh));
        payload.put("accuracy", Math.round(accuracy));
        if (bearing != null) payload.put("bearing", round2(bearing));
        payload.put("timestamp", timestamp);
        payload.put("event_id", generateEventId(deviceId, timestamp, location.getLatitude(), location.getLongitude()));
        return payload;
    }

    /**
     * Encola un intento de envio sin bloquear al llamador. Es el unico punto de entrada
     * desde los callbacks de ubicacion y desde onStartCommand.
     */
    private void scheduleFlush() {
        if (!flushScheduled.compareAndSet(false, true)) return;
        networkExecutor.execute(() -> {
            try {
                doFlushQueue();
            } finally {
                flushScheduled.set(false);
            }
        });
    }

    /**
     * Reintenta el envio de la cola. Cada elemento sale en su propia transaccion.
     * SIEMPRE se ejecuta en el hilo de red: contiene llamadas HTTP bloqueantes.
     */
    private void doFlushQueue() {
        List<JSONObject> pending;
        synchronized (queueLock) {
            pending = loadQueue();
        }
        if (pending.isEmpty()) return;

        String token = authManager.getAccessToken();
        if (token == null) {
            // getAccessToken() ya aplica backoff exponencial y puede reprovisionar.
            Log.w(TAG, "Sin access_token valido; la cola queda en disco (" + pending.size() + " posiciones).");
            return;
        }

        for (JSONObject payload : pending) {
            if (!postLocation(token, payload)) {
                // Fallo de red o de auth: se conserva el resto y se sale. Reintentar en
                // bucle cerraria la app; el proximo fix vuelve a invocar scheduleFlush().
                return;
            }
            synchronized (queueLock) {
                List<JSONObject> queue = loadQueue();
                if (!queue.isEmpty()) queue.remove(0);
                saveQueue(queue);
            }
            lastSuccessMs = System.currentTimeMillis();
            TrackingWatchdog.heartbeat(this);
            sendTelemetry(token);
        }
    }

    private boolean postLocation(String token, JSONObject payload) {
        String url = getString(R.string.supabase_url)
                + "/rest/v1/gps_locations?on_conflict=device_id,event_id";
        return post(url, token, payload.toString(), "Prefer", "resolution=ignore-duplicates,return=minimal");
    }

    /**
     * Telemetria real del dispositivo. Se manda desde nativo porque el webview no puede
     * leer model/version de forma fiable y antes enviaba '1.0.0' fijo y userAgent como
     * modelo, dejando el dashboard con datos falsos para siempre.
     */
    private void sendTelemetry(String token) {
        try {
            JSONObject body = new JSONObject();
            body.put("p_device_id", authManager.getDeviceId());
            Integer battery = readBatteryPercent();
            if (battery != null) body.put("p_battery", battery);
            body.put("p_platform", "android");
            body.put("p_model", buildModelString());
            body.put("p_app_version", resolveAppVersion());
            body.put("p_location_status", "active");

            post(getString(R.string.supabase_url) + "/rest/v1/rpc/update_device_telemetry",
                    token, body.toString());
        } catch (Exception e) {
            // La telemetria es best-effort: nunca debe tumbar el rastreo.
            Log.w(TAG, "Fallo enviando telemetria: " + e.getMessage());
        }
    }

    private String buildModelString() {
        String model = Build.MODEL == null ? "" : Build.MODEL.trim();
        String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.trim();
        if (model.toLowerCase(Locale.ROOT).startsWith(manufacturer.toLowerCase(Locale.ROOT))) {
            return model.length() > 60 ? model.substring(0, 60) : model;
        }
        String combined = manufacturer + " " + model;
        return combined.trim().length() > 60 ? combined.trim().substring(0, 60) : combined.trim();
    }

    private String resolveAppVersion() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            return info.versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return authManager.getAppVersion();
        }
    }

    /**
     * Porcentaje de bateria actual.
     *
     * Antes solo devolvia un valor cuando el dispositivo estaba cargando o al 100%. Como el
     * rastreador se usa sobre todo en vehiculos en marcha (descargando), la telemetria
     * llegaba casi siempre sin bateria y el RPC conservaba el valor viejo indefinidamente:
     * el dashboard marcaba "cargando" o un porcentaje congelado durante horas. Ahora se
     * reporta siempre el nivel real y solo se omite (null) cuando Android no lo expone.
     */
    @Nullable
    private Integer readBatteryPercent() {
        try {
            int level = -1;
            int scale = -1;
            Intent statusIntent = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (statusIntent != null) {
                level = statusIntent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                scale = statusIntent.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
            }
            if (level < 0 || scale <= 0) return null;
            return (int) Math.min(100, Math.max(0, Math.round((level * 100.0) / scale)));
        } catch (Exception e) {
            return null;
        }
    }

    // ---------------------------------------------------------------- red

    /**
     * POST con el JWT del dispositivo. Devuelve true solo ante 2xx: cualquier otro
     * codigo se considera fallo y deja el elemento en la cola.
     */
    private boolean post(String url, String token, String json, String... extraHeaders) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setRequestMethod("POST");
            connection.setRequestProperty("apikey", getString(R.string.supabase_publishable_key));
            connection.setRequestProperty("Authorization", "Bearer " + token);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(10_000);
            connection.setDoOutput(true);
            for (int i = 0; i + 1 < extraHeaders.length; i += 2) {
                connection.setRequestProperty(extraHeaders[i], extraHeaders[i + 1]);
            }

            byte[] payloadBytes = json.getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(payloadBytes);
            }

            int code = connection.getResponseCode();
            if (code >= 200 && code < 300) {
                drain(connection.getInputStream());
                return true;
            }
            String errorBody = drain(connection.getErrorStream());
            if (code == 401 || code == 403) {
                // Token caducado o revocado: se limpia para forzar renovacion en el
                // proximo intento. La posicion sigue en la cola.
                authManager.clearAccessToken();
                Log.w(TAG, "Auth rechazada (" + code + "); token invalidado para renovacion.");
            } else {
                Log.w(TAG, "POST " + url + " -> HTTP " + code + ": " + truncate(errorBody, 200));
            }
            return false;
        } catch (Exception e) {
            Log.w(TAG, "Fallo de red en POST " + url + ": " + e.getMessage());
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    /** Consume el cuerpo de la respuesta y lo devuelve; nunca lanza. */
    private String drain(InputStream stream) {
        if (stream == null) return "";
        try (InputStream in = stream) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            int read;
            while ((read = in.read(chunk)) != -1) buffer.write(chunk, 0, read);
            return buffer.toString("UTF-8");
        } catch (Exception e) {
            return "";
        }
    }

    // ---------------------------------------------------------------- cola en disco

    private File queueFile() {
        return new File(getFilesDir(), "native_gps_queue.json");
    }

    /**
     * La cola se serializa como un array JSON en filesDir. Si se corrompe, se descarta
     * en vez de propagar el error: perder la cola offline es mejor que impedir el
     * rastreo en vivo.
     */
    private List<JSONObject> loadQueue() {
        List<JSONObject> result = new ArrayList<>();
        File file = queueFile();
        if (!file.exists()) return result;
        try (FileInputStream in = new FileInputStream(file)) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            int read;
            while ((read = in.read(chunk)) != -1) buffer.write(chunk, 0, read);
            JSONArray array = new JSONArray(buffer.toString("UTF-8"));
            for (int i = 0; i < array.length(); i++) {
                JSONObject item = array.optJSONObject(i);
                if (item != null) result.add(item);
            }
        } catch (Exception e) {
            Log.w(TAG, "Cola offline ilegible; se reinicia: " + e.getMessage());
            result.clear();
        }
        return result;
    }

    private void saveQueue(List<JSONObject> queue) {
        try {
            JSONArray array = new JSONArray();
            for (JSONObject item : queue) array.put(item);
            try (FileOutputStream out = new FileOutputStream(queueFile())) {
                out.write(array.toString().getBytes(StandardCharsets.UTF_8));
                out.flush();
            }
        } catch (Exception e) {
            Log.e(TAG, "No se pudo guardar la cola offline: " + e.getMessage(), e);
        }
    }

    // ---------------------------------------------------------------- estado

    private void setActive(boolean active) {
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ACTIVE, active).apply();
    }

    public static boolean isActive(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ACTIVE, false);
    }

    /** Detiene el rastreo nativo desde fuera; seguro de llamar aunque no este corriendo. */
    public static void stopNativeTracking(Context context) {
        if (!isActive(context)) return;
        context.stopService(new Intent(context, NativeTrackingService.class));
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ACTIVE, false).apply();
        Log.i(TAG, "Rastreo nativo detenido externamente (webview asume el envio).");
    }

    public static void startNativeTracking(Context context) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(new Intent(context, NativeTrackingService.class));
            } else {
                context.startService(new Intent(context, NativeTrackingService.class));
            }
        } catch (Exception e) {
            Log.w(TAG, "No se pudo iniciar el rastreo nativo: " + e.getMessage(), e);
        }
    }

    @Override
    public void onDestroy() {
        stopLocationUpdates();
        setActive(false);
        // shutdown() (no shutdownNow) deja terminar el envio que ya esta en vuelo, de modo
        // que una posicion encolada no se pierde por una deteccion puntual del sistema.
        try {
            networkExecutor.shutdown();
        } catch (Exception ignored) {
            // sin consecuencias: el proceso se esta cerrando
        }
        Log.i(TAG, "Rastreo nativo destruido.");
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Deslizar la app desde el multitarea no debe detener el rastreo: el vehiculo
        // sigue moviendose. Se mantiene el servicio y el watchdog lo revivira si hace falta.
        super.onTaskRemoved(rootIntent);
    }

    private void stopSelfSafely() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(Service.STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Exception ignored) {
            // sin consecuencias: stopSelf limpia igual
        }
        stopSelf();
    }

    // ---------------------------------------------------------------- notification

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Rastreo GPS",
                NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Notificacion permanente mientras el dispositivo reporta su ubicacion.");
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private Notification buildNotification(String text) {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent contentIntent = null;
        if (launchIntent != null) {
            int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                    ? PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                    : PendingIntent.FLAG_UPDATE_CURRENT;
            contentIntent = PendingIntent.getActivity(this, 0, launchIntent, flags);
        }
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("GPS Tracker")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(true)
                .setShowWhen(false)
                .setContentIntent(contentIntent)
                .build();
    }

    // ---------------------------------------------------------------- event_id

    /**
     * event_id determinista, identico al algoritmo del webview (cyrb53 sobre
     * deviceId|timestamp|lat6dec|lng6dec). Que ambos coincidan es lo que permite que
     * un solape de posiciones entre los dos emisores se resuelva con
     * onConflict + ignoreDuplicates en vez de duplicar trayectorias.
     */
    static String generateEventId(String deviceId, String timestamp, double latitude, double longitude) {
        String payload = deviceId + "|" + timestamp + "|" + format6(latitude) + "|" + format6(longitude);
        return "evt-" + Long.toString(cyrb53(payload), 36);
    }

    private static String format6(double value) {
        return String.format(Locale.US, "%.6f", value);
    }

    /**
     * cyrb53 exacto. En JS toda la aritmetica es de 32 bits con signo (Math.imul y el
     * XOR bitwise), asi que aqui se replica con int y no con long: usar long cambiaria
     * los operandos de las multiplicaciones y generaria event_ids distintos a los del
     * webview, que es justo lo que romperia el deduplicado.
     *
     * El resultado final cabe en 53 bits (2^53 = 9007199254740992 > maximo alcanzable),
     * por lo que el double de JS es exacto y su toString(36) coincide con
     * Long.toString(x, 36).
     */
    private static long cyrb53(String str) {
        // Literales > 2^31-1 no caben en un int de Java: se escriben como su patron de
        // bits en long y se truncan con el cast, que es exactamente el mismo int de
        // 32 bits con signo que usa JS.
        int h1 = (int) 0xdeadbeefL;
        int h2 = 0x41c6ce57;
        for (int i = 0; i < str.length(); i++) {
            int ch = str.charAt(i);
            h1 = imul(h1 ^ ch, 0x9e3779b1);
            h2 = imul(h2 ^ ch, 0x5f356495);
        }
        h1 = imul(h1 ^ (h1 >>> 16), 0x85ebca6b);
        h1 ^= imul(h2 ^ (h2 >>> 13), 0xc2b2ae35);
        h2 = imul(h2 ^ (h2 >>> 16), 0x85ebca6b);
        h2 ^= imul(h1 ^ (h1 >>> 13), 0xc2b2ae35);
        long low = 2097151L & (h2 & 0xffffffffL);
        return 4294967296L * low + (h1 & 0xffffffffL);
    }

    /**
     * Equivalente de Math.imul de JavaScript.
     *
     * Math.imul en Android solo existe a partir de API 33 y este proyecto compila con
     * source/target 1.8, asi que no se puede usar. El producto de dos int de 32 bits
     * siempre cabe en un long; el casting a int se queda con los 32 bits bajos, que es
     * exactamente eloverflow que Math.imul produce.
     */
    private static int imul(int a, int b) {
        return (int) ((long) a * (long) b);
    }

    private static String formatTimestamp(long millis) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date(millis));
    }

    private static double round2(double value) {
        return Math.round(value * 100.0) / 100.0;
    }

    private static String truncate(String value, int max) {
        if (value == null) return "";
        return value.length() > max ? value.substring(0, max) : value;
    }
}