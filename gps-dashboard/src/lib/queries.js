// Query functions for Supabase integration
// These fetch data from Supabase and transform it to the UI expected format

import { supabase, withAuthRetry } from '../lib/supabase'
import { deviceStatusFromLastSeen } from './mapLogic'

export const isCoordinateValid = (lat, lng) => {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return false
  const numLat = Number(lat)
  const numLng = Number(lng)
  return Number.isFinite(numLat) && Number.isFinite(numLng) && numLat >= -90 && numLat <= 90 && numLng >= -180 && numLng <= 180
}

export const normalizeBattery = (val) => {
  if (val === null || val === undefined) return 0
  const num = Number(val)
  if (!Number.isFinite(num)) return 0
  return Math.max(0, Math.min(100, Math.round(num)))
}

export const sanitizeAccuracy = (val) => {
  if (val === null || val === undefined) return null
  const num = Number(val)
  if (!Number.isFinite(num) || num < 0 || num > 50000) return null
  return Math.round(num)
}

export const sanitizeRoute = (rawRoute) => {
  if (!Array.isArray(rawRoute)) return []
  return rawRoute
    .filter((pt) => Array.isArray(pt) && pt.length >= 2 && isCoordinateValid(pt[0], pt[1]))
    .map((pt) => [Number(pt[0]), Number(pt[1])])
}

// Transform raw Supabase vehicle data to UI format
export const transformVehicle = (dbVehicle) => {
  const route = sanitizeRoute(dbVehicle.route);
  const lastSeen = dbVehicle.last_seen || dbVehicle.last_update || null;
  let calculatedStatus = dbVehicle.status || 'offline';
  if (dbVehicle.status === 'immobilized') {
    calculatedStatus = 'immobilized';
  } else if (lastSeen) {
    calculatedStatus = deviceStatusFromLastSeen(lastSeen);
  }
  const cleanPosition = (Array.isArray(dbVehicle.position) && dbVehicle.position.length >= 2 && isCoordinateValid(dbVehicle.position[0], dbVehicle.position[1]))
    ? [Number(dbVehicle.position[0]), Number(dbVehicle.position[1])]
    : null;

  return {
    id: dbVehicle.id,
    deviceId: dbVehicle.device_id || null,
    name: dbVehicle.label || dbVehicle.name || dbVehicle.plate || dbVehicle.id,
    plate: dbVehicle.vehicle_id || dbVehicle.plate || dbVehicle.id,
    driver: dbVehicle.driver || (dbVehicle.platform ? 'Dispositivo GPS' : 'Desconocido'),
    status: calculatedStatus,
    speed: dbVehicle.speed || 0,
    battery: normalizeBattery(dbVehicle.battery),
    fuel: dbVehicle.fuel !== undefined ? dbVehicle.fuel : 75,
    temp: dbVehicle.temp || 24,
    odometer: dbVehicle.odometer || '0 km',
    position: cleanPosition,
    location: dbVehicle.location || 'Ubicación actual',
    lastUpdate: dbVehicle.lastUpdate || dbVehicle.last_seen || dbVehicle.last_update || 'Now',
    route,
  };
}

export const REALTIME_LOCATION_TIMEOUT_MS = 90 * 1000 // 90 segundos para mapa en tiempo real
export const MAX_LOCATION_AGE_MS = REALTIME_LOCATION_TIMEOUT_MS

export const isLocationValidForMap = (timestamp, maxAgeMs = REALTIME_LOCATION_TIMEOUT_MS, ...coords) => {
  const [lat, lng] = coords
  if (coords.length > 0 && (lat === null || lat === undefined || lng === null || lng === undefined || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng)))) return false
  if (!timestamp) return false
  const time = timestamp instanceof Date ? timestamp.getTime() : Date.parse(timestamp)
  if (isNaN(time) || time <= 0) return false
  const age = Date.now() - time
  if (age < -5 * 60 * 1000 || age > maxAgeMs) return false
  // Si el caller pasó coordenadas (aunque sean null/undefined/NaN), deben ser válidas.
  // Solo se omite la validación cuando únicamente se valida el timestamp.
  if (coords.length > 0) return isCoordinateValid(lat, lng)
  return true
}

