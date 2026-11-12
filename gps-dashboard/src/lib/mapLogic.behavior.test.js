// @vitest-environment node
/**
 * Tests de COMPORTAMIENTO REAL para mapLogic.js
 *
 * Estos tests NO verifican texto en pantalla.
 * Verifican que las funciones de negocio retornen los valores correctos,
 * manejen datos corruptos y detecten casos de borde.
 * Si la lógica cambia, estos tests fallan.
 */
import { describe, it, expect } from 'vitest'
import {
  parsePoint,
  isVehicleInsideCircle,
  isVehicleInsidePolygon,
  routeColorForSpeed,
  deviceStatusFromLastSeen,
  routeDistanceKm,
  projectedPath,
  routeAhead,
  fleetPositions,
} from './mapLogic'
import { formatNavDistance, formatNavDuration } from './routing'

// ─── parsePoint ──────────────────────────────────────────────────────────────
describe('parsePoint', () => {
  it('acepta array [lat, lng] válido', () => {
    expect(parsePoint([4.6097, -74.0817])).toEqual([4.6097, -74.0817])
  })

  it('acepta objeto { lat, lng }', () => {
    expect(parsePoint({ lat: 4.6, lng: -74.0 })).toEqual([4.6, -74.0])
  })

  it('acepta objeto { latitude, longitude }', () => {
    expect(parsePoint({ latitude: 4.6, longitude: -74.0 })).toEqual([4.6, -74.0])
  })

  it('retorna null si el punto es null', () => {
    expect(parsePoint(null)).toBeNull()
  })

  it('retorna null si el punto es undefined', () => {
    expect(parsePoint(undefined)).toBeNull()
  })

  it('retorna null si lat está fuera de rango (> 90)', () => {
    expect(parsePoint([91, -74.0])).toBeNull()
  })

  it('retorna null si lat está fuera de rango (< -90)', () => {
    expect(parsePoint([-91, -74.0])).toBeNull()
  })

  it('retorna null si lng está fuera de rango (> 180)', () => {
    expect(parsePoint([4.6, 181])).toBeNull()
  })

  it('retorna null si lng está fuera de rango (< -180)', () => {
    expect(parsePoint([4.6, -181])).toBeNull()
  })

  it('retorna null si alguna coordenada es NaN', () => {
    expect(parsePoint([NaN, -74.0])).toBeNull()
    expect(parsePoint([4.6, NaN])).toBeNull()
  })

  it('retorna null si las coordenadas son strings no numéricos', () => {
    expect(parsePoint(['abc', 'xyz'])).toBeNull()
  })

  it('acepta coordenadas en los límites exactos (-90, 90, -180, 180)', () => {
    expect(parsePoint([90, 180])).toEqual([90, 180])
    expect(parsePoint([-90, -180])).toEqual([-90, -180])
  })

  it('retorna null si el array tiene menos de 2 elementos', () => {
    expect(parsePoint([4.6])).toBeNull()
  })
})

// ─── routeColorForSpeed ───────────────────────────────────────────────────────
describe('routeColorForSpeed', () => {
  it('retorna verde para velocidad 0', () => {
    expect(routeColorForSpeed(0)).toBe('#58e6b0')
  })

  it('retorna verde para velocidad 60 exacto (no supera el umbral)', () => {
    expect(routeColorForSpeed(60)).toBe('#58e6b0')
  })

  it('retorna amarillo para velocidad 61 (supera 60)', () => {
    expect(routeColorForSpeed(61)).toBe('#f2c66d')
  })

  it('retorna amarillo para velocidad 80 exacto (no supera el umbral de 80)', () => {
    expect(routeColorForSpeed(80)).toBe('#f2c66d')
  })

  it('retorna rojo para velocidad 81 (supera 80)', () => {
    expect(routeColorForSpeed(81)).toBe('#ef5c72')
  })

  it('retorna rojo para velocidades muy altas', () => {
    expect(routeColorForSpeed(200)).toBe('#ef5c72')
  })

  it('retorna verde si no se pasa velocidad (default 0)', () => {
    expect(routeColorForSpeed()).toBe('#58e6b0')
  })
})

// ─── deviceStatusFromLastSeen ─────────────────────────────────────────────────
describe('deviceStatusFromLastSeen', () => {
  const now = Date.now()

  it('retorna active si el timestamp es reciente (< 90 seg)', () => {
    const recent = new Date(now - 30_000).toISOString()
    expect(deviceStatusFromLastSeen(recent, now)).toBe('active')
  })

  it('retorna offline si el timestamp superó el timeout de 90 seg', () => {
    const old = new Date(now - 91_000).toISOString()
    expect(deviceStatusFromLastSeen(old, now)).toBe('offline')
  })

  it('retorna offline si el timestamp es null', () => {
    expect(deviceStatusFromLastSeen(null, now)).toBe('offline')
  })

  it('retorna offline si el timestamp es un string inválido', () => {
    expect(deviceStatusFromLastSeen('no-es-fecha', now)).toBe('offline')
  })

  it('retorna offline si el timestamp está en el futuro lejano (> 5 min)', () => {
    const future = new Date(now + 10 * 60_000).toISOString() // +10 min
    expect(deviceStatusFromLastSeen(future, now)).toBe('offline')
  })

  it('retorna active si el timestamp está en el futuro cercano (< 5 min, tolerancia de reloj)', () => {
    const slightFuture = new Date(now + 60_000).toISOString() // +1 min
    expect(deviceStatusFromLastSeen(slightFuture, now)).toBe('active')
  })

  it('retorna offline exacto en el límite del timeout', () => {
    const atLimit = new Date(now - 90_001).toISOString()
    expect(deviceStatusFromLastSeen(atLimit, now)).toBe('offline')
  })
})

