import React, { useEffect, useState } from 'react'
import { Navigation, Wifi, Battery, Activity, MapPin, Share2, Pencil } from 'lucide-react'
import StatusStream from './StatusStream'
import RouteHistoryCard from './RouteHistoryCard'
import { useTelemetryStream } from './useTelemetryStream'
import { isOnline, statusLabel, statusColor, signalFor } from './normalize'



const DetailPanel = ({
  entity,
  samples,

  onToggleRouteFollow,
  isFollowingRoute,
  onShareRoute,
  onDeleteEntity,
  onEditVehicle,
  historyRoute,
  historyLoading,
  onFocusRoute,
}) => {
  const liveSamples = useTelemetryStream(entity)
  const values = samples && samples.length ? samples : liveSamples
  const online = isOnline(entity)
  const color = statusColor(entity)
  const battery = entity?.battery ?? 0
  const batteryTone = battery > 60 ? '#10b981' : battery > 25 ? '#f59e0b' : '#ef4444'
  const signal = signalFor(entity)
  const accuracy = entity?.accuracy ?? null

  const [confirmingDelete, setConfirmingDelete] = useState(false)
  useEffect(() => {
    if (!confirmingDelete) return undefined
    const timer = window.setTimeout(() => setConfirmingDelete(false), 2500)
    return () => window.clearTimeout(timer)
  }, [confirmingDelete])

  return (
    <div className="flex w-full max-w-[304px] flex-col rounded-2xl border border-cyan-500/20 bg-slate-900/60 p-4 shadow-[0_0_25px_rgba(6,182,212,0.12)] backdrop-blur-md">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-cyan-500/10 pb-3">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">Dispositivo</div>
          <div className="truncate font-mono text-[15px] font-bold text-slate-100" title={entity?.name || entity?.id}>
            {entity?.name || entity?.id || 'SIN SELECCIÓN'}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-slate-500">{entity?.model || '—'}</div>
        </div>
        <span
          className="flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em]"
          style={{ color, borderColor: `${color}55`, backgroundColor: `${color}14` }}
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ backgroundColor: color }} />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
          </span>
          {statusLabel(entity)}
        </span>
      </div>

      {/* Grid de telemetría */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <TelemetryCell
          icon={<Navigation size={13} />}
          label="Velocidad"
          value={<span className="font-mono text-[18px] font-extrabold text-[#f8fafc]">{Math.round(entity?.speed ?? 0)}<span className="ml-1 text-[10px] font-bold text-slate-500">km/h</span></span>}
          accent={online ? '#06b6d4' : '#64748b'}
        />
        <TelemetryCell
          icon={<Activity size={13} />}
          label="Precisión"
          value={<span className="font-mono text-[18px] font-extrabold text-[#f8fafc]">{accuracy ?? '—'}<span className="ml-1 text-[10px] font-bold text-slate-500">m</span></span>}
          accent="#10b981"
        />
      </div>

      {/* Batería */}
      <div className="mt-2 rounded-lg border border-cyan-500/10 bg-[#0a1220]/60 p-2.5">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
            <Battery size={12} className="text-slate-500" /> Batería
          </span>
          <span className="font-mono text-[12px] font-bold tabular-nums" style={{ color: batteryTone }}>
            {battery}%
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800/80">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${battery}%`, backgroundColor: batteryTone, boxShadow: `0 0 8px ${batteryTone}` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
            <Wifi size={12} className="text-slate-500" /> Señal
          </span>
          <span className={`flex items-center gap-1 font-mono text-[12px] font-bold ${signal ? 'text-[#10b981]' : 'text-slate-600'}`}>
            <Wifi size={12} /> {signal ? signal.label : '—'}
          </span>
        </div>
      </div>

      {/* Status Stream */}
      <div className="mt-2">
        <StatusStream samples={values} label="Status Stream · Velocidad" />
      </div>

      {/* Historial de ruta */}
      <div className="mt-2">
        <RouteHistoryCard route={historyRoute} loading={historyLoading} onFocusRoute={onFocusRoute} />
      </div>

      {/* Acciones */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onToggleRouteFollow}
          disabled={!entity?.position}
          className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2.5 text-[10px] font-extrabold uppercase tracking-wider transition-all ${
            isFollowingRoute
              ? 'bg-[#06b6d4] text-[#0b0f19] shadow-[0_0_22px_rgba(6,182,212,0.55)]'
              : 'bg-[#06b6d4]/90 text-[#0b0f19] shadow-[0_0_18px_rgba(6,182,212,0.4)] hover:bg-[#22d3ee] hover:shadow-[0_0_28px_rgba(6,182,212,0.6)]'
          }`}
        >
          <Navigation size={14} /> {isFollowingRoute ? 'Siguiendo' : 'Seguir Monitoreo'}
        </button>
        <button
          type="button"
          onClick={onShareRoute}
          disabled={!entity}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-cyan-500/30 bg-slate-900/70 px-2 py-2.5 text-[10px] font-extrabold uppercase tracking-wider text-cyan-300 transition-all hover:border-cyan-400/60 hover:bg-cyan-500/10"
        >
          <Share2 size={14} /> Compartir
        </button>
      </div>



      {/* Pie con ubicación */}
      <div className="mt-auto flex items-center gap-2 border-t border-cyan-500/10 pt-2.5">
        <MapPin size={12} className="shrink-0 text-cyan-400" />
        <span className="truncate text-[10px] text-slate-400">
          {entity?.position ? `${entity.position[0].toFixed(5)}, ${entity.position[1].toFixed(5)}` : 'Sin coordenadas'}
        </span>
        {onEditVehicle && (
          <button
            type="button"
            onClick={() => onEditVehicle(entity)}
            className="shrink-0 rounded-md border border-cyan-500/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cyan-400 transition-all hover:bg-cyan-500/10"
            title="Editar entidad"
            aria-label={`Editar ${entity?.name || entity?.id || 'entidad'}`}
          >
            <Pencil size={10} className="inline-block" />
          </button>
        )}
        {onDeleteEntity && (
          <button
            type="button"
            onClick={() => {
              if (confirmingDelete) {
                setConfirmingDelete(false)
                onDeleteEntity(entity)
              } else {
                setConfirmingDelete(true)
              }
            }}
            className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-all ${
              confirmingDelete
                ? 'border-red-400/70 bg-red-500/20 text-[#f87171] shadow-[0_0_10px_rgba(239,68,68,0.3)]'
                : 'border-red-500/25 text-red-400 hover:bg-red-500/10'
            }`}
          >
            {confirmingDelete ? '¿Borrar?' : 'Eliminar'}
          </button>
        )}
      </div>
    </div>
  )
}

const TelemetryCell = ({ icon, label, value, accent = '#06b6d4' }) => (
  <div className="flex flex-col rounded-lg border border-cyan-500/10 bg-[#0a1220]/60 p-2.5">
    <div className="mb-1 flex items-center gap-1.5" style={{ color: accent }}>
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{label}</span>
    </div>
    {value}
  </div>
)

export default DetailPanel