// Transform a GPS device (devices table + latest gps_location)
export const transformDevice = (dbDevice, live = null, maxAgeMs = REALTIME_LOCATION_TIMEOUT_MS) => {
  let effectiveLastSeen = dbDevice.last_seen || null
  if (live?.timestamp) {
    const liveTime = Date.parse(live.timestamp)
    const dbTime = dbDevice.last_seen ? Date.parse(dbDevice.last_seen) : 0
    if (!isNaN(liveTime) && liveTime > dbTime) {
      effectiveLastSeen = live.timestamp
    }
  }

  const lastSeenMs = effectiveLastSeen ? Date.parse(effectiveLastSeen) : NaN
  const now = Date.now()
  const lastSeenAgeMs = !isNaN(lastSeenMs) ? (now - lastSeenMs) : Infinity
  // Dispositivo stale si no tiene fecha, si excede maxAgeMs o si es un timestamp futuro > 5 min (-5 * 60 * 1000 ms)
  const isStale = isNaN(lastSeenAgeMs) || lastSeenAgeMs > maxAgeMs || lastSeenAgeMs < -5 * 60 * 1000
  const isOnline = !isStale && (dbDevice.status === 'online' || dbDevice.status === 'active' || Boolean(live))
  
  const isCoordsValid = live && isCoordinateValid(live.latitude, live.longitude)
  const isLiveValid = isCoordsValid && isLocationValidForMap(live.timestamp, maxAgeMs, live.latitude, live.longitude)
  const cleanCoords = isCoordsValid ? [Number(live.latitude), Number(live.longitude)] : null

  const liveBattery = live?.devices?.battery;
  const livePlatform = live?.devices?.platform;
  const liveModel = live?.devices?.model;
  const liveAppVersion = live?.devices?.app_version;

  return {
    id: dbDevice.id,
    name: dbDevice.label || dbDevice.id,
    deviceId: dbDevice.id,
    status: isOnline ? 'active' : 'offline',
    platform: livePlatform !== undefined ? livePlatform : (dbDevice.platform || null),
    model: liveModel !== undefined ? liveModel : (dbDevice.model || null),
    appVersion: liveAppVersion !== undefined ? liveAppVersion : (dbDevice.app_version || null),
    battery: normalizeBattery(liveBattery !== undefined ? liveBattery : dbDevice.battery),
    lastSeen: effectiveLastSeen,
    lastUpdate: effectiveLastSeen || '--',
    position: isLiveValid ? cleanCoords : null,
    historicalPosition: cleanCoords,
    speed: isLiveValid ? (live?.speed || 0) : 0,
    accuracy: live ? sanitizeAccuracy(live.accuracy) : null,
    bearing: live?.bearing || 0,
    route: [],
    _ephemeral: Boolean(dbDevice._ephemeral) || Boolean(dbDevice._mock_ephemeral),
  }
}

// Transform raw Supabase alert data to UI format
export const transformAlert = (dbAlert) => ({
  id: dbAlert.id,
  severity: dbAlert.severity || 'info',
  title: dbAlert.title || 'Sin título',
  description: dbAlert.description || '',
  vehicleId: dbAlert.vehicle_id || dbAlert.plate,
  vehicleName: dbAlert.vehicle_name || 'Vehículo desconocido',
  plate: dbAlert.plate || 'UNK',
  speed: dbAlert.speed || 0,
  battery: dbAlert.battery || 0,
  voltage: dbAlert.voltage || 12.0,
  timestamp: dbAlert.timestamp || Date.now(),
  locationName: dbAlert.location_name || 'Ubicación',
  lat: dbAlert.lat !== undefined ? dbAlert.lat : null,
  lng: dbAlert.lng !== undefined ? dbAlert.lng : null,
  status: dbAlert.read !== undefined ? (dbAlert.read ? 'resolved' : 'active') : 'active',
})

// Transform raw Supabase geofence data to UI format
export const transformGeofence = (dbGeofence) => {
  const rawPositions = dbGeofence.positions || dbGeofence.coordinates || []
  const validPositions = Array.isArray(rawPositions)
    ? rawPositions
        .map(pos => Array.isArray(pos) && pos.length >= 2 ? [Number(pos[0]), Number(pos[1])] : null)
        .filter(pos => pos && !isNaN(pos[0]) && !isNaN(pos[1]) && pos[0] >= -90 && pos[0] <= 90 && pos[1] >= -180 && pos[1] <= 180)
    : []

  const rawCenter = dbGeofence.center || (validPositions.length > 0 ? validPositions[0] : [4.6097, -74.0817])
  const parsedCenter = Array.isArray(rawCenter) && rawCenter.length >= 2
    ? [Number(rawCenter[0]), Number(rawCenter[1])]
    : [4.6097, -74.0817]

  const cleanCenter = (!isNaN(parsedCenter[0]) && !isNaN(parsedCenter[1]) && parsedCenter[0] >= -90 && parsedCenter[0] <= 90 && parsedCenter[1] >= -180 && parsedCenter[1] <= 180)
    ? parsedCenter
    : [4.6097, -74.0817]

  const parsedRadius = Number(dbGeofence.radius)
  const cleanRadius = (!isNaN(parsedRadius) && parsedRadius > 0) ? parsedRadius : 600

  let rule = dbGeofence.rule
  if (rule !== 'outside' && rule !== 'inside') {
    rule = 'outside'
  }

  const type = dbGeofence.type || 'circle'
  if (type === 'polygon' && validPositions.length < 3) {
    return null
  }

  return {
    id: dbGeofence.id,
    name: dbGeofence.name || 'Geocerca',
    type,
    positions: validPositions,
    center: cleanCenter,
    radius: cleanRadius,
    color: dbGeofence.color || '#00E676',
    rule,
    active: dbGeofence.active !== undefined ? dbGeofence.active : true,
  }
}

