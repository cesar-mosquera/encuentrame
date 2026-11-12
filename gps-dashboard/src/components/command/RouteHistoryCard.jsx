import React, { useId } from 'react'
import { Route, Navigation, MapPin, Loader2 } from 'lucide-react'
import { routeDistanceKm } from '../../lib/mapLogic'

const W = 260
const H = 96
const PAD = 10

const parsePoint = (pt) => {
  if (!Array.isArray(pt) || pt.length < 2) return null
  const lat = Number(pt[0])
  const lng = Number(pt[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return [lat, lng]
}

const project = (points) => {
  const lats = points.map((p) => p[0])
  const lngs = points.map((p) => p[1])
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const spanLng = maxLng - minLng || 1e-6
  const spanLat = maxLat - minLat || 1e-6
  const scale = Math.min((W - 2 * PAD) / spanLng, (H - 2 * PAD) / spanLat)
  const offX = (W - spanLng * scale) / 2
  const offY = (H - spanLat * scale) / 2
  return points.map(([lat, lng]) => [
    +(offX + (lng - minLng) * scale).toFixed(1),
    +(H - (offY + (lat - minLat) * scale)).toFixed(1),
  ])
}

const RoutePreview = ({ points, color }) => {
  const gradId = useId()
  const projected = project(points)
  const poly = projected.map(([x, y]) => `${x},${y}`).join(' ')
  const first = projected[0]
  const last = projected[projected.length - 1]
  const area = `0,${H} ${poly} ${W},${H}`

  return (
    <div className="relative flex items-center justify-center overflow-hidden rounded-md border border-cyan-500/10 bg-[#050b14]/80">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ filter: `drop-shadow(0 0 8px ${color})` }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={color} stopOpacity="0.15" />
            <stop offset="70%" stopColor={color} stopOpacity="0.55" />
            <stop offset="100%" stopColor={color} stopOpacity="0.9" />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#${gradId})`} opacity="0.25" />
        <polyline points={poly} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={first[0]} cy={first[1]} r="4" fill="#10b981" stroke="#0b0f19" strokeWidth="1.5" />
        <circle cx={last[0]} cy={last[1]} r="4.5" fill={color} stroke="#0b0f19" strokeWidth="1.5">
          <animate attributeName="opacity" values="1;0.45;1" dur="1.2s" repeatCount="indefinite" />
        </circle>
      </svg>
    </div>
  )
}

const RouteHistoryCard = ({ route = [], loading = false, onFocusRoute }) => {
  const points = (route || []).map(parsePoint).filter(Boolean)
  const hasRoute = points.length >= 2
  const distanceKm = hasRoute ? routeDistanceKm(points) : 0
  const color = '#06b6d4'

  return (
    <div className="rounded-lg border border-cyan-500/15 bg-[#0a1220]/70 p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
          <Route size={12} className="text-cyan-400" /> Historial de ruta
        </span>
        {hasRoute && (
          <span className="font-mono text-[10px] font-bold text-slate-400">{points.length} pts</span>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-3 text-[10px] text-slate-500">
          <Loader2 size={12} className="animate-spin text-cyan-400" /> Cargando historial…
        </div>
      )}

      {!loading && !hasRoute && (
        <div className="flex flex-col items-center justify-center gap-1 py-3 text-center">
          <MapPin size={14} className="text-slate-600" />
          <span className="text-[10px] text-slate-500">Sin historial registrado todavía</span>
        </div>
      )}

      {!loading && hasRoute && (
        <>
          <RoutePreview points={points} color={color} />

          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="flex flex-col rounded-md border border-cyan-500/10 bg-[#050b14]/60 px-2 py-1.5">
              <span className="text-[8px] font-bold uppercase tracking-[0.18em] text-slate-600">Distancia</span>
              <span className="font-mono text-[13px] font-extrabold text-cyan-300">
                {distanceKm < 100 ? distanceKm.toFixed(distanceKm < 1 ? 2 : 1) : Math.round(distanceKm)}
                <span className="ml-1 text-[9px] font-bold text-slate-500">km</span>
              </span>
            </div>
            <div className="flex flex-col rounded-md border border-cyan-500/10 bg-[#050b14]/60 px-2 py-1.5">
              <span className="text-[8px] font-bold uppercase tracking-[0.18em] text-slate-600">Recorrido</span>
              <span className="truncate font-mono text-[10px] font-bold text-slate-400">
                {points[0][0].toFixed(4)}, {points[0][1].toFixed(4)}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onFocusRoute?.()}
            disabled={loading}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#06b6d4]/90 px-2 py-2 text-[10px] font-extrabold uppercase tracking-wider text-[#0b0f19] shadow-[0_0_14px_rgba(6,182,212,0.35)] transition-all hover:bg-[#22d3ee] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Navigation size={12} />}
            {loading ? 'Cargando...' : 'Ver en el mapa'}
          </button>
        </>
      )}
    </div>
  )
}

export default RouteHistoryCard