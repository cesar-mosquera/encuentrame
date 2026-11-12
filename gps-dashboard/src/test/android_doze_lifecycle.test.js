// @vitest-environment node
/**
 * Validaciones de ciclo de vida y Doze Mode.
 *
 * El riesgo real en Android 14/15 no es "que la app se cierre", sino que el
 * sistema mate el proceso por optimización de batería y el rastreo muera en
 * silencio. Estos tests fijan las invariantes que sostienen la supervivencia:
 *
 *   - ForegroundService con tipo location y START_STICKY.
 *   - Cola offline persistida en disco (sobrevive a la muerte del proceso).
 *   - Watchdog con alarmas allow-while-idle (las únicas que despiertan en Doze).
 *   - Exención de optimización de batería solicitada al onboarding.
 *   - El servicio no muere al deslizar la app del multitarea.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const JAVA_DIR = path.join(ROOT, 'android/app/src/main/java/com/gps/tracker');
const readJava = (name) => fs.readFileSync(path.join(JAVA_DIR, name), 'utf-8');

let service;
let watchdog;
let alarmReceiver;
let mainActivity;
let manifest;

beforeAll(() => {
  service = readJava('NativeTrackingService.java');
  watchdog = readJava('TrackingWatchdog.java');
  alarmReceiver = readJava('AlarmRecoveryReceiver.java');
  mainActivity = readJava('MainActivity.java');
  manifest = fs.readFileSync(
    path.join(ROOT, 'android/app/src/main/AndroidManifest.xml'),
    'utf-8'
  );
});

const section = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endMarker, start);
  return source.slice(start, end === -1 ? undefined : end);
};

describe('Doze Mode: supervivencia del Foreground Service', () => {
  it('declara el servicio como foregroundServiceType="location"', () => {
    const block = section(manifest, 'android:name=".NativeTrackingService"', '<provider');
    expect(block).toContain('android:foregroundServiceType="location"');
    expect(block).toContain('android:exported="false"');
  });

  it('promueve a foreground ANTES de cualquier precondición (deadline de 5 s)', () => {
    const onStart = section(service, 'public int onStartCommand(', 'private boolean promoteToForeground');
    expect(onStart.indexOf('promoteToForeground()')).toBeLessThan(
      onStart.indexOf('preconditionsMet()')
    );
  });

  it('devuelve START_STICKY para que Android lo reviva tras matarlo por memoria', () => {
    expect(service).toContain('return START_STICKY;');
    // START_STICKY reintenta con intent null: no puede depender de extras.
    expect(service).toContain('authManager.getDeviceId()');
  });

  it('no se detiene al deslizar la app desde el multitarea', () => {
    const onTaskRemoved = section(service, 'public void onTaskRemoved(', 'private void stopSelfSafely');
    expect(onTaskRemoved).not.toContain('stopSelf(');
    expect(onTaskRemoved).not.toContain('stopForeground(');
  });

  it('al destruirse deja terminar el envío en vuelo (shutdown, no shutdownNow)', () => {
    expect(service).toContain('networkExecutor.shutdown()');
    expect(service).not.toContain('networkExecutor.shutdownNow()');
  });

  it('persiste la cola offline en disco para sobrevivir a la muerte del proceso', () => {
    expect(service).toContain('new File(getFilesDir(), "native_gps_queue.json")');
    expect(service).toContain('private void saveQueue(');
    expect(service).toContain('private List<JSONObject> loadQueue(');
    // Al arrancar de nuevo, onStartCommand vuelve a vaciar la cola persistida.
    const onStart = section(service, 'public int onStartCommand(', 'private boolean promoteToForeground');
    expect(onStart).toContain('scheduleFlush()');
  });

  it('no hace I/O de red en el hilo principal (evita ANR durante Doze)', () => {
    expect(service).toContain('Executors.newSingleThreadExecutor()');
    const flush = section(service, 'private void scheduleFlush()', 'private boolean postLocation');
    expect(flush).toContain('networkExecutor.execute(');
  });
});

describe('Doze Mode: watchdog con alarmas que despiertan al dispositivo', () => {
  it('usa setExactAndAllowWhileIdle / setAndAllowWhileIdle (no alarmas inexactas)', () => {
    expect(watchdog).toContain('setExactAndAllowWhileIdle');
    expect(watchdog).toContain('setAndAllowWhileIdle');
    expect(watchdog).not.toContain('setInexactRepeating');
    expect(watchdog).not.toContain('setRepeating');
  });

  it('en Android 12+ cae a setAndAllowWhileIdle si no hay permiso de alarma exacta', () => {
    const schedule = section(watchdog, 'static void schedule(', 'static void cancel(');
    expect(schedule).toContain('canScheduleExactAlarms()');
    expect(schedule).toContain('Build.VERSION_CODES.S');
    expect(schedule).toContain('setAndAllowWhileIdle');
  });

  it('el margen de gracia tolera Doze y es mayor que la cadencia del watchdog', () => {
    const constantMs = (name) => {
      const match = watchdog.match(new RegExp(`${name}\\s*=\\s*([^;]+);`));
      expect(match).not.toBeNull();
      const expression = match[1].replace(/L/g, '').replace(/\s+/g, '');
      return Function(`"use strict"; return (${expression});`)();
    };

    const interval = constantMs('WATCHDOG_INTERVAL_MS');
    const stale = constantMs('STALE_AFTER_MS');
    expect(stale).toBeGreaterThan(interval);
    // Un ciclo de Doze puede retrasar alarmas varios minutos.
    expect(stale).toBeGreaterThanOrEqual(10 * 60 * 1000);
  });

  it('re-arma la alarma ANTES de comprobar el heartbeat, para no desarmarse ante un fallo', () => {
    expect(alarmReceiver.indexOf('TrackingWatchdog.schedule(context)')).toBeLessThan(
      alarmReceiver.indexOf('TrackingWatchdog.isAlive(context)')
    );
  });

  it('solo relanza el rastreo si el heartbeat venció', () => {
    expect(alarmReceiver).toContain('if (TrackingWatchdog.isAlive(context))');
    expect(alarmReceiver).toContain('restartTracking(context, "watchdog_launch")');
  });

  it('declara SCHEDULE_EXACT_ALARM y RECEIVE_BOOT_COMPLETED para sobrevivir a reboot', () => {
    expect(manifest).toContain('android.permission.SCHEDULE_EXACT_ALARM');
    expect(manifest).toContain('android.permission.RECEIVE_BOOT_COMPLETED');
  });
});

describe('Permisos: batería y ubicación en segundo plano', () => {
  it('solicita la exención de optimización de batería con el intent oficial', () => {
    expect(mainActivity).toContain('Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS');
    expect(mainActivity).toContain('"package:" + getPackageName()');
    expect(mainActivity).toContain('isIgnoringBatteryOptimizations(getPackageName())');
  });

  it('ofrece el atajo de autostart de fabricantes con batería agresiva (Xiaomi, Huawei, Samsung...)', () => {
    for (const pkg of [
      'com.miui.securitycenter',
      'com.huawei.systemmanager',
      'com.samsung.android.lool',
      'com.coloros.safecenter',
      'com.vivo.permissionmanager',
    ]) {
      expect(mainActivity).toContain(pkg);
    }
  });

  it('declara REQUEST_IGNORE_BATTERY_OPTIMIZATIONS y ubicación en segundo plano', () => {
    expect(manifest).toContain('android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS');
    expect(manifest).toContain('android.permission.ACCESS_BACKGROUND_LOCATION');
    expect(manifest).toContain('android.permission.FOREGROUND_SERVICE_LOCATION');
  });

  it('aborta el servicio si falta el permiso de ubicación en segundo plano', () => {
    const preconditions = section(service, 'private boolean preconditionsMet()', 'private void startLocationUpdates');
    expect(preconditions).toContain('PermissionUtils.hasBackgroundLocationPermission(this)');
    expect(preconditions).toContain('PermissionUtils.hasAnyLocationPermission(this)');
  });

  it('pide alta precisión y displacement 0 para no quedarse mudo estacionado', () => {
    expect(service).toContain('PRIORITY_HIGH_ACCURACY');
    expect(service).toContain('.setMinUpdateDistanceMeters(0f)');
  });
});
