import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchDevices, fetchLatestLocations, transformDevice } from '../lib/queries'
import { deviceStatusFromLastSeen } from '../lib/mapLogic'
import { useLiveCollection } from './useLiveCollection'

const HIDDEN_EPHEMERAL_KEY = 'rg_hidden_ephemerals'
const storage = () => (typeof window !== 'undefined' && window.localStorage ? window.localStorage : null)

const readHiddenEphemerals = () => {
  try {
    const raw = storage()?.getItem(HIDDEN_EPHEMERAL_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? new Set(arr) : new Set()
  } catch {
    return new Set()
  }
}

const persistHiddenEphemerals = (hidden) => {
  try {
    storage()?.setItem(HIDDEN_EPHEMERAL_KEY, JSON.stringify([...hidden]))
  } catch {
    /* almacenamiento no disponible */
  }
}

const ephemeralDevice = (location) => ({
  id: location.device_id,
  status: deviceStatusFromLastSeen(location.timestamp),
  last_seen: location.timestamp,
  platform: null,
  model: null,
  app_version: null,
  battery: null,
  label: null,
  _ephemeral: true,
})

export const useDevices = () => {
  const [hiddenEphemerals, setHiddenEphemerals] = useState(readHiddenEphemerals)
  const hiddenRef = useRef(hiddenEphemerals)

  // Espejo del estado para poder leerlo dentro de fetchFn sin recrear el
  // callback en cada cambio. Se sincroniza en un efecto y no durante el render.
  useEffect(() => {
    hiddenRef.current = hiddenEphemerals
  }, [hiddenEphemerals])

  const fetchFn = useCallback(async () => {
    const dbDevices = await fetchDevices()
    const liveLocations = await fetchLatestLocations()
    const liveByDevice = new Map(liveLocations.map((item) => [item.device_id, item]))

    const knownIds = new Set(dbDevices.map((device) => device.id))

    const ephemerals = liveLocations
      .filter((location) => !knownIds.has(location.device_id))
      .filter((location) => !hiddenRef.current.has(location.device_id))
      .map(ephemeralDevice)

    const merged = [...dbDevices, ...ephemerals].map((dbDevice) => {
      const live = liveByDevice.get(dbDevice.id)
      const device = transformDevice(dbDevice, live)
      // No se sobreescribe device.status: transformDevice ya lo calcula correctamente
      // considerando isOnline, isStale y la validez de las coordenadas.
      return device
    })

    return merged.sort((a, b) => {
      const normalize = (value) => (value instanceof Date ? value.getTime() : Date.parse(value) || 0)
      return normalize(b.lastSeen) - normalize(a.lastSeen)
    })
  }, [])

  const { data: devices, setData: setDevices, isLoading, error, lastSyncTime, isStale, refetch: refetchDevices } = useLiveCollection({
    fetchFn,
    subscribeTables: ['gps_locations', 'devices']
  })

  const hideEphemeral = useCallback((deviceId) => {
    setHiddenEphemerals((prev) => {
      const next = new Set(prev)
      next.add(deviceId)
      persistHiddenEphemerals(next)
      return next
    })
    setDevices((prev) => prev.filter((d) => d.id !== deviceId))
  }, [setDevices])

  return useMemo(
    () => ({ devices, isLoading, error, isStale, lastSyncTime, hideEphemeral, hiddenEphemerals, refetchDevices }),
    [devices, isLoading, error, isStale, lastSyncTime, hideEphemeral, hiddenEphemerals, refetchDevices],
  )
}