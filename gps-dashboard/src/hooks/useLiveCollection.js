import { useEffect, useRef, useState, useCallback } from 'react'
import { hasSupabaseConfig, supabase } from '../lib/supabase'

export const useLiveCollection = ({ fetchFn, subscribeTables = [] }) => {
  const [data, setData] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastSyncTime, setLastSyncTime] = useState(null)
  const [isStale, setIsStale] = useState(false)
  const reqSeqRef = useRef(0)
  const isFetchingRef = useRef(false)
  const pendingRefetchRef = useRef(false)
  const lastSyncTimeRef = useRef(null)
  const [refetchTrigger, setRefetchTrigger] = useState(0)

  // fetchFn llega como closure nueva en cada render del consumidor. Meterlo en las
  // dependencias del effect lo reiniciaria en cada render, resuscribiendo el canal
  // realtime y relanzando el poll sin parar. Se guarda en un ref para que el effect
  // use siempre la version mas reciente sin depender de su identidad.
  // El ref se escribe en un effect declarado ANTES del efecto principal: React ejecuta
  // los effects en orden, asi que cuando arranque la carga el ref ya esta actualizado.
  const fetchFnRef = useRef(fetchFn)
  const tablesRef = useRef(subscribeTables)
  useEffect(() => {
    fetchFnRef.current = fetchFn
    tablesRef.current = subscribeTables
  })

  // Las tablas si se suscriben de verdad cuando cambian, asi que van en las deps.
  // Se comparan por valor (un array nuevo con el mismo contenido no debe resuscribir).
  const tablesKey = subscribeTables.join('\u0000')

  useEffect(() => {
    let cancelled = false
    let debounceTimer = null

    const loadData = async () => {
      if (isFetchingRef.current) {
        pendingRefetchRef.current = true
        return
      }
      isFetchingRef.current = true
      const currentSeq = ++reqSeqRef.current
      setIsLoading(true)
      try {
        const result = await fetchFnRef.current()

        if (!cancelled && currentSeq === reqSeqRef.current) {
          setData(result)
          setError(null)
          const now = Date.now()
          setLastSyncTime(now)
          lastSyncTimeRef.current = now
          setIsStale(false)
        }
      } catch (err) {
        if (!cancelled && currentSeq === reqSeqRef.current) {
          setError(err.message || 'Error al cargar datos')
          setIsStale(true)
        }
      } finally {
        if (!cancelled && currentSeq === reqSeqRef.current) {
          setIsLoading(false)
        }
        isFetchingRef.current = false
        if (pendingRefetchRef.current && !cancelled) {
          pendingRefetchRef.current = false
          loadData()
        }
      }
    }

    const debouncedLoad = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        if (!cancelled) loadData()
      }, 500)
    }

    loadData()

    const pollInterval = setInterval(() => {
      if (!cancelled) loadData()
    }, 30000)

    const staleInterval = setInterval(() => {
      if (!cancelled && lastSyncTimeRef.current) {
        if (Date.now() - lastSyncTimeRef.current > 45000) {
          setIsStale(true)
        }
      }
    }, 5000)

    const handleFocusOrVisibility = () => {
      if (!cancelled && document.visibilityState !== 'hidden') {
        loadData()
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleFocusOrVisibility)
      document.addEventListener('visibilitychange', handleFocusOrVisibility)
    }

    let channel = null
    const tables = tablesRef.current
    if (hasSupabaseConfig && supabase && tables.length > 0) {
      channel = supabase.channel(`live-collection-${Math.random().toString(36).substr(2, 9)}`)
      tables.forEach(table => {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, debouncedLoad)
      })
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (!cancelled) loadData()
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          debouncedLoad()
        }
      })
    }

    return () => {
      cancelled = true
      if (debounceTimer) clearTimeout(debounceTimer)
      clearInterval(pollInterval)
      clearInterval(staleInterval)
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleFocusOrVisibility)
        document.removeEventListener('visibilitychange', handleFocusOrVisibility)
      }
      if (channel && supabase) {
        supabase.removeChannel(channel)
      }
    }
  }, [refetchTrigger, tablesKey])

  const refetch = useCallback(() => setRefetchTrigger(t => t + 1), [])

  return { data, setData, isLoading, error, lastSyncTime, isStale, refetch }
}
