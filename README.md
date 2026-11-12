# GPS Fleet Monitor

Panel web y aplicación Android para monitorear dispositivos GPS en tiempo real. El proyecto combina React/Vite, Supabase, Leaflet y un servicio Android en foreground para enviar la ubicación periódicamente, incluso con la pantalla apagada.

## Qué incluye

- Panel web protegido con Supabase Auth.
- Mapa con seguimiento de dispositivos y estado online/offline.
- Registro de dispositivos en `devices`.
- Historial de posiciones en `gps_locations`.
- Datos de latitud, longitud, velocidad, precisión, rumbo y batería.
- Alertas, geocercas e historial de rutas.
- Aplicación Android con envío GPS cada 30 segundos.
- Tests unitarios y build de producción con Vite.

## supabase contra
JulioCesarMosquera

## Estructura

```text
.
├── supabase/                # Migraciones, funciones Edge y configuración
└── gps-dashboard/
    ├── src/                 # Panel React y lógica GPS/Supabase
    ├── scripts/             # Utilidades de verificación del despliegue
    ├── public/              # Assets estáticos
    ├── .env.example         # Plantilla de variables de entorno (sin secretos)
    └── android/             # Proyecto Android generado con Capacitor
```

Los artefactos de build (`dist/`, `coverage/`, `android/build/`), dependencias
(`node_modules/`) y secretos (`.env`, keystores, `supabase/.temp/`) están
excluidos por `.gitignore`; no deben subirse al repositorio.

## Desarrollo local

Requisitos: Node.js 20 o superior y un proyecto Supabase.

```bash
cd gps-dashboard
npm install
npm run dev
```

Para ejecutar las validaciones:

```bash
npm test
npm run build
npm run lint
```

Configura las variables en `gps-dashboard/.env` o en el proveedor de despliegue. Usa solamente la clave publishable/anon:

```text
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu_clave_publishable
```

No subas `.env`, `service_role`, contraseñas, keystores ni archivos de configuración privados.

## Configuración de Supabase

1. Abre el proyecto Supabase correcto.
2. Ejecuta `npx supabase db push` para aplicar las migraciones o despliega tu proyecto vinculado.
3. Activa Authentication con Email.
4. Crea el usuario real del panel desde Authentication > Users.
5. Crea una organización y relaciona el UUID del usuario en `public.profiles` con rol `owner` o `admin`.
6. Despliega las Edge Functions. Las dos requieren `ALLOWED_ORIGIN` y fallan de forma explícita si no está definida:

   ```bash
   cd supabase
   supabase secrets set ALLOWED_ORIGIN=https://tu-panel.vercel.app
   supabase secrets set PROVISION_SECRET=<valor-aleatorio>
   supabase functions deploy provision-device
   supabase functions deploy delete-device-user
   ```

   `PROVISION_SECRET` es el código de aprovisionamiento del dispositivo. El APK lo envía en el **cuerpo JSON** de la petición (`{"deviceId": "...", "activationCode": "..."}`), no en un header.
7. Configura las variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en Vercel para Production, Preview y Development.
8. Haz Redeploy desde `main`.

El flujo esperado es:

```text
APK (provision-device -> Auth propio) -> devices + gps_locations -> panel React -> mapa y estado offline
```

Cada dispositivo se aprovisiona una sola vez: la Edge Function crea su cuenta Auth, guarda `devices.auth_user_id` y devuelve email/password al APK, que los guarda en `SharedPreferences`. El APK ya no escribe como `anon`; usa el JWT del dispositivo (`app_metadata.device_id`) y las políticas RLS lo obligan a tocar solo su propia fila y sus posiciones.

Un dispositivo se considera offline después de aproximadamente 90 segundos sin actualizar `last_seen`.

## Política de CORS y Seguridad

La API restringe el acceso al panel mediante CORS a través de la variable de entorno `ALLOWED_ORIGIN`. Configúrala en Supabase (Edge Functions) para permitir solicitudes únicamente desde el dominio donde esté desplegado tu dashboard (ej. `ALLOWED_ORIGIN=https://mi-panel.vercel.app`).

## Autoinicio y Servicio GPS

El rastreo se mantiene activo en segundo plano incluso con la pantalla apagada. El autoinicio por Direct Boot levanta `MainActivity` que arranca de forma segura el rastreo al reiniciar el dispositivo.

## APK Android

El proyecto Android está en `gps-dashboard/android`. Para generar un APK debug:

```bash
cd gps-dashboard
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```

El archivo resultante queda en:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

En el teléfono se deben conceder ubicación precisa, notificaciones y funcionamiento en segundo plano, además de desactivar la optimización de batería para la aplicación.

## Despliegue

El panel puede desplegarse como aplicación Vite estática. El dominio publicado debe mostrar primero el acceso de Supabase; el dashboard no debe contener credenciales reales dentro del repositorio.

## Estado del proyecto

Este repositorio contiene el panel, la integración Supabase y el proyecto Android. El APK debug puede generarse localmente; la publicación en Play Store requiere una clave de firma privada que debe mantenerse fuera de Git.

## Colaboración

- Trabaja siempre en una rama y entrega cambios a través de un Pull Request contra `main`; nunca hagas push directo a `main`.
- Antes de enviar la rama ejecuta `npm test`, `npm run lint` y `npm run build`.
- No subas secretos ni artefactos de build: revisa que `git status` solo incluya código y configuración de ejemplo.
