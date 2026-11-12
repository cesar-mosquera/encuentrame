import { useCallback, useEffect, useState } from 'react'
import { fetchGeofences } from '../lib/queries'
import { supabase } from '../lib/supabase'

export const useGeofences = () => {
  const [geofences, setGeofences] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const refetchGeofences = useCallback(() => setRefreshKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    let timeoutId = null

    const loadGeofences = async () => {
      setIsLoading(true)
      try {
        const data = await fetchGeofences()
        if (!cancelled) {
          setGeofences(data)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message)
          setGeofences((prev) => (prev && prev.length > 0 ? prev : []))
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadGeofences()

    if (!supabase) {
      return () => {
        cancelled = true
      }
    }

    const channel = supabase
      .channel('geofences-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'geofences' },
        () => {
          if (!cancelled) {
            clearTimeout(timeoutId)
            timeoutId = setTimeout(loadGeofences, 1000)
          }
        }
      )
      .subscribe((status, err) => {
        if (!cancelled && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')) {
          console.warn('Geofences realtime error:', status, err)
          setError(`Realtime error: ${status}`)
        }
      })

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
      supabase.removeChannel(channel)
    }
  }, [refreshKey])

  return { geofences, isLoading, error, refetchGeofences }
}