import React, { useMemo, useState } from 'react'
import { Search, Crosshair, MapPin, Plus, AlertTriangle, Trash2, RotateCcw } from 'lucide-react'
import { isOnline, statusColor, signalFor } from './normalize'

const FleetPanel = ({ entities, selectedId, onSelectEntity, onDeleteEntity, onResetDemos, userLocation, onLocateUser, onSetGeofence, alerts, onSelectAlert, isLoading = false }) => {
  const [query, setQuery] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entities
    return entities.filter(
      (e) => e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q) || String(e.plate).toLowerCase().includes(q),
    )
  }, [entities, query])

  const activeAlerts = (alerts || []).filter((a) => a.status !== 'resolved')

  return (
    <div className="flex w-full max-w-[304px] flex-col rounded-2xl border border-cyan-500/20 bg-slate-900/60 p-4 shadow-[0_0_25px_rgba(6,182,212,0.12)] backdrop-blur-md">
      {/* Ubicación del operador */}
      <div className="flex items-center justify-between gap-2 rounded-xl border border-cyan-500/15 bg-[#0a1220]/70 p-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#06b6d4]/15 text-[#06b6d4] ring-1 ring-cyan-500/30">
            <MapPin size={15} />
            <span className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
              <span className="absolute h-full w-full animate-ping rounded-full bg-[#10b981] opacity-60" />
              <span className="relative h-2 w-2 rounded-full bg-[#10b981]" />
            </span>
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[11px] font-bold text-slate-200">Ubicación del Operador</div>
            <div className="truncate font-mono text-[9px] text-slate-500">
              {userLocation?.position ? `${userLocation.position[0].toFixed(4)}, ${userLocation.position[1].toFixed(4)}` : 'Desconocida'}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onLocateUser}
          title="Centrar en mi posición"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-500/30 text-cyan-300 transition-all hover:bg-cyan-500/10 hover:shadow-[0_0_14px_rgba(6,182,212,0.4)]"
        >
          <Crosshair size={14} />
        </button>
      </div>

      {/* Búsqueda */}
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-cyan-500/15 bg-[#0a1220]/70 px-3 py-2">
        <Search size={13} className="shrink-0 text-cyan-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar dispositivo..."
          aria-label="Buscar dispositivo"
          className="w-full bg-transparent text-[11px] text-slate-200 placeholder-slate-600 outline-none"
        />
      </div>

      {/* Lista */}
      <div className="cmd-scroll mt-3 -mr-1 max-h-[36vh] min-h-[120px] flex-1 space-y-1.5 overflow-y-auto pr-1">
        {filtered.length === 0 && (
          <div className="py-6 text-center text-[10px] uppercase tracking-widest text-slate-600">
            {isLoading ? 'Cargando flota...' : 'Sin dispositivos'}
            {onResetDemos && (
              <button
                type="button"
                onClick={onResetDemos}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-cyan-500/25 bg-[#06b6d4]/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-cyan-300 transition-all hover:bg-[#06b6d4]/20"
              >
                <RotateCcw size={12} /> Restaurar demos
              </button>
            )}
          </div>
        )}
        {filtered.map((entity) => {
          const isSel = entity.id === selectedId
          const online = isOnline(entity)
          const color = statusColor(entity)

          const signal = signalFor(entity)
          return (
            <div
              key={entity.id}
              className={`relative w-full rounded-xl border p-2.5 text-left transition-all ${
                isSel
                  ? 'border-cyan-400/50 bg-cyan-500/10 shadow-[0_0_16px_rgba(6,182,212,0.25)]'
                  : 'border-cyan-500/10 bg-[#0a1220]/50 hover:border-cyan-500/30 hover:bg-cyan-500/5'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectEntity(entity)}
                className="w-full pr-7 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className={`absolute h-full w-full rounded-full opacity-50 ${online ? 'animate-ping' : ''}`} style={{ backgroundColor: color }} />
                    <span className="relative h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-mono text-[11px] font-bold text-slate-200">{entity.name || entity.id}</span>
                      {entity._mock && (
                        <span className="rounded bg-amber-500/15 px-1 py-px text-[9px] font-extrabold uppercase tracking-wider text-amber-400">Sim</span>
                      )}
                    </div>
                    <div className="truncate text-[10px] text-slate-500">{entity.id}</div>
                  </div>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-[11px] font-bold ${online ? 'text-[#06b6d4]' : 'text-slate-600'}`}>
                      {Math.round(entity.speed ?? 0)}<span className="ml-0.5 text-[9px] text-slate-500">km/h</span>
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">{entity.battery ?? '—'}%</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {signal !== null && <span className="font-mono text-[9px] font-bold tracking-wider text-slate-500">{signal.label}</span>}
                  </div>
                </div>
              </button>
              {onDeleteEntity && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirmingDelete === entity.id) {
                      setConfirmingDelete(null)
                      onDeleteEntity(entity)
                    } else {
                      setConfirmingDelete(entity.id)
                      window.setTimeout(() => setConfirmingDelete((cur) => (cur === entity.id ? null : cur)), 2500)
                    }
                  }}
                  title="Eliminar dispositivo"
                  aria-label={`Eliminar ${entity.name || entity.id}`}
                  className={`absolute right-2 top-2 flex items-center gap-1 rounded-md border px-1.5 py-1 text-[9px] font-bold uppercase tracking-wider transition-all ${
                    confirmingDelete === entity.id
                      ? 'border-red-400/70 bg-red-500/20 text-[#f87171] shadow-[0_0_10px_rgba(239,68,68,0.3)]'
                      : 'border-red-500/20 bg-red-500/5 text-red-400/60 hover:border-red-400/50 hover:bg-red-500/15 hover:text-red-300'
                  }`}
                >
                  {confirmingDelete === entity.id ? '¿Borrar?' : <Trash2 size={11} />}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Alertas */}
      {activeAlerts.length > 0 && (
        <div className="mt-3 border-t border-cyan-500/10 pt-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400">
            <AlertTriangle size={12} /> Alertas activas
          </div>
          <div className="cmd-scroll max-h-[16vh] space-y-1 overflow-y-auto pr-1">
            {activeAlerts.slice(0, 5).map((alert) => (
              <button
                key={alert.id}
                type="button"
                onClick={() => onSelectAlert && onSelectAlert(alert)}
                className="flex w-full items-center gap-2 rounded-lg border border-amber-500/15 bg-[#2a1a0a]/40 px-2 py-1.5 text-left transition-all hover:border-amber-400/40"
              >
                <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400" />
                <span className="min-w-0">
                  <span className="block truncate text-[10px] font-bold text-amber-200">{alert.title.split(' - ')[0]}</span>
                  <span className="block truncate text-[9px] text-slate-400">{alert.timestamp} · {alert.locationName}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Geocerca */}
      <button
        type="button"
        onClick={onSetGeofence}
        className="mt-2.5 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-cyan-500/30 px-2 py-2 text-[11px] font-bold uppercase tracking-wider text-cyan-400 transition-all hover:border-cyan-400/60 hover:bg-cyan-500/10"
      >
        <Plus size={12} /> Nueva Geocerca
      </button>
    </div>
  )
}

export default FleetPanel