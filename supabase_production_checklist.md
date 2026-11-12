# Guía y Checklist de Certificación para Despliegue en Producción

Esta guía contiene los pasos exactos para certificar la base de datos Supabase real y realizar el build y verificación del APK release de Android.

---

## 1. Verificación de la Instancia Supabase en Producción

### A. Aplicar Migraciones
El esquema vive en `supabase/migrations/`, no en un archivo suelto. Aplicar con la CLI contra el proyecto real:
```bash
npx supabase link --project-ref <tu-project-ref>
npx supabase db push
```
Esto creará:
- Tablas con RLS activado: `organizations`, `profiles`, `devices`, `vehicles`, `alerts`, `geofences`, `gps_locations`, `device_registry`, `provision_rate_limits`, `orphan_auth_users`.
- Limitador de tasa persistente: `check_rate_limit`, `record_rate_limit_failure` y `clear_rate_limit`.
- Triggers automáticos de organización: `set_gps_location_org_id` y `set_device_insert_org_id`.
- Triggers de protección estructural: `protect_vehicle_structural_fields` y `protect_device_structural_fields`.
- Vista de alto rendimiento `latest_gps_locations` con `security_invoker = true`.
- Borrado en cascada de vehículos: `delete_vehicle_cascade`.
- Jobs de `pg_cron`: `reconcile-pending-deletions` (cada 15 min) y `purge-old-gps-locations` (diario, borra posiciones con más de 90 días).

### B. Auditoría automática
```bash
cd gps-dashboard
SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<service-role-key> npm run verify:supabase
```
Comprueba tablas, la vista y las RPC exposed. Debe terminar sin `FAIL`.

### C. Publicación Realtime
La migración agrega automáticamente a `supabase_realtime` las tablas `vehicles`, `devices`, `alerts`, `geofences` y `gps_locations`. Verificar en la consola (Database → Realtime) que estén las cinco. La vista `latest_gps_locations` no se publica: el front la consulta por REST y hace fallback a `gps_locations` si responde `PGRST202`/`42P01`.

### D. Despliegue de Edge Functions
Las **dos** funciones hacen fail-fast si `ALLOWED_ORIGIN` no está definida (devuelven 500 en toda petición), y ambas exigen la service role key del proyecto.
```bash
supabase secrets set ALLOWED_ORIGIN="https://tu-panel.vercel.app" --project-ref <tu-project-ref>
supabase secrets set PROVISION_SECRET="<valor-aleatorio>" --project-ref <tu-project-ref>
supabase functions deploy provision-device --project-ref <tu-project-ref>
supabase functions deploy delete-device-user --project-ref <tu-project-ref>
```

> `PROVISION_SECRET` es el código de aprovisionamiento que el APK envía en el **cuerpo JSON**
> (`{"deviceId": "...", "activationCode": "..."}`), no en un header. El limitador de tasa
> permite 5 intentos fallidos por ventana de 15 minutos, por IP, por device y por código.

> Para emitir varios dispositivos en paralelo sin compartir un único secreto global, lo
> preferible es dar un `activation_code` propio a cada organización:
> ```sql
> update public.organizations set activation_code = '<codigo>' where id = '<org-uuid>';
> ```
> El código de la organización tiene prioridad sobre `PROVISION_SECRET`. El secreto global
> queda como plan B para organizaciones que aún no tengan código asignado.

### E. Alta del primer operador
`handle_new_user` **no** auto-asigna organización (decisión anti-IDOR: un usuario que se registra por sí solo no debe ver la flota de nadie). La migración tampoco crea una organización por defecto en una base nueva, y el backfill de `organization_id` excluye `profiles` a propósito. Crear la organización y el perfil a mano:
```sql
insert into public.organizations (name) values ('Mi Organización') returning id;
insert into public.profiles (user_id, organization_id, full_name, role)
values ('<uuid-de-auth.users>', '<organization_id>', 'Admin', 'owner');
```

> Si adoptas un esquema previo que carecía de `organization_id`, la migración
> asigna las filas heredadas de `vehicles`, `devices`, `geofences`, `alerts` y
> `gps_locations` a la organización más antigua, o crea "Organización Principal"
> si no existe ninguna. Emite un `NOTICE` con cuántas filas tocó. Los perfiles
> nunca se reasignan solos.

### F. `verify_jwt` de las funciones
`supabase/config.toml` fija el comportamiento de forma explícita, porque los dos casos son
opuestos y el default del proyecto no sirve para ninguno:
- `provision-device`: `verify_jwt = false`. La llama el dispositivo **antes** de tener
  sesión, así que todavía no existe JWT que validar. La autenticación la hace la propia
  función (código de activación + rate limit). Sin esta línea el gateway devolvía 401 y el
  alta del dispositivo nunca ocurría.
- `delete-device-user`: `verify_jwt = true`. La invoca el panel con la sesión del usuario.

Un cambio en `config.toml` solo afecta a despliegues **nuevos**: tras cambiarla hay que
volver a desplegar las funciones para que el gateway aplique la nueva política.

---

## 2. Firma del APK Release y Verificación Física

### A. Variables de Entorno de Firma
Para generar la versión firmada de producción, definir en `gradle.properties` o en las variables de entorno del servidor CI/CD:
```properties
GPS_RELEASE_STORE_FILE=/ruta/a/tu/keystore.jks
GPS_RELEASE_STORE_PASSWORD=tu_password_keystore
GPS_RELEASE_KEY_ALIAS=tu_alias_llave
GPS_RELEASE_KEY_PASSWORD=tu_password_alias
```
El build falla a propósito (`GradleException`) si se intenta `assembleRelease` sin las cuatro.

