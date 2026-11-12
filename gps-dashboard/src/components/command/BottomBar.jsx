import React from 'react'
import { Gauge, Compass, Navigation, Satellite, Battery, Signal, FileText } from 'lucide-react'
import { signalFor } from './normalize'

// Solo se declara 'satellite' porque es la unica capa que el mapa renderiza de verdad:
// se traduce a baseLayer en CommandCenter/MapArea. 'traffic' y 'heat' figuraban aqui
// pero ningun componente los leia, asi que los botones solo cambiaban su propio color
// sin afectar al mapa.
const LAYERS = [
  { id: 'satellite', label: 'Satélite', icon: Satellite },
]

const BottomBar = ({ entity, onToggleRouteFollow, isFollowingRoute, baseLayer, onBaseLayerChange, onShowDetail }) => {
  const toggleLayer = (layerId) => {
    if (layerId === 'satellite') {
      onBaseLayerChange(baseLayer === 'satellite' ? 'dark' : 'satellite')
    }
  }

  const isLayerActive = (layerId) => (layerId === 'satellite' ? baseLayer === 'satellite' : false)

  const hasPosition = Boolean(entity?.position)
  const heading = Math.round(entity?.bearing ?? 0)
  const speed = Math.round(entity?.speed ?? 0)
  const battery = entity?.battery ?? null
  const batteryTone = battery > 60 ? '#10b981' : battery > 25 ? '#f59e0b' : '#ef4444'
  const accuracy = entity?.accuracy ?? null
  const signal = signalFor(entity)

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex flex-col items-center gap-3 px-3">
      {/* Capas */}
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-cyan-500/20 bg-slate-900/70 px-1.5 py-1 shadow-[0_0_18px_rgba(6,182,212,0.15)] backdrop-blur-md">
        {LAYERS.map((layer) => {
          const Icon = layer.icon
          const active = isLayerActive(layer.id)
          return (
            <button
              key={layer.id}
              type="button"
              onClick={() => toggleLayer(layer.id)}
              aria-label={`Activar capa ${layer.label}`}
              aria-pressed={active}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] transition-all sm:px-3 ${
                active
                  ? 'bg-[#06b6d4]/20 text-[#22d3ee] shadow-[0_0_12px_rgba(6,182,212,0.4)]'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Icon size={11} /> <span className="hidden sm:inline">{layer.label}</span>
            </button>
          )
        })}
      </div>

      {/* Barra principal */}
      <div className="pointer-events-auto flex w-full max-w-3xl items-center gap-3 overflow-x-auto rounded-2xl border border-cyan-500/40 bg-slate-900/70 px-4 py-3 shadow-[0_0_30px_rgba(6,182,212,0.2)] backdrop-blur-md cmd-scroll">
        <MetricCell
          icon={<Gauge size={13} />}
          label="Precisión"
          value={<span className="font-mono text-[16px] font-extrabold text-slate-100">{accuracy ?? '—'}<span className="text-[9px] text-slate-500"> m</span></span>}
          className="hidden md:flex"
        />
        <Divider className="hidden md:block" />
        <MetricCell
          icon={<Battery size={13} />}
          label="Batería"
          value={<span className="font-mono text-[16px] font-extrabold" style={{ color: entity ? batteryTone : '#64748b' }}>{battery ?? '—'}<span className="text-[9px] text-slate-500">%</span></span>}
          className="hidden md:flex"
        />
        <Divider className="hidden md:block" />
        <MetricCell
          icon={<Gauge size={13} />}
          label="Señal"
          value={<span className="font-mono text-[13px] font-extrabold text-slate-100">{signal ? signal.label : '—'}</span>}
          className="hidden md:flex"
        />
        <Divider className="hidden md:block" />
        <MetricCell
          icon={<Signal size={13} />}
          label="Velocidad"
          value={<span className="font-mono text-[16px] font-extrabold text-slate-100">{hasPosition ? speed : '—'}<span className="text-[9px] text-slate-500"> km/h</span></span>}
          className="hidden md:flex"
        />
        <Divider className="hidden md:block" />
        <MetricCell
          icon={<Compass size={13} />}
          label="Dirección"
          value={<span className="font-mono text-[16px] font-extrabold text-slate-100">{hasPosition ? heading : '—'}<span className="text-[9px] text-[#06b6d4]">°</span></span>}
          className="hidden md:flex"
        />

        <Divider className="hidden md:block" />

        <div className="flex min-w-0 max-w-[170px] flex-1 flex-col items-center px-1">
          <span className="text-[9px] tracking-[0.2em] text-slate-500 uppercase">Dispositivo</span>
          <span className="w-full truncate text-center font-mono text-[13px] font-bold text-[#22d3ee]">
            {entity?.name || entity?.id || 'Sin selección'}
          </span>
          <span className="text-[9px] text-slate-600">{speed} km/h · {entity?.plate}</span>
        </div>

        <Divider className="hidden md:block" />

        {onShowDetail && (
          <button
            type="button"
            onClick={onShowDetail}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-cyan-500/25 bg-slate-800/60 px-3 py-3 text-[11px] font-extrabold uppercase tracking-wider text-cyan-300 transition-all hover:bg-cyan-500/10 xl:hidden"
            title="Ver ficha del dispositivo"
            aria-label="Abrir ficha del dispositivo"
          >
            <FileText size={14} /> Ficha
          </button>
        )}

        <button
          type="button"
          onClick={() => onToggleRouteFollow?.()}
          disabled={!entity?.position}
          className={`group flex shrink-0 items-center gap-2 rounded-xl px-4 py-3 text-[11px] font-extrabold uppercase tracking-wider transition-all sm:px-5 ${
            isFollowingRoute
              ? 'bg-[#22d3ee] text-[#0b0f19] shadow-[0_0_30px_rgba(34,211,238,0.6)]'
              : 'bg-[#06b6d4] text-[#0b0f19] shadow-[0_0_25px_rgba(6,182,212,0.4)] hover:bg-[#22d3ee] hover:shadow-[0_0_35px_rgba(6,182,212,0.65)]'
          } disabled:cursor-not-allowed disabled:opacity-50`}
          title={!entity?.position ? 'Sin posición GPS para seguir' : 'Seguir/enrutar dispositivo en el mapa'}
        >
          <span className="relative flex h-4 w-4 items-center justify-center">
            <Navigation size={15} className={isFollowingRoute ? 'animate-pulse' : 'group-hover:animate-pulse'} />
          </span>
          {isFollowingRoute ? 'Siguiendo' : 'Seguir'}
        </button>
      </div>
    </div>
  )
}

const MetricCell = ({ icon, label, value, className = '' }) => (
  <div className={`min-w-[64px] shrink-0 flex-col items-center ${className}`}>
    <span className="mb-0.5 flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">
      {icon} {label}
    </span>
    {value}
  </div>
)

const Divider = ({ className = '' }) => <div className={`h-9 w-px shrink-0 bg-cyan-500/20 ${className}`} />

export default BottomBar