// Persist new geofence to Supabase
export const createGeofence = async (geofence) => {
  if (!supabase) return null

  return withAuthRetry(async () => {
    let organizationId = geofence.organization_id || null
    if (!organizationId) {
      try {
        const { data: userResp } = await supabase.auth.getUser()
        if (userResp?.user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('organization_id')
            .eq('user_id', userResp.user.id)
            .maybeSingle()
          if (profile?.organization_id) {
            organizationId = profile.organization_id
          }
        }
      } catch {
        // Ignorar error si no hay usuario autenticado
      }
    }

    const rule = geofence.rule === 'inside' ? 'inside' : 'outside'
    const payload = {
      name: geofence.name || 'Geocerca',
      type: geofence.type || 'circle',
      center: geofence.center,
      positions: geofence.positions || [],
      radius: Number(geofence.radius || 600),
      color: geofence.color || '#00E676',
      rule,
      active: geofence.active !== undefined ? geofence.active : true,
      ...(organizationId ? { organization_id: organizationId } : {}),
    }

    const { data, error } = await supabase
      .from('geofences')
      .insert(payload)
      .select()
      .single()

    if (error) throw error
    return transformGeofence(data)
  })
}

// Fetch vehicles from Supabase - returns raw data
export const fetchVehicles = async () => {
  if (!supabase) return []

  return withAuthRetry(async () => {
    const { data, error } = await supabase
      .from('vehicles')
      // C4: vehicles NO tiene columna last_seen — solo last_update.
      // Incluir last_seen causa PGRST204 y hace fallar toda la lista de vehículos.
      .select('id, device_id, name, plate, driver, status, speed, battery, fuel, temp, odometer, location, route, last_update')
      .order('last_update', { ascending: false, nullsFirst: false })

    if (error) {
      throw error
    }
    return data ? data.map(transformVehicle) : []
  }, 'fetchVehicles')
}

// Fetch registered GPS devices from Supabase
export const fetchDevices = async () => {
  if (!supabase) return []

  return withAuthRetry(async () => {
    const { data, error } = await supabase
      .from('devices')
      .select('id, status, last_seen, platform, model, app_version, battery, label')
      .neq('status', 'inactive')
      .order('last_seen', { ascending: false })

    if (error) {
      throw error
    }
    return data || []
  }, 'fetchDevices')
}

// Fetch alerts from Supabase - returns raw data
export const fetchAlerts = async () => {
  if (!supabase) return []

  return withAuthRetry(async () => {
    const { data, error } = await supabase
      .from('alerts')
      .select('*')
      .order('timestamp', { ascending: false })

    if (error) {
      throw error
    }
    return data ? data.map(transformAlert) : []
  }, 'fetchAlerts')
}

// Fetch geofences from Supabase - returns raw data
export const fetchGeofences = async () => {
  if (!supabase) return []

  return withAuthRetry(async () => {
    const { data, error } = await supabase
      .from('geofences')
      .select('*')

    if (error) {
      throw error
    }
    return data ? data.map(transformGeofence).filter(Boolean) : []
  }, 'fetchGeofences')
}

// useVehicles y useDevices piden las mismas ubicaciones en el mismo ciclo de
// poll. Sin deduplicar, cada tick de 30s dispara dos consultas idénticas.
// Se cachea la respuesta durante un intervalo corto y se comparten las
// peticiones concurentes (single-flight).
const LOCATIONS_TTL_MS = 10_000
let locationsCache = null
let locationsInFlight = null

export const clearQueryCaches = () => {
  locationsCache = null
  locationsInFlight = null
}

