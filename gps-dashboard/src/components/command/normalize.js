export const normalizeEntity = (e) => ({
  id: e?.id ?? null,
  name: e?.name || e?.label || e?.id || 'N/A',
  plate: e?.plate || e?.vehicle_id || e?.id || 'NN',
  status: e?.status || 'offline',
  speed: Math.max(0, Number(e?.speed) || 0),
  bearing: Math.round(Number(e?.bearing) || 0),
  battery: Number.isFinite(Number(e?.battery))
    ? Math.max(0, Math.min(100, Math.round(Number(e.battery))))
    : 0,
  accuracy: Number.isFinite(Number(e?.accuracy)) ? Math.max(0, Math.round(Number(e.accuracy))) : null,
  position: e?.position || null,
  historicalPosition: e?.historicalPosition || e?.position || null,
  route: Array.isArray(e?.route) ? e.route : [],
  lastUpdate: e?.lastUpdate || e?.last_seen || '--',
  deviceId: e?.deviceId || e?.device_id || null,
  model: e?.model || e?.platform || (e?.driver && e.driver !== 'Desconocido' ? 'Moto GPS' : 'Android APK'),
  driver: e?.driver || null,
  controlState: e?.controlState,
  _mock: Boolean(e?._mock),
  _ephemeral: Boolean(e?._ephemeral),
  _kind: e?._kind || 'device',
})

export const isOnline = (entity) => entity?.status === 'active' || entity?.status === 'online' || entity?.status === 'online_moving'

export const statusLabel = (entity) => {
  if (!entity) return 'SIN DATOS'
  if (isOnline(entity)) return 'EN LÍNEA'
  if (entity.status === 'immobilized') return 'INMOVILIZADO'
  return 'SIN SEÑAL'
}

export const statusColor = (entity) => {
  if (isOnline(entity)) return '#10b981'
  if (entity?.status === 'immobilized') return '#f59e0b'
  return '#ef4444'
}

// El schema no tiene columna de "señal" (barras de celda). La única magnitud de
// calidad de_fix_ disponible es `accuracy` en metros. Esta función devuelve una
// etiqueta cualitativa honesta derivada de ella, no un porcentaje inventado.
export const SIGNAL_BANDS = [
  { max: 10, label: 'MUY BUENA', score: 96 },
  { max: 25, label: 'BUENA', score: 90 },
  { max: 50, label: 'MEDIA', score: 82 },
  { max: 100, label: 'BAJA', score: 72 },
  { max: Infinity, label: 'MUY BAJA', score: 58 },
]

export const signalFor = (entity) => {
  if (!entity || !isOnline(entity)) return null
  const accuracy = Number(entity?.accuracy)
  if (!Number.isFinite(accuracy) || accuracy <= 0) return null
  return SIGNAL_BANDS.find((band) => accuracy <= band.max)
}