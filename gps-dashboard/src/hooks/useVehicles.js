import { useCallback } from 'react'
import { fetchLatestLocations, fetchVehicles, isCoordinateValid, isLocationValidForMap, sanitizeAccuracy } from '../lib/queries'
import { deviceStatusFromLastSeen } from '../lib/mapLogic'
import { useLiveCollection } from './useLiveCollection'

export const useVehicles = () => {
  const fetchFn = useCallback(async () => {
    const data = await fetchVehicles()
    const liveLocations = await fetchLatestLocations()
    const liveByDevice = new Map(liveLocations.map((item) => [item.device_id, item]))

    return data.map((vehicle) => {
      // BUG 4 corregido: solo buscar en el mapa si hay deviceId.
      // Usar vehicle.id como fallback era incorrecto: el Map usa device_id
      // como clave y un vehicle.id nunca coincide con un device_id.
      const live = vehicle.deviceId ? liveByDevice.get(vehicle.deviceId) : undefined
      if (!live) return vehicle
      const connectionStatus = deviceStatusFromLastSeen(live.timestamp)
      const isLiveValid = isLocationValidForMap(live.timestamp, 90000, live.latitude, live.longitude)
      const cleanCoords = isCoordinateValid(live.latitude, live.longitude) ? [Number(live.latitude), Number(live.longitude)] : null
      return {
        ...vehicle,
        position: isLiveValid ? cleanCoords : null,
        // BUG 6 corregido: priorizar posición de DB (más confiable) sobre
        // coords expiradas del live feed que pueden ser timestamp vencido.
        historicalPosition: vehicle.position || cleanCoords,
        speed: isLiveValid ? (live.speed || 0) : 0,
        // BUG 5 corregido: usar ?? en lugar de || para que bearing 0 (norte)
        // se conserve como valor válido, y solo null/undefined usen null.
        bearing: live.bearing ?? null,
        accuracy: sanitizeAccuracy(live.accuracy),
        connectionStatus,
        status: connectionStatus === 'offline'
          ? 'offline'
          : (vehicle.status === 'immobilized' ? 'immobilized' : (vehicle.status || connectionStatus)),
        lastUpdate: connectionStatus === 'active'
          ? 'En línea'
          : live.timestamp,
      }
    })
  }, [])

  const { data: vehicles, isLoading, error, lastSyncTime, isStale, refetch: refetchVehicles } = useLiveCollection({
    fetchFn,
    subscribeTables: ['gps_locations', 'devices', 'vehicles']
  })

  return { vehicles, isLoading, error, lastSyncTime, isStale, refetchVehicles }
}