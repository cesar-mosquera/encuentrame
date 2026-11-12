import { useEffect, useState } from 'react'

/**
 * Reloj de presentación. Vive en su propio módulo (y no en useTelemetryStream)
 * porque su consumidor debe aislarlo en un componente hoja: si se llamara desde
 * un contenedor, invalidaría el subtree completo en cada tick.
 */
export const useNow = (intervalMs = 1000) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
