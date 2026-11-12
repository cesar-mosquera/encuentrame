const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving'

const toLonLat = (point) => {
  const lat = Number(point?.[0])
  const lng = Number(point?.[1])
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    ? `${lng.toFixed(6)},${lat.toFixed(6)}`
    : null
}

export const fetchDrivingRoute = async (origin, destination, { signal } = {}) => {
  const from = toLonLat(origin)
  const to = toLonLat(destination)
  if (!from || !to) return null

  const url = `${OSRM_BASE}/${from};${to}?overview=full&geometries=geojson&steps=false&alternatives=false`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Ruta no disponible (${res.status})`)

  const data = await res.json()
  if (!data?.routes?.[0]?.geometry?.coordinates?.length) return null

  const coords = data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng])
  const route = data.routes[0]

  return {
    coords,
    distanceM: Math.round(route.distance || 0),
    durationS: Math.round(route.duration || 0),
  }
}

export const formatNavDistance = (meters) => {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`
  return `${Math.max(0, Math.round(meters))} m`
}

export const formatNavDuration = (seconds) => {
  if (!Number.isFinite(seconds)) return '--'
  const mins = Math.round(seconds / 60)
  if (mins < 1) return `${Math.max(1, Math.round(seconds))} s`
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h} h ${m} min`
}