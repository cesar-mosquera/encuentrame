import { describe, expect, it } from 'vitest'
import {
  fetchDeviceRouteHistory,
  isLocationValidForMap,
  latestLocationsByDevice,
  normalizeBattery,
  sanitizeAccuracy,
  sanitizeRoute,
  transformAlert,
  transformDevice,
  transformGeofence,
  transformVehicle,
} from './queries'
describe('helpers: normalizeBattery, sanitizeAccuracy, sanitizeRoute', () => {
  it('normaliza bateria entre 0% y 100%', () => {
    expect(normalizeBattery(85)).toBe(85)
    expect(normalizeBattery(-10)).toBe(0)
    expect(normalizeBattery(150)).toBe(100)
    expect(normalizeBattery('95')).toBe(95)
    expect(normalizeBattery(null)).toBe(0)
    expect(normalizeBattery(NaN)).toBe(0)
  })

  it('sanitiza precision numerica >= 0', () => {
    expect(sanitizeAccuracy(12.4)).toBe(12)
    expect(sanitizeAccuracy(0)).toBe(0)
    expect(sanitizeAccuracy(-5)).toBeNull()
    expect(sanitizeAccuracy('abc')).toBeNull()
    expect(sanitizeAccuracy(999999)).toBeNull()
    expect(sanitizeAccuracy(null)).toBeNull()
  })

  it('sanitiza rutas descartando coordenadas corruptas', () => {
    const rawRoute = [[4.61, -74.08], null, [NaN, -74.09], [4.62, -74.09], [100, 200]]
    expect(sanitizeRoute(rawRoute)).toEqual([[4.61, -74.08], [4.62, -74.09]])
  })
})

describe('transformVehicle', () => {
  it('normaliza un vehículo incompleto con valores seguros y posición nula si no tiene GPS', () => {
    expect(transformVehicle({ id: 'moto-1', plate: 'ABC-123' })).toMatchObject({
      id: 'moto-1',
      name: 'ABC-123',
      driver: 'Desconocido',
      status: 'offline',
      fuel: 75,
      position: null,
    })
  })

  it('conserva la ruta y telemetría recibidas filtrando corruptos', () => {
    const vehicle = transformVehicle({
      id: 'moto-2',
      name: 'Honda',
      speed: 48,
      position: [4.61, -74.08],
      route: [[4.61, -74.08], null, [4.62, -74.09]],
    })
    expect(vehicle.speed).toBe(48)
    expect(vehicle.route).toEqual([[4.61, -74.08], [4.62, -74.09]])
    expect(vehicle.position).toEqual([4.61, -74.08])
  })

  it('calcula estado offline si last_update/last_seen excede 90 segundos', () => {
    const oldDate = new Date(Date.now() - 120 * 1000).toISOString()
    const vehicle = transformVehicle({
      id: 'moto-stale',
      status: 'active',
      last_update: oldDate,
    })
    expect(vehicle.status).toBe('offline')
  })
})

describe('isLocationValidForMap', () => {
  it('valida fechas recientes y descarta fechas lejanas en el futuro o desactualizadas (> 90s)', () => {
    const now = Date.now()
    expect(isLocationValidForMap(new Date(now - 1000).toISOString())).toBe(true)
    // Fecha en el futuro lejano (+2 horas) descarta
    expect(isLocationValidForMap(new Date(now + 2 * 60 * 60 * 1000).toISOString())).toBe(false)
    // Fecha desactualizada (> 90 segundos) descarta por defecto
    expect(isLocationValidForMap(new Date(now - 120 * 1000).toISOString())).toBe(false)
  })

  it('rechaza coordenadas corruptas, nulas, NaN o fuera de rango', () => {
    const recent = new Date().toISOString()
    const maxAge = 90000
    expect(isLocationValidForMap(recent, maxAge, null, -74.08)).toBe(false)
    expect(isLocationValidForMap(recent, maxAge, 4.6, undefined)).toBe(false)
    expect(isLocationValidForMap(recent, maxAge, NaN, -74.08)).toBe(false)
    expect(isLocationValidForMap(recent, maxAge, 95.0, -74.08)).toBe(false) // Lat out of range
    expect(isLocationValidForMap(recent, maxAge, 4.6, -190.0)).toBe(false) // Lng out of range
    expect(isLocationValidForMap(recent, maxAge, 'invalid', -74.08)).toBe(false)
    expect(isLocationValidForMap(recent, maxAge, 4.6, -74.08)).toBe(true)
  })
})

