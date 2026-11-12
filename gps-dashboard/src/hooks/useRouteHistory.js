import { useEffect, useMemo, useState } from 'react'
import { fetchDeviceRouteHistory, sanitizeRoute } from '../lib/queries'

export const useRouteHistory = (entity) => {
  const entityId = entity?.id
  const isVehicle = entity?._kind === 'vehicle'

  // Ruta embebida (vehículos con columna route o simulados con trayecto circular)
  const embedded = useMemo(() => {
    const raw = entity?.route
    if (!Array.isArray(raw) || raw.length < 2) return []
    return sanitizeRoute(raw)
  }, [entity?.route])

  // Dispositivos sin ruta embebida o vehículos: pedir historial real de gps_locations.
  // Ojo: normalizeEntity expone el id del dispositivo como `deviceId` (camelCase), nunca
  // como `device_id`. Leer la columna cruda aquí dejaba `targetDeviceId` en undefined y
  // los vehículos sin historial, en silencio.
  const targetDeviceId = isVehicle ? entity?.deviceId : entityId
  const wantsTelemetry = Boolean(targetDeviceId && embedded.length < 2)

  // El estado guarda el id del dispositivo al que pertenece cada resultado, en lugar
  // de vaciarse con setState dentro de un efecto.
  //
  // Antes, un efecto limpiaba telemetryRoute al cambiar de dispositivo. Eso costaba un
  // render en cascada y, sobre todo, dejaba la ruta del dispositivo ANTERIOR visible
  // durante el frame en que el fetch del nuevo aun no habia resuelto: el mapa dibujaba
  // la trayectoria equivocada. Comparando el id en render, el cambio es inmediato.
  const [telemetry, setTelemetry] = useState({ deviceId: null, route: [] })

  useEffect(() => {
    if (!wantsTelemetry) return undefined

    let active = true

    fetchDeviceRouteHistory(targetDeviceId, 250)
      .then((fetchedRoute) => {
        if (!active) return
        setTelemetry({ deviceId: targetDeviceId, route: fetchedRoute })
      })
      .catch(() => {
        // Un fallo se trata como "sin historial" en vez de dejar la ruta anterior.
        if (!active) return
        setTelemetry({ deviceId: targetDeviceId, route: [] })
      })

    return () => {
      active = false
    }
  }, [targetDeviceId, wantsTelemetry])

  const hasEmbeddedRoute = embedded.length >= 2
  // loading = hay un fetch en vuelo y aun no hay resultado para ESTE dispositivo.
  const loading = wantsTelemetry && telemetry.deviceId !== targetDeviceId
  const route = hasEmbeddedRoute ? embedded : (loading ? [] : telemetry.route)

  return { route, loading, hasEmbeddedRoute }
}