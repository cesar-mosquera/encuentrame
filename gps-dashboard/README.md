# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.

## Observabilidad

La app inicializa Sentry para React y Capacitor cuando `VITE_SENTRY_DSN` está
configurado. En producción, define esa variable en el entorno de compilación
(por ejemplo, en el proveedor de despliegue web y al generar el APK) y vuelve
a compilar la app. Para Android, desde `gps-dashboard`, ejecuta
`npm run build && npx cap sync android` antes de generar el APK. Sin DSN, los
eventos no se envían.

Para que las trazas JavaScript muestren archivos y líneas originales, configura
`SENTRY_ORG`, `SENTRY_PROJECT` y `SENTRY_AUTH_TOKEN` como secretos del entorno
de compilación. Vite sube los source maps a Sentry y los elimina del directorio
publicado; el token no debe tener prefijo `VITE_`.

Los errores de consultas a Supabase se reportan con su operación y categoría.
Los fallos al insertar ubicaciones quedan en la cola local para reintento y se
reportan sin adjuntar las coordenadas. No agregues tokens ni datos sensibles a
los extras de Sentry.

Para inspeccionar un dispositivo Android conectado por USB con la depuración
activada, usa:

```bash
adb devices
adb logcat -v time
```

`adb logcat` muestra el registro nativo en tiempo real; los errores capturados
por Sentry pueden consultarse en el panel del proyecto sin conectar el
dispositivo a VS Code.