describe('transformAlert and transformGeofence', () => {
  it('mapea vehicle_id, ubicación y estado de alerta', () => {
    expect(transformAlert({
      id: 'a-1', vehicle_id: 'moto-1', title: 'Exceso', read: true,
      lat: 4.6, lng: -74.08,
    })).toMatchObject({ vehicleId: 'moto-1', status: 'resolved', lat: 4.6 })
  })

  it('convierte coordenadas de geocerca a números', () => {
    const geo = transformGeofence({ id: 'g-1', type: 'circle', center: ['4.6', '-74.08'], radius: '300' })
    expect(geo.center).toEqual([4.6, -74.08])
    expect(geo.radius).toBe(300)
  })

  it('mantiene el contrato de transformación de geocercas en polígono', () => {
    const geo = transformGeofence({
      id: 'geo-1',
      name: 'Zona Prueba',
      type: 'polygon',
      positions: [
        [37.7710, -122.4280],
        [37.7745, -122.4270],
        [37.7740, -122.4200]
      ],
      active: true,
    })
    expect(geo.positions.length).toBeGreaterThan(2)
    expect(geo.active).toBe(true)
  })
})

describe('latestLocationsByDevice', () => {
  it('conserva solo la primera ubicación de cada dispositivo', () => {
    const result = latestLocationsByDevice([
      { device_id: 'moto-1', timestamp: '2026-01-02' },
      { device_id: 'moto-1', timestamp: '2026-01-01' },
      { device_id: 'moto-2', timestamp: '2026-01-03' },
    ])
    expect(result).toEqual([
      { device_id: 'moto-1', timestamp: '2026-01-02' },
      { device_id: 'moto-2', timestamp: '2026-01-03' },
    ])
  })
})

describe('fetchDeviceRouteHistory', () => {
  it('resuelve lista vacía sin configuración de Supabase o sin device_id', async () => {
    await expect(fetchDeviceRouteHistory(null)).resolves.toEqual([])
    await expect(fetchDeviceRouteHistory('')).resolves.toEqual([])
  })
})

describe('transformDevice', () => {
  it('normaliza un dispositivo GPS línea/offline', () => {
    const recentTime = new Date().toISOString()
    expect(transformDevice({ id: 'dev-1', status: 'online', last_seen: recentTime })).toMatchObject({
      id: 'dev-1',
      status: 'active',
      battery: 0,
      position: null,
    })
    expect(transformDevice({ id: 'dev-2', status: 'offline' }).status).toBe('offline')
  })

  it('fusiona la última ubicación viva del dispositivo si es reciente', () => {
    const recentTime = new Date().toISOString()
    const device = transformDevice(
      { id: 'dev-1', battery: 85 },
      { latitude: 4.6, longitude: -74.08, speed: 42, accuracy: 8, bearing: 90, timestamp: recentTime },
    )
    expect(device.position).toEqual([4.6, -74.08])
    expect(device.historicalPosition).toEqual([4.6, -74.08])
    expect(device.speed).toBe(42)
    expect(device.accuracy).toBe(8)
    expect(device.battery).toBe(85)
  })

  it('oculta la posición en el mapa si la ubicación es antigua pero conserva la histórica', () => {
    const oldTimestamp = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() // 48 horas de antigüedad
    const device = transformDevice(
      { id: 'dev-stale' },
      { latitude: 4.6, longitude: -74.08, speed: 50, timestamp: oldTimestamp },
    )
    expect(device.position).toBeNull()
    expect(device.historicalPosition).toEqual([4.6, -74.08])
    expect(device.speed).toBe(0)
  })

  it('preserva la precisión cuando es 0 m', () => {
    const recentTime = new Date().toISOString()
    const device = transformDevice(
      { id: 'dev-zero-acc' },
      { latitude: 4.6, longitude: -74.08, speed: 0, accuracy: 0, timestamp: recentTime },
    )
    expect(device.accuracy).toBe(0)
  })
})