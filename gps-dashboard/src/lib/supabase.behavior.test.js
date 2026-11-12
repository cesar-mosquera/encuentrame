// @vitest-environment node
/**
 * Tests de COMPORTAMIENTO REAL para supabase.js — withAuthRetry
 *
 * Estos tests validan la lógica de reintento de autenticación.
 * No verifican texto, verifican que la función reintente en los
 * casos correctos y NO reintente cuando no corresponde.
 *
 * Bug corregido: res.status no existe en Supabase JS.
 * El status HTTP viene en res.error.status.
 *
 * Estrategia de mock: withAuthRetry llama a _deps.refreshNativeSession()
 * (_deps es un objeto exportado). Al mutar _deps.refreshNativeSession
 * con vi.fn() los tests controlan el comportamiento sin romper closures.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withAuthRetry, _deps } from '../lib/supabase'

describe('withAuthRetry — comportamiento real', () => {
  let originalRefresh

  beforeEach(() => {
    // Guardamos la implementación real para restaurarla después
    originalRefresh = _deps.refreshNativeSession
  })

  afterEach(() => {
    // Restauramos siempre para no contaminar otros tests
    _deps.refreshNativeSession = originalRefresh
  })

  it('retorna el resultado directamente si no hay error', async () => {
    const queryFn = vi.fn().mockResolvedValue({ data: [{ id: 1 }], error: null })

    const result = await withAuthRetry(queryFn)

    expect(result.data).toEqual([{ id: 1 }])
    // Solo se llamó una vez — no hubo reintento innecesario
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  it('lanza el error si queryFn rechaza con un error no-401', async () => {
    const dbError = new Error('Connection refused')
    dbError.status = 503
    const queryFn = vi.fn().mockRejectedValue(dbError)

    await expect(withAuthRetry(queryFn)).rejects.toThrow('Connection refused')
    // Solo se llamó una vez — no se reintentó en error 503
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  it('detecta 401 en res.error.status (no en res.status que no existe)', async () => {
    // refreshNativeSession devuelve un token para que el retry ocurra
    _deps.refreshNativeSession = vi.fn().mockResolvedValue('new-token-abc')

    // Simula la estructura real de Supabase JS: error tiene .status, no la respuesta
    const queryFn = vi.fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'JWT expired', status: 401 }, // res.error.status, no res.status
      })
      .mockResolvedValueOnce({ data: [{ id: 2 }], error: null }) // segundo intento exitoso

    const result = await withAuthRetry(queryFn)

    // Se llamó dos veces: el intento original y el reintento tras renovar token
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(result.data).toEqual([{ id: 2 }])
  })

  it('detecta 401 en excepción lanzada por queryFn', async () => {
    _deps.refreshNativeSession = vi.fn().mockResolvedValue('new-token-abc')

    const authErr = new Error('Unauthorized')
    authErr.status = 401
    const queryFn = vi.fn()
      .mockRejectedValueOnce(authErr)
      .mockResolvedValueOnce({ data: [{ id: 3 }], error: null })

    const result = await withAuthRetry(queryFn)

    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(result.data).toEqual([{ id: 3 }])
  })

  it('detecta JWT en el mensaje de error aunque el status no sea 401', async () => {
    _deps.refreshNativeSession = vi.fn().mockResolvedValue('new-token-abc')

    const queryFn = vi.fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'invalid JWT: signature mismatch', status: 403 },
      })
      .mockResolvedValueOnce({ data: [{ id: 4 }], error: null })

    const result = await withAuthRetry(queryFn)

    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(result.data).toEqual([{ id: 4 }])
  })

  it('NO reintenta si refreshNativeSession no obtiene un token nuevo', async () => {
    // Sin token nuevo → no debe reintentar
    _deps.refreshNativeSession = vi.fn().mockResolvedValue(null)

    const queryFn = vi.fn().mockRejectedValue(
      Object.assign(new Error('Unauthorized'), { status: 401 })
    )

    // Cuando no hay token nuevo, la excepción se propaga
    await expect(withAuthRetry(queryFn)).rejects.toThrow('Unauthorized')
    // Solo un intento — sin token no tiene sentido reintentar
    expect(queryFn).toHaveBeenCalledTimes(1)
  })
})