// ─── isVehicleInsideCircle ────────────────────────────────────────────────────
describe('isVehicleInsideCircle', () => {
  const center = [4.6097, -74.0817] // Bogotá aprox
  const radiusM = 500

  it('retorna true si el vehículo está en el centro exacto', () => {
    expect(isVehicleInsideCircle(center, center, radiusM)).toBe(true)
  })

  it('retorna true si el vehículo está dentro del radio', () => {
    // ~100m al norte del centro
    const inside = [4.6106, -74.0817]
    expect(isVehicleInsideCircle(inside, center, radiusM)).toBe(true)
  })

  it('retorna false si el vehículo está fuera del radio', () => {
    // ~5km al norte del centro
    const outside = [4.655, -74.0817]
    expect(isVehicleInsideCircle(outside, center, radiusM)).toBe(false)
  })

  it('retorna false si la posición del vehículo es null', () => {
    expect(isVehicleInsideCircle(null, center, radiusM)).toBe(false)
  })

  it('retorna false si el centro es null', () => {
    expect(isVehicleInsideCircle(center, null, radiusM)).toBe(false)
  })

  it('retorna false si el radio es 0', () => {
    expect(isVehicleInsideCircle(center, center, 0)).toBe(false)
  })

  it('retorna false si el radio es negativo', () => {
    expect(isVehicleInsideCircle(center, center, -100)).toBe(false)
  })

  it('retorna false si el radio es NaN', () => {
    expect(isVehicleInsideCircle(center, center, NaN)).toBe(false)
  })
})

// ─── isVehicleInsidePolygon ───────────────────────────────────────────────────
describe('isVehicleInsidePolygon', () => {
  // Cuadrado de 1 grado alrededor de [0, 0]
  const square = [
    [-1, -1],
    [-1, 1],
    [1, 1],
    [1, -1],
  ]

  it('retorna true si el punto está dentro del polígono', () => {
    expect(isVehicleInsidePolygon([0, 0], square)).toBe(true)
  })

  it('retorna false si el punto está fuera del polígono', () => {
    expect(isVehicleInsidePolygon([5, 5], square)).toBe(false)
  })

  it('retorna true si el punto está exactamente en el borde del polígono', () => {
    // Punto en el borde superior [-1, 0]
    expect(isVehicleInsidePolygon([-1, 0], square)).toBe(true)
  })

  it('retorna false si el polígono tiene menos de 3 puntos', () => {
    expect(isVehicleInsidePolygon([0, 0], [[-1, -1], [1, 1]])).toBe(false)
  })

  it('retorna false si la posición del vehículo es null', () => {
    expect(isVehicleInsidePolygon(null, square)).toBe(false)
  })

  it('retorna false si el polígono no es un array', () => {
    expect(isVehicleInsidePolygon([0, 0], null)).toBe(false)
  })

  it('filtra puntos inválidos en el polígono y retorna false si quedan < 3', () => {
    const badPolygon = [[null, null], [1, 1], ['x', 'y']]
    expect(isVehicleInsidePolygon([0, 0], badPolygon)).toBe(false)
  })
})

// ─── routeDistanceKm ─────────────────────────────────────────────────────────
describe('routeDistanceKm', () => {
  it('retorna 0 para array vacío', () => {
    expect(routeDistanceKm([])).toBe(0)
  })

  it('retorna 0 para un solo punto (no hay segmentos)', () => {
    expect(routeDistanceKm([[4.6, -74.0]])).toBe(0)
  })

  it('retorna 0 para puntos idénticos repetidos', () => {
    expect(routeDistanceKm([[4.6, -74.0], [4.6, -74.0]])).toBe(0)
  })

  it('retorna distancia positiva para dos puntos distintos', () => {
    const dist = routeDistanceKm([[0, 0], [0, 1]])
    expect(dist).toBeGreaterThan(0)
  })

  it('retorna ~111 km por cada grado de latitud', () => {
    // 1 grado de latitud ≈ 111.32 km
    const dist = routeDistanceKm([[0, 0], [1, 0]])
    expect(dist).toBeCloseTo(111.32, 0)
  })

  it('la distancia A→B es la misma que B→A (simetría)', () => {
    const a = [[0, 0], [1, 1]]
    const b = [[1, 1], [0, 0]]
    expect(routeDistanceKm(a)).toBeCloseTo(routeDistanceKm(b), 5)
  })
})

