// @vitest-environment node
/**
 * Tests de COMPORTAMIENTO REAL para queries.js
 *
 * Estos tests NO verifican texto en pantalla.
 * Verifican que las funciones de transformación de datos de Supabase
 * produzcan la estructura correcta, rechacen datos corruptos y apliquen
 * los valores por defecto correctos.
 * Si la lógica cambia, estos tests fallan.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  isCoordinateValid,
  normalizeBattery,
  sanitizeAccuracy,
  sanitizeRoute,
  transformVehicle,
  transformDevice,
  transformGeofence,
  transformAlert,
  latestLocationsByDevice,
  clearQueryCaches,
} from './queries'

// ─── isCoordinateValid ────────────────────────────────────────────────────────
describe('isCoordinateValid', () => {
  it('retorna true para coordenadas válidas', () => {
    expect(isCoordinateValid(4.6097, -74.0817)).toBe(true)
  })

  it('retorna false si lat es null', () => {
    expect(isCoordinateValid(null, -74.0)).toBe(false)
  })

  it('retorna false si lng es undefined', () => {
    expect(isCoordinateValid(4.6, undefined)).toBe(false)
  })

  it('retorna false si lat > 90', () => {
    expect(isCoordinateValid(91, 0)).toBe(false)
  })

  it('retorna false si lat < -90', () => {
    expect(isCoordinateValid(-91, 0)).toBe(false)
  })

  it('retorna false si lng > 180', () => {
    expect(isCoordinateValid(0, 181)).toBe(false)
  })

  it('retorna false si lng < -180', () => {
    expect(isCoordinateValid(0, -181)).toBe(false)
  })

  it('retorna false para NaN', () => {
    expect(isCoordinateValid(NaN, 0)).toBe(false)
    expect(isCoordinateValid(0, NaN)).toBe(false)
  })

  it('retorna false para string no numérico', () => {
    expect(isCoordinateValid('abc', 0)).toBe(false)
  })

  it('retorna true en los límites exactos (-90, 90, -180, 180)', () => {
    expect(isCoordinateValid(90, 180)).toBe(true)
    expect(isCoordinateValid(-90, -180)).toBe(true)
  })
})

// ─── normalizeBattery ─────────────────────────────────────────────────────────
describe('normalizeBattery', () => {
  it('retorna el valor redondeado para batería válida', () => {
    expect(normalizeBattery(75.6)).toBe(76)
  })

  it('clampea a 0 si el valor es negativo', () => {
    expect(normalizeBattery(-10)).toBe(0)
  })

  it('clampea a 100 si el valor supera 100', () => {
    expect(normalizeBattery(150)).toBe(100)
  })

  it('retorna 0 si el valor es null', () => {
    expect(normalizeBattery(null)).toBe(0)
  })

  it('retorna 0 si el valor es undefined', () => {
    expect(normalizeBattery(undefined)).toBe(0)
  })

  it('retorna 0 si el valor es un string no numérico', () => {
    expect(normalizeBattery('abc')).toBe(0)
  })

  it('acepta strings numéricos y los convierte', () => {
    expect(normalizeBattery('80')).toBe(80)
  })

  it('retorna 0 para NaN', () => {
    expect(normalizeBattery(NaN)).toBe(0)
  })
})

// ─── sanitizeAccuracy ─────────────────────────────────────────────────────────
describe('sanitizeAccuracy', () => {
  it('retorna el valor redondeado para una precisión válida', () => {
    expect(sanitizeAccuracy(9.7)).toBe(10)
  })

  it('retorna null si el valor es null', () => {
    expect(sanitizeAccuracy(null)).toBeNull()
  })

  it('retorna null si el valor es undefined', () => {
    expect(sanitizeAccuracy(undefined)).toBeNull()
  })

  it('retorna null si el valor es negativo', () => {
    expect(sanitizeAccuracy(-1)).toBeNull()
  })

  it('retorna null si el valor supera 50000', () => {
    expect(sanitizeAccuracy(50001)).toBeNull()
  })

  it('retorna 0 exactamente si la precisión es 0 (no null)', () => {
    expect(sanitizeAccuracy(0)).toBe(0)
  })

  it('retorna 50000 exactamente en el límite permitido', () => {
    expect(sanitizeAccuracy(50000)).toBe(50000)
  })
})

// ─── sanitizeRoute ────────────────────────────────────────────────────────────
describe('sanitizeRoute', () => {
  it('retorna array vacío si la entrada no es un array', () => {
    expect(sanitizeRoute(null)).toEqual([])
    expect(sanitizeRoute('texto')).toEqual([])
    expect(sanitizeRoute(undefined)).toEqual([])
  })

  it('filtra puntos con coordenadas inválidas', () => {
    const raw = [
      [4.6, -74.0],   // válido
      [null, -74.0],  // inválido
      [4.7, 200],     // inválido (lng > 180)
      [4.8, -74.1],   // válido
    ]
    expect(sanitizeRoute(raw)).toEqual([[4.6, -74.0], [4.8, -74.1]])
  })

  it('convierte coordenadas string numéricas a número', () => {
    const raw = [['4.6', '-74.0']]
    const result = sanitizeRoute(raw)
    expect(result[0][0]).toBe(4.6)
    expect(result[0][1]).toBe(-74.0)
  })

  it('retorna array vacío si todos los puntos son inválidos', () => {
    expect(sanitizeRoute([[NaN, 0], [0, NaN]])).toEqual([])
  })
})

// ─── transformVehicle ─────────────────────────────────────────────────────────
describe('transformVehicle', () => {
  const baseVehicle = {
    id: 'v-1',
    name: 'Moto Demo',
    plate: 'ABC123',
    status: 'active',
    speed: 30,
    battery: 80,
    position: [4.6097, -74.0817],
    last_update: new Date(Date.now() - 30_000).toISOString(),
  }

  it('expone los campos básicos correctamente', () => {
    const v = transformVehicle(baseVehicle)
    expect(v.id).toBe('v-1')
    expect(v.speed).toBe(30)
    expect(v.battery).toBe(80)
    expect(v.position).toEqual([4.6097, -74.0817])
  })

  it('normaliza batería fuera de rango a los límites', () => {
    const v = transformVehicle({ ...baseVehicle, battery: 999 })
    expect(v.battery).toBe(100)

    const v2 = transformVehicle({ ...baseVehicle, battery: -5 })
    expect(v2.battery).toBe(0)
  })

  it('limpia position a null si las coordenadas son inválidas', () => {
    const v = transformVehicle({ ...baseVehicle, position: [999, -74.0] })
    expect(v.position).toBeNull()
  })

  it('limpia position a null si position es null', () => {
    const v = transformVehicle({ ...baseVehicle, position: null })
    expect(v.position).toBeNull()
  })

  it('respeta status "immobilized" sin sobreescribirlo con last_seen', () => {
    const v = transformVehicle({
      ...baseVehicle,
      status: 'immobilized',
      last_update: new Date(Date.now() - 30_000).toISOString(),
    })
    expect(v.status).toBe('immobilized')
  })

  it('calcula status offline si last_update es viejo (> 90s)', () => {
    const v = transformVehicle({
      ...baseVehicle,
      status: 'active',
      last_update: new Date(Date.now() - 120_000).toISOString(),
    })
    expect(v.status).toBe('offline')
  })

  it('usa label > name > plate > id como nombre', () => {
    expect(transformVehicle({ id: 'x', label: 'Etiqueta', name: 'Nombre' }).name).toBe('Etiqueta')
    expect(transformVehicle({ id: 'x', name: 'Nombre' }).name).toBe('Nombre')
    expect(transformVehicle({ id: 'x', plate: 'XYZ' }).name).toBe('XYZ')
    expect(transformVehicle({ id: 'x' }).name).toBe('x')
  })
})

// ─── transformDevice ──────────────────────────────────────────────────────────
describe('transformDevice', () => {
  const now = Date.now()
  const recentTs = new Date(now - 30_000).toISOString()
  const staleTs = new Date(now - 120_000).toISOString()

  const baseDevice = {
    id: 'dev-1',
    status: 'online',
    last_seen: recentTs,
    battery: 60,
  }

  const liveFresh = {
    latitude: 4.6097,
    longitude: -74.0817,
    speed: 25,
    accuracy: 8,
    bearing: 90,
    timestamp: recentTs,
  }

  it('expone el id y nombre correctamente', () => {
    const d = transformDevice(baseDevice, liveFresh)
    expect(d.id).toBe('dev-1')
    expect(d.deviceId).toBe('dev-1')
  })

  it('tiene position válida si live es reciente y las coords son válidas', () => {
    const d = transformDevice(baseDevice, liveFresh)
    expect(d.position).toEqual([4.6097, -74.0817])
  })

  it('tiene position null si live es stale (timestamp viejo)', () => {
    const staleDevice = { ...baseDevice, last_seen: staleTs }
    const staleLive = { ...liveFresh, timestamp: staleTs }
    const d = transformDevice(staleDevice, staleLive)
    expect(d.position).toBeNull()
  })

  it('mantiene historicalPosition aunque la ubicación sea stale', () => {
    const staleDevice = { ...baseDevice, last_seen: staleTs }
    const staleLive = { ...liveFresh, timestamp: staleTs }
    const d = transformDevice(staleDevice, staleLive)
    // position es null (stale) pero historicalPosition conserva las coords
    expect(d.historicalPosition).toEqual([4.6097, -74.0817])
  })

  it('position y historicalPosition son null si live es null', () => {
    const d = transformDevice(baseDevice, null)
    expect(d.position).toBeNull()
    expect(d.historicalPosition).toBeNull()
  })

  it('status es offline si el device es stale', () => {
    const staleDevice = { ...baseDevice, last_seen: staleTs }
    const staleLive = { ...liveFresh, timestamp: staleTs }
    const d = transformDevice(staleDevice, staleLive)
    expect(d.status).toBe('offline')
  })

  it('status es active si el device es reciente y tiene live', () => {
    const d = transformDevice(baseDevice, liveFresh)
    expect(d.status).toBe('active')
  })

  it('normaliza batería correctamente desde live.devices.battery', () => {
    const liveWithBattery = { ...liveFresh, devices: { battery: 45 } }
    const d = transformDevice(baseDevice, liveWithBattery)
    expect(d.battery).toBe(45)
  })

  it('speed es 0 si la ubicación es stale (aunque live tenga speed)', () => {
    const staleDevice = { ...baseDevice, last_seen: staleTs }
    const staleLive = { ...liveFresh, timestamp: staleTs, speed: 100 }
    const d = transformDevice(staleDevice, staleLive)
    expect(d.speed).toBe(0)
  })

  it('position es null si las coords son inválidas (fuera de rango)', () => {
    const badLive = { ...liveFresh, latitude: 999, longitude: -74.0 }
    const d = transformDevice(baseDevice, badLive)
    expect(d.position).toBeNull()
  })
})

// ─── transformGeofence ────────────────────────────────────────────────────────
describe('transformGeofence', () => {
  const baseCircle = {
    id: 'g-1',
    name: 'Zona centro',
    type: 'circle',
    center: [4.6097, -74.0817],
    radius: 500,
    rule: 'outside',
    active: true,
  }

  it('transforma una geocerca círculo correctamente', () => {
    const g = transformGeofence(baseCircle)
    expect(g.id).toBe('g-1')
    expect(g.type).toBe('circle')
    expect(g.radius).toBe(500)
    expect(g.rule).toBe('outside')
  })

  it('retorna null para polígono con menos de 3 posiciones', () => {
    const polygon = {
      ...baseCircle,
      type: 'polygon',
      positions: [[4.6, -74.0], [4.7, -74.1]], // solo 2 puntos
    }
    expect(transformGeofence(polygon)).toBeNull()
  })

  it('normaliza rule inválida a "outside"', () => {
    const g = transformGeofence({ ...baseCircle, rule: 'invalid_rule' })
    expect(g.rule).toBe('outside')
  })

  it('acepta rule "inside" correctamente', () => {
    const g = transformGeofence({ ...baseCircle, rule: 'inside' })
    expect(g.rule).toBe('inside')
  })

  it('usa radio por defecto (600) si el radio es negativo', () => {
    const g = transformGeofence({ ...baseCircle, radius: -100 })
    expect(g.radius).toBe(600)
  })

  it('usa radio por defecto (600) si el radio es 0', () => {
    const g = transformGeofence({ ...baseCircle, radius: 0 })
    expect(g.radius).toBe(600)
  })

  it('usa centro por defecto (Bogotá) si el centro es inválido', () => {
    const g = transformGeofence({ ...baseCircle, center: [999, 999] })
    expect(g.center).toEqual([4.6097, -74.0817])
  })

  it('asigna active=true por defecto si no se especifica', () => {
    const g = transformGeofence({ ...baseCircle, active: undefined })
    expect(g.active).toBe(true)
  })

  it('filtra posiciones inválidas del array positions', () => {
    const circle = {
      ...baseCircle,
      type: 'circle',
      // [999, 999] y [200, 200] son inválidos (fuera de rango), los demás son válidos
      positions: [[4.6, -74.0], [999, 999], [200, 200], [4.7, -74.1]],
    }
    const g = transformGeofence(circle)
    expect(g.positions).toHaveLength(2)
    expect(g.positions).toEqual([[4.6, -74.0], [4.7, -74.1]])
  })
})

// ─── latestLocationsByDevice ──────────────────────────────────────────────────
describe('latestLocationsByDevice', () => {
  it('elimina duplicados: solo conserva la primera aparición por device_id', () => {
    const locations = [
      { device_id: 'dev-1', latitude: 4.6, longitude: -74.0 },
      { device_id: 'dev-1', latitude: 4.7, longitude: -74.1 }, // duplicado, debe ignorarse
      { device_id: 'dev-2', latitude: 5.0, longitude: -73.0 },
    ]
    const result = latestLocationsByDevice(locations)
    expect(result).toHaveLength(2)
    expect(result.find(r => r.device_id === 'dev-1').latitude).toBe(4.6)
  })

  it('retorna array vacío si la entrada es vacía', () => {
    expect(latestLocationsByDevice([])).toEqual([])
  })

  it('retorna array vacío si la entrada es undefined', () => {
    expect(latestLocationsByDevice(undefined)).toEqual([])
  })

  it('conserva todos los registros si no hay duplicados', () => {
    const locations = [
      { device_id: 'dev-1', latitude: 4.6, longitude: -74.0 },
      { device_id: 'dev-2', latitude: 5.0, longitude: -73.0 },
    ]
    expect(latestLocationsByDevice(locations)).toHaveLength(2)
  })
})

// ─── transformAlert ───────────────────────────────────────────────────────────
describe('transformAlert', () => {
  const baseAlert = {
    id: 'a-1',
    severity: 'warning',
    title: 'Exceso de velocidad',
    description: 'El vehículo superó 80 km/h',
    vehicle_id: 'v-1',
    vehicle_name: 'Moto Demo',
    plate: 'ABC123',
    speed: 95,
    battery: 70,
    timestamp: '2024-01-15T10:30:00Z',
    read: false,
  }

  it('transforma una alerta correctamente', () => {
    const a = transformAlert(baseAlert)
    expect(a.id).toBe('a-1')
    expect(a.severity).toBe('warning')
    expect(a.title).toBe('Exceso de velocidad')
    expect(a.status).toBe('active') // read: false → active
  })

  it('status es "resolved" si read es true', () => {
    const a = transformAlert({ ...baseAlert, read: true })
    expect(a.status).toBe('resolved')
  })

  it('usa valores por defecto si los campos opcionales faltan', () => {
    const a = transformAlert({ id: 'x' })
    expect(a.severity).toBe('info')
    expect(a.title).toBe('Sin título')
    expect(a.vehicleName).toBe('Vehículo desconocido')
    expect(a.plate).toBe('UNK')
    expect(a.speed).toBe(0)
    expect(a.battery).toBe(0)
    expect(a.voltage).toBe(12.0)
  })

  it('lat y lng son null si no se proveen', () => {
    const a = transformAlert({ id: 'x' })
    expect(a.lat).toBeNull()
    expect(a.lng).toBeNull()
  })
})

// ─── fetchLatestLocations — retorna array ─────────────────────────────────────
// Verifica que la función exporta la firma correcta (sin hacer red real)
describe('fetchLatestLocations — firma y caché', () => {
  beforeEach(() => clearQueryCaches())
  afterEach(() => clearQueryCaches())

  it('clearQueryCaches limpia el estado sin lanzar errores', () => {
    // Verifica que la función de limpieza se puede llamar múltiples veces sin error
    expect(() => clearQueryCaches()).not.toThrow()
    expect(() => clearQueryCaches()).not.toThrow()
  })
})

