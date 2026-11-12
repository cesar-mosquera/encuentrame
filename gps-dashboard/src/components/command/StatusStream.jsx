import React, { useId } from 'react'

const StatusStream = ({ samples = [], height = 60, color = '#06b6d4', label = 'Status Stream', unit = 'km/h' }) => {
  const gradId = useId()

  const width = 260
  const points = samples.length
  const values = points > 1 ? samples : [0, 1]
  const max = Math.max(5, ...values)
  const poly = values
    .map((value, i) => {
      const x = points > 1 ? (i / (points - 1)) * width : width
      const y = (value / max) * (height - 10) + 4
      return `${x.toFixed(1)},${(height - y).toFixed(1)}`
    })
    .join(' ')

  const last = samples.length ? Number(samples[samples.length - 1]) || 0 : 0
  const area = `0,${height} ${poly} ${width},${height}`
  const url = `url(#${gradId})`

  return (
    <div className="flex flex-col rounded-lg border border-cyan-500/15 bg-[#0a1220]/70 px-3 py-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">{label}</span>
        <span className="font-mono text-[11px] font-bold text-[#06b6d4]">
          {last} <span className="text-[8px] text-slate-500">{unit}</span>
        </span>
      </div>
      <div className="relative flex items-center justify-center overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ filter: `drop-shadow(0 0 6px ${color})` }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={area} fill={url} />
          <polyline points={poly} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={width} cy={height - ((values[values.length - 1] / max) * (height - 10) + 4)} r="2.4" fill={color}>
            <animate attributeName="opacity" values="1;0.4;1" dur="1.2s" repeatCount="indefinite" />
          </circle>
        </svg>
      </div>
    </div>
  )
}

export default StatusStream