const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search'
let lastRequestAt = 0

export const searchPlaces = async (query, { signal, limit = 6 } = {}) => {
  const q = String(query || '').trim()
  if (q.length < 3) return []

  // Nominatim pide un mínimo de 1s entre peticiones; encolamos con espera simple.
  const wait = Math.max(0, 1000 - (Date.now() - lastRequestAt))
  if (wait > 0) await new Promise((r) => setTimeout(r, wait, signal ? undefined : undefined))
  if (signal?.aborted) return []

  const url = new URL(NOMINATIM_BASE)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('q', q)
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('accept-language', 'es')
  url.searchParams.set('countrycodes', 'co')

  lastRequestAt = Date.now()
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Búsqueda no disponible (${res.status})`)

  const data = await res.json()
  if (!Array.isArray(data)) return []
  return data
    .filter((item) => Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon)))
    .map((item) => ({
      id: item.place_id || item.osm_id,
      label: shortAddress(item),
      address: item.display_name || '',
      position: [Number(item.lat), Number(item.lon)],
    }))
}

const shortAddress = (item) => {
  const addr = item.address || {}
  const road = addr.road || addr.pedestrian || addr.footway || item.name
  const pieces = [
    road,
    addr.neighbourhood || addr.suburb,
    addr.city || addr.town || addr.municipality || addr.state,
  ].filter(Boolean)
  if (pieces.length) return pieces.join(', ')
  return item.display_name || String(item.name || item.display_name || '')
}