import { useEffect, useMemo, useState } from 'react'

const MOCK_ROUTES = [
  { id: 'SIM-ALPHA', name: 'Alpha-7', base: [4.6543, -74.0863], radius: 0.0016, speedBase: 42, phase: 0 },
  { id: 'SIM-BRAVO', name: 'Bravo-12', base: [4.6012, -74.0685], radius: 0.0012, speedBase: 63, phase: 2.1 },
  { id: 'SIM-CHARLIE', name: 'Charlie-05', base: [4.6289, -74.0952], radius: 0.0009, speedBase: 28, phase: 4.2 },
]

const STORAGE_KEY = 'rg_deleted_demos'
const storage = () => (typeof window !== 'undefined' && window.localStorage ? window.localStorage : null)
const ENABLE_DEMOS = Boolean(import.meta.env.DEV)

export const getDeletedDemos = () => {
  try {
    const raw = storage()?.getItem(STORAGE_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? new Set(arr) : new Set()
  } catch {
    return new Set()
  }
}

const persistDeletedDemos = (deleted) => {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify([...deleted]))
  } catch {
    /* almacenamiento no disponible */
  }
}

const buildRoute = (base, radius) => {
  const route = []
  const STEPS = 44
  for (let i = 0; i < STEPS; i++) {
    const a = (i / STEPS) * Math.PI * 2
    route.push([
      Number((base[0] + Math.cos(a) * radius).toFixed(6)),
      Number((base[1] + Math.sin(a) * radius).toFixed(6)),
    ])
  }
  return route
}

const seedUnit = (route) => ({
  id: route.id,
  name: route.name,
  plate: route.id,
  driver: 'Sistema DEMO',
  status: 'active',
  speed: 0,
  bearing: 0,
  battery: 74 + Math.round(Math.random() * 18),
  accuracy: 8,
  position: route.route[0],
  route: route.route,
  lastUpdate: 'Ahora',
  controlState: undefined,
  _mock: true,
  _kind: 'device',
})

export const useSimulatedFleet = (realCount) => {
  const [deleted, setDeleted] = useState(() => (ENABLE_DEMOS ? getDeletedDemos() : new Set()))
  const [units, setUnits] = useState(() =>
    ENABLE_DEMOS && realCount < 3
      ? MOCK_ROUTES.filter((r) => !getDeletedDemos().has(r.id)).map((r) => seedUnit({ ...r, route: buildRoute(r.base, r.radius) }))
      : [],
  )

  useEffect(() => {
    if (!ENABLE_DEMOS || realCount >= 3) return undefined

    let step = 0
    const timer = setInterval(() => {
      step++
      setUnits((prev) =>
        prev.map((u, i) => {
          const r = MOCK_ROUTES.find((c) => c.id === u.id) || MOCK_ROUTES[i]
          const route = prev[i]?.route || buildRoute(r.base, r.radius)
          const idx = step % route.length
          const next = route[(idx + 1) % route.length]
          const speed = Math.max(0, Math.min(120, Math.round(r.speedBase + Math.sin(step * 0.2 + r.phase) * 22)))
          const dx = next[0] - u.position[0]
          const dy = next[1] - u.position[1]
          let bearing = Math.round((Math.atan2(dx, dy) * 180) / Math.PI)
          if (bearing < 0) bearing += 360
          return { ...u, position: next, speed, bearing, battery: Math.max(4, Math.min(100, u.battery + (step % 6 === 0 ? -1 : 0))) }
        }),
      )
    }, 1200)
    return () => clearInterval(timer)
  }, [realCount])

  const removeUnit = (unitId) => {
    if (!ENABLE_DEMOS) return
    setUnits((prev) => prev.filter((u) => u.id !== unitId))
    setDeleted((prevIds) => {
      const next = new Set(prevIds)
      next.add(unitId)
      persistDeletedDemos(next)
      return next
    })
  }

  const resetDemos = () => {
    setDeleted(new Set())
    persistDeletedDemos(new Set())
    setUnits(MOCK_ROUTES.map((r) => seedUnit({ ...r, route: buildRoute(r.base, r.radius) })))
  }

  return useMemo(
    () => ({
      units: ENABLE_DEMOS && realCount < 3 ? units : [],
      removeUnit,
      resetDemos,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- units se regenera cada tick; solo interesa realCount para recalcul
    [realCount, units, deleted],
  )
}