export const fetchLatestLocations = async () => {
  if (!supabase) return []

  const now = Date.now()
  if (locationsCache && now - locationsCache.at < LOCATIONS_TTL_MS) {
    return locationsCache.rows
  }
  if (locationsInFlight) return locationsInFlight

  locationsInFlight = withAuthRetry(async () => {
    const { data, error } = await supabase
      .from('latest_gps_locations')
      .select('device_id, latitude, longitude, speed, accuracy, altitude, bearing, timestamp, devices(battery, platform, model, app_version)')

    if (!error && Array.isArray(data)) {
      locationsCache = { at: Date.now(), rows: data }
      return data
    }

    const errCode = String(error?.code || '')
    const errMsg = String(error?.message || '').toLowerCase()
    const isMissingRelation = errCode === 'PGRST202' || errCode === '42P01' || errMsg.includes('relation') || errMsg.includes('does not exist')

    if (!isMissingRelation) {
      console.warn('⚠️ Error al consultar vista latest_gps_locations:', error)
      if (locationsCache && locationsCache.rows) {
        console.warn('⚠️ Usando caché antigua de latest_gps_locations como fallback por fallo transitorio.');
        return locationsCache.rows;
      }
      throw error
    }

    // latest_gps_locations es una VIEW. PostgREST deduce las relaciones embebidas
    // de las FK que encuentra en el catalogo de la DB, y una vista no declara FK, asi
    // que el embed devices(...) falla con PGRST202 aunque gps_locations y devices si
    // esten relacionadas. Sin este fallback el mapa se queda vacio entero.
    console.warn('⚠️ Embed devices(...) no resoluble sobre la vista; reintentando con consulta simple.', error?.message || error)
    return fetchLatestLocationsWithoutEmbed()
  }, 'fetchLatestLocations').finally(() => {
    locationsInFlight = null
  })

  return locationsInFlight
}

// Consulta la vista sin embed y trae la telemetria de devices por separado, uniendo
// ambas en memoria con la misma forma que produce el embed ({ devices: {...} }).
// Asi transformDevice() no necesita cambios y el dashboard no se queda sin mapa.
const fetchLatestLocationsWithoutEmbed = async () => {
  const { data: locations, error: locErr } = await supabase
    .from('latest_gps_locations')
    .select('device_id, latitude, longitude, speed, accuracy, altitude, bearing, timestamp')

  if (locErr) {
    console.warn('⚠️ Vista latest_gps_locations no disponible (PGRST202/42P01).', locErr.message || locErr)
    if (locationsCache && locationsCache.rows) return locationsCache.rows
    throw locErr
  }

  const rows = Array.isArray(locations) ? locations : []
  const deviceIds = [...new Set(rows.map((r) => r.device_id).filter(Boolean))]
  const telemetryById = new Map()

  if (deviceIds.length > 0) {
    const { data: devices, error: devErr } = await supabase
      .from('devices')
      .select('id, battery, platform, model, app_version')
      .in('id', deviceIds)

    if (devErr) {
      // La telemetria es opcional: sin ella el mapa sigue funcionando con la
      // bateria y el modelo de la fila devices de cada dispositivo.
      console.warn('⚠️ No se pudo leer la telemetria de devices; se devuelve la ubicacion sin metadatos.', devErr.message || devErr)
    } else if (Array.isArray(devices)) {
      for (const device of devices) telemetryById.set(device.id, device)
    }
  }

  const merged = rows.map((row) => {
    const telemetry = telemetryById.get(row.device_id)
    return telemetry ? { ...row, devices: telemetry } : row
  })

  locationsCache = { at: Date.now(), rows: merged }
  return merged
}

export const latestLocationsByDevice = (locations = []) => {
  const latestByDevice = new Map()
  for (const location of locations) {
    if (!latestByDevice.has(location.device_id)) latestByDevice.set(location.device_id, location)
  }
  return [...latestByDevice.values()]
}

// Historial de ruta de un dispositivo desde gps_locations (para devices sin ruta embebida).
// Devuelve [lat, lng][] en orden cronológico (más recientes primero en DB, se revierte).
export const fetchDeviceRouteHistory = async (deviceId, limit = 250) => {
  if (!supabase || !deviceId) return []
  return withAuthRetry(async () => {
    const { data, error } = await supabase
      .from('gps_locations')
      .select('latitude, longitude, timestamp')
      .eq('device_id', deviceId)
      .order('timestamp', { ascending: false })
      .limit(limit)

    if (error) {
      const errMsg = `${error.code || ''} ${error.message || ''}`.toLowerCase()
      const isRls = String(error.code).startsWith('PGRST') || errMsg.includes('policy') || errMsg.includes('permission') || errMsg.includes('row-level')
      if (isRls) return [] // Sin permiso para ver historial de este dispositivo
      throw error
    }

    const points = (data || [])
      .reverse()
      .map((r) => [Number(r.latitude), Number(r.longitude)])
      .filter((pt) => isCoordinateValid(pt[0], pt[1]))

    return points
  }, 'fetchDeviceRouteHistory')
}