// ─── projectedPath ────────────────────────────────────────────────────────────
describe('projectedPath', () => {
  it('retorna array vacío si position es null', () => {
    expect(projectedPath(null)).toEqual([])
  })

  it('retorna array vacío si position tiene coordenadas NaN', () => {
    expect(projectedPath([NaN, 0])).toEqual([])
  })

  it('retorna array vacío si position tiene menos de 2 elementos', () => {
    expect(projectedPath([4.6])).toEqual([])
  })

  it('retorna `steps` puntos proyectados hacia adelante', () => {
    const path = projectedPath([4.6097, -74.0817], 0, 700, 7)
    expect(path).toHaveLength(7)
  })

  it('todos los puntos proyectados son coordenadas finitas', () => {
    const path = projectedPath([4.6097, -74.0817], 45, 500, 5)
    for (const [lat, lng] of path) {
      expect(Number.isFinite(lat)).toBe(true)
      expect(Number.isFinite(lng)).toBe(true)
    }
  })

  it('bearing negativo no rompe la función', () => {
    const path = projectedPath([4.6097, -74.0817], -90, 700, 3)
    expect(path).toHaveLength(3)
  })
})

// ─── fleetPositions ───────────────────────────────────────────────────────────
describe('fleetPositions', () => {
  it('retorna solo las posiciones de vehículos con position válida', () => {
    const fleet = [
      { id: 'A', position: [4.6, -74.0] },
      { id: 'B', position: null },
      { id: 'C', position: [4.7, -74.1] },
      { id: 'D' }, // sin position
    ]
    expect(fleetPositions(fleet)).toEqual([[4.6, -74.0], [4.7, -74.1]])
  })

  it('retorna array vacío si no hay vehículos con posición', () => {
    expect(fleetPositions([{ id: 'A', position: null }])).toEqual([])
  })

  it('retorna array vacío si se llama sin argumentos', () => {
    expect(fleetPositions()).toEqual([])
  })
})

// ─── routeAhead ───────────────────────────────────────────────────────────────
describe('routeAhead', () => {
  const route = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]

  it('retorna array vacío si position es null', () => {
    expect(routeAhead(null, route)).toEqual([])
  })

  it('retorna array vacío si route es vacío', () => {
    expect(routeAhead([0, 0], [])).toEqual([])
  })

  it('retorna `count` puntos hacia adelante desde el punto más cercano', () => {
    const ahead = routeAhead([2, 0], route, 3)
    expect(ahead).toHaveLength(3)
    // El más cercano a [2,0] es el índice 2 → [2,0]
    expect(ahead[0]).toEqual([2, 0])
  })
})

// ─── formatNavDistance (de routing.js) ────────────────────────────────────────
describe('formatNavDistance', () => {
  it('retorna metros para distancias < 1000m', () => {
    expect(formatNavDistance(500)).toBe('500 m')
  })

  it('retorna "0 m" para distancia 0', () => {
    expect(formatNavDistance(0)).toBe('0 m')
  })

  it('convierte a km exacto en 1000m', () => {
    expect(formatNavDistance(1000)).toBe('1.0 km')
  })

  it('retorna km con 1 decimal para distancias >= 1000m', () => {
    expect(formatNavDistance(2500)).toBe('2.5 km')
  })

  it('no retorna metros negativos (mínimo 0)', () => {
    expect(formatNavDistance(-100)).toBe('0 m')
  })
})

// ─── formatNavDuration (de routing.js) ────────────────────────────────────────
describe('formatNavDuration', () => {
  it('retorna "--" para NaN', () => {
    expect(formatNavDuration(NaN)).toBe('--')
  })

  it('retorna "--" para Infinity', () => {
    expect(formatNavDuration(Infinity)).toBe('--')
  })

  it('retorna segundos si Math.round(s/60) < 1 (menos de 30s)', () => {
    // Math.round(29/60) = 0 → muestra segundos
    expect(formatNavDuration(29)).toBe('29 s')
  })

  it('retorna "1 min" para 30s exacto (Math.round(30/60) = 1)', () => {
    // Comportamiento real: 30s se redondea a 1 min
    expect(formatNavDuration(30)).toBe('1 min')
  })

  it('retorna mínimo 1s para 0 segundos', () => {
    expect(formatNavDuration(0)).toBe('1 s')
  })

  it('retorna minutos para >= 60s', () => {
    expect(formatNavDuration(120)).toBe('2 min')
  })

  it('retorna horas y minutos para >= 3600s', () => {
    expect(formatNavDuration(3660)).toBe('1 h 1 min')
  })

  it('retorna exactamente "1 h 0 min" para 3600s exactos', () => {
    expect(formatNavDuration(3600)).toBe('1 h 0 min')
  })
})
