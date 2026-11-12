import { useEffect, useRef, useState } from 'react'

export const useTelemetryStream = (entity, maxPoints = 28) => {
  const [samples, setSamples] = useState(() => Array.from({ length: maxPoints }, () => 0))
  const idRef = useRef(null)
  const speedRef = useRef(0)
  const lastSpeedRef = useRef(0)

  useEffect(() => {
    const next = Math.max(0, Math.min(130, Number(entity?.speed) || 0))
    speedRef.current = next
  }, [entity?.speed])

  useEffect(() => {
    const id = entity?.id || null
    if (id !== idRef.current) {
      idRef.current = id
      lastSpeedRef.current = 0
      setSamples(Array.from({ length: maxPoints }, () => 0))
    }
    if (!id) return undefined

    // Se registra la velocidad solo cuando el backend reporta un valor nuevo.
    // Antes se rellenaba el gráfico repitiendo el último valor con jitter
    // aleatorio, lo que hacía parecer movimiento donde no lo había.
    const timer = setInterval(() => {
      if (speedRef.current === lastSpeedRef.current) return
      lastSpeedRef.current = speedRef.current
      setSamples((prev) => [...prev.slice(1), speedRef.current])
    }, 900)
    return () => clearInterval(timer)
  }, [entity?.id, maxPoints])

  return samples
}