### B. Sincronizar el bundle web antes de compilar
```bash
cd gps-dashboard
npm run build
npx cap sync android
cd android && ./gradlew clean && ./gradlew :app:assembleRelease
```

### C. Verificación de Firma con `apksigner`
Confirmar que el paquete `.apk` resultante tenga una firma V2/V3/V4 válida:
```bash
apksigner verify --verbose app/build/outputs/apk/release/app-release.apk
```

---

## 3. Matriz de Pruebas de Integración y Recuperación

1. **Alta Inicial:** Ingresar el código de aprovisionamiento -> el APK recibe credenciales `device-xxx@local.rideguard` y token JWT.
2. **Reinstalación con baja previa en el panel:** Borrar datos de la app en Android -> al reabrir, el dispositivo conserva su `device_id` e intenta re-aprovisionarse. Mientras siga dado de alta, `provision-device` responde **403 "ya se encuentra registrado"**: es la protección anti-hijack, porque si el alta fuera idempotente cualquiera que conociera el código de activación podría reclamar el `device_id` de otro dispositivo y obtener sus credenciales. Procedimiento correcto: primero dar de baja el vehículo desde el panel (`delete-device-user` marca `devices.status='inactive'` y borra su fila de `device_registry`), y solo entonces borrar los datos de la app. Verificar que el alta devuelve 200 con `email` y `password`, y que el rastreo se reanuda.
3. **Bloqueo por Intento Inválido:** Intentar el aprovisionamiento con un `activationCode` distinto del real -> el servidor responde 403 y no entrega credenciales. Tras 5 intentos fallidos en 15 minutos la respuesta pasa a 429.

   El codigo valido se resuelve en este orden:
   1. `organizations.activation_code` de la organizacion indicada en el cuerpo (permite alta de varios dispositivos en paralelo sin compartir un unico secreto global).
   2. Si la organizacion no tiene codigo, el secreto global `PROVISION_SECRET`.

   `AUTO_PROVISION` viene deshabilitado. Si el despliegue lo necesita, hay que exponer `ALLOW_AUTO_PROVISION=true` de forma explicita: sin esa variable, la funcion rechaza el alta aunque el codigo sea valido (fail closed).
4. **Resiliencia de Token JWT:** Dejar el panel web abierto en móvil durante más de 1 hora -> al caducar el token, `withAuthRetry` captura el error 401, consulta el nuevo token nativo y reintenta las peticiones sin mostrar pantalla de error ni cerrar el monitoreo.
5. **Autoinicio tras reinicio:** Reiniciar el teléfono con la app instalada -> `BootReceiver` recibe `BOOT_COMPLETED` y `USER_UNLOCKED`, valida credenciales, permisos y estado de la localizacion, y arranca `NativeTrackingService` (foreground service de tipo `location`). El rastreo NO depende del WebView ni de abrir `MainActivity`.

   Compatibilidad: `minSdkVersion=24`. En Android 7/8 el servicio debe arrancar igual; la comprobacion de localizacion global no puede apoyarse en `LocationManager.isLocationEnabled()` (API 28) sino en `isProviderEnabled()`. Verificar en logcat `NativeTrackingService` y `Suscripcion a actualizaciones de ubicacion activa`.

6. **Rastreo sin WebView (modo parking):** Dejar el vehiculo estacionado con la app en background y la pantalla apagada mas de 30 minutos -> el servicio nativo sigue reportando posicion y latidos. Durante ese tiempo no debe aparecer ningun ANR en logcat: el envio HTTP corre en un hilo propio, no en el main looper.
7. **Conmutación JS/nativo:** Abrir la app con el rastreo nativo ya activo -> `MainActivity.TrackingBridge.setTrackingEnabled(true)` detiene el servicio nativo para que el WebView asuma el envio. Cerrar la app debe devolver el rastreo al servicio nativo. En ambos sentidos no puede quedar doble reporte ni rastreo muerto: verificar en `gps_locations` que no aparecen posiciones duplicadas del mismo instante.
8. **Supervivencia del proceso:** Con el rastreo activo, matar el proceso de la app (Configuración → Forzar detener, o desde `adb shell am kill <paquete>`) y esperar ~25 min -> `TrackingWatchdog` detecta que no llega heartbeat y rearranca `NativeTrackingService`.

   Ojo con la verificacion: la version anterior de esta prueba daba por buena la recuperacion porque el watchdog relanzaba `MainActivity`, y en Android 10+ esa llamada se descarta en silencio cuando el proceso no esta en foreground. El criterio de aceptacion no es "se abrio la app", sino "llegan posiciones nuevas a `gps_locations`". Verificar en logcat `TrackingWatchdog` y `Rastreo nativo destruido` / nueva subscripcion.

9. **Cola offline:** Poner el dispositivo en modo avión durante unos minutos y volver a cobertura -> las posiciones se acumulan en la cola local (`native_gps_queue.json`, tope 1000) y se drenan al recuperar la red, sin perdidas y sin duplicados gracias a `event_id` + `on_conflict=device_id,event_id`.
10. **Borrado de vehículo desde el panel:** Eliminar un vehículo como `owner`/`admin` -> la Edge Function `delete-device-user` desvincula el dispositivo, lo marca `inactive`, borra el vehículo y elimina el usuario de Auth.

---

## 4. Fuera de alcance

La funcionalidad de **comandos de vehículo** (`activate` / `stop` / `immobilize`, con control físico de relé por GPIO) fue retirada del proyecto. No hay tabla, RPC, permiso ni componente nativo asociado. Si se reintroduce, requiere su propio diseño de cola de comandos en el dispositivo, que hoy no existe.
