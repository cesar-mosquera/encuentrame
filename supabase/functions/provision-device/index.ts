// Edge Function de Supabase: provision-device
// Crea la cuenta Auth de un dispositivo, la asocia en devices.auth_user_id
// y devuelve al APK las credenciales para que el dispositivo pueda entrar
// a su panel ("login por dispositivo").
//
// SEGURIDAD: el endpoint es publico (verify_jwt=false) porque lo invoca el APK
// todavia sin sesion. Por eso la UNICA credencial aceptada es el codigo de
// activacion, que debe coincidir con organizations.activation_code de la
// organizacion destino o con el secret global PROVISION_SECRET.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

// B4: ALLOWED_ORIGIN es obligatorio en producción. Si falta, el worker falla rápido
// y la función retorna 500 en todas las solicitudes hasta que se configure.
const CORS_ORIGIN = Deno.env.get('ALLOWED_ORIGIN')
if (!CORS_ORIGIN) {
  throw new Error(
    '[provision-device] Variable de entorno ALLOWED_ORIGIN no configurada. ' +
    'Defina el secret antes de desplegar: supabase secrets set ALLOWED_ORIGIN=https://tu-dominio.com'
  )
}
// B5: Vercel reenvia varios headers de origen (x-forwarded-for encadenado por
// proxies). Se permiten multiples valores explicitos en vez de '*' para no abrir
// el endpoint a paginas de terceros.
const CORS_ORIGIN_LIST = CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)

const BASE_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-provision-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
}

// Responde con el origin que realmente coincide.
//
// Antes se respondia siempre con CORS_ORIGIN_LIST[0], asi que con varios origins
// permitidos en ALLOWED_ORIGIN el navegador del segundo origen recibia un
// Access-Control-Allow-Origin que no era el suyo y bloqueaba la respuesta. El endpoint
// acababa siendo utilizable solo desde el primer origin de la lista.
const corsHeaders = (requestOrigin: string | null): Record<string, string> => {
  const allowed =
    requestOrigin && CORS_ORIGIN_LIST.includes(requestOrigin) ? requestOrigin : CORS_ORIGIN_LIST[0]
  return { ...BASE_CORS_HEADERS, 'Access-Control-Allow-Origin': allowed ?? CORS_ORIGIN }
}

const json = (data: unknown, status = 200, requestOrigin: string | null = null) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(requestOrigin), 'Content-Type': 'application/json' },
  })

// Password aleatorio legible (sin 0/O/1/l/I para evitar confusiones).
function randomPassword(len = 18): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += alphabet[b % alphabet.length]
  return out
}

// --- Comparacion en tiempo constante -------------------------------------------------
// Un === sobre el codigo filtraria, por la longitud del prefijo coincidente, cuanto
// acertaste. Se hashea y se comparan los digests byte a byte sin corto circuito.
const digest = (value: string): Promise<Uint8Array> =>
  crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)).then(
    (buf) => new Uint8Array(buf),
  )

async function secretEquals(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([digest(a), digest(b)])
  let diff = 0
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i]
  return diff === 0
}

const sha256Hex = async (value: string): Promise<string> => {
  const bytes = await digest(value)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// Rate Limiter persistente en DB (con fallback en memoria para solicitudes por ventana de 15 min)
// NOTA: activationCode viaja en el BODY (campo "activationCode"), NO en un header.
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000
const MAX_FAILED_ATTEMPTS = 5  // Máximo 5 intentos fallidos por ventana de 15 minutos por IP
const attemptStore = new Map<string, { count: number; expiresAt: number }>()

// Fallback en memoria: solo lectura
function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const record = attemptStore.get(key)
  if (!record) return true
  if (now > record.expiresAt) {
    attemptStore.delete(key)
    return true
  }
  return record.count < MAX_FAILED_ATTEMPTS
}

// Fallback en memoria: incremento solo en fallo
function recordFailedAttemptMemory(key: string) {
  const now = Date.now()
  const record = attemptStore.get(key)
  if (!record || now > record.expiresAt) {
    attemptStore.set(key, { count: 1, expiresAt: now + ATTEMPT_WINDOW_MS })
  } else {
    record.count += 1
  }
}

async function clearDbRateLimit(key: string) {
  try {
    const { error } = await supabase.rpc('clear_rate_limit', { p_key: key })
    // B2: Verificar el objeto error de Supabase — no siempre lanza excepción.
    if (error) console.warn(`clearDbRateLimit RPC error for type ${key.split(':')[0]}:`, error.message)
  } catch (e) {
    console.warn(`clearDbRateLimit network error for type ${key.split(':')[0]}:`, e)
  }
  // Siempre limpiar memoria (independientemente de si DB tuvo éxito)
  attemptStore.delete(key)
}

// B3: check es SOLO LECTURA en DB. No incrementa.
async function checkDbRateLimit(key: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_key: key,
      p_max_attempts: MAX_FAILED_ATTEMPTS,
    })
    if (!error && typeof data === 'boolean') {
      return data
    }
  } catch {
    // Fallback si RPC no está desplegado aún
  }
  return checkRateLimit(key)
}

// B2: Incremento en DB solo cuando hay un fallo real.
// recordFailedAttemptMemory se llama SOLO como fallback si la RPC falla — nunca las dos juntas.
async function recordDbFailedAttempt(key: string) {
  try {
    const { error } = await supabase.rpc('record_rate_limit_failure', { p_key: key })
    // B2: Supabase devuelve { error } sin lanzar excepción. Verificar explícitamente.
    if (error) throw error
    // RPC exitosa: solo la DB tiene el registro — no duplicar en memoria.
  } catch {
    // DB no disponible: registrar solo en memoria como fallback.
    recordFailedAttemptMemory(key)
  }
}

// Una solicitud de aprovisionamiento fallida consume intentos de la IP y del
// dispositivo. Sin esto, el rate limit por IP nunca se llenaba porque los
// ataques probaban codigos distintos desde la misma IP.
async function recordProvisioningFailure(clientIp: string, deviceId: string, codeKey?: string) {
  await recordDbFailedAttempt(`ip:${clientIp}`)
  if (deviceId) await recordDbFailedAttempt(`device:${deviceId}`)
  if (codeKey) await recordDbFailedAttempt(`code:${codeKey}`)
}

// --- Sanitizacion de la telemetria opcional --------------------------------------------
// El body lo controla un cliente no autenticado: se acotan longitudes y se rechazan
// caracteres de control antes de persistir nada.
function cleanText(value: unknown, maxLen: number): string | null {
  if (value === undefined || value === null) return null
  const text = String(value).trim().replace(/[\u0000-\u001f\u007f]/g, '')
  if (!text) return null
  return text.length > maxLen ? text.slice(0, maxLen) : text
}

function cleanBattery(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  // 0 es un valor legitimo (bateria agotada); null significa "desconocido" y es
  // preferible a 0 para no pisar la ultima lectura real en la UI.
  return Math.min(100, Math.max(0, Math.round(n)))
}

const SAFE_DEVICE_ID = /^[a-zA-Z0-9_-]{1,64}$/

serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) })
  }
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, origin)

  const clientIp = req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',').pop()?.trim() || 'unknown-ip'

  let parsed: unknown
  try {
    parsed = await req.json()
  } catch {
    return json({ error: 'json invalido' }, 400, origin)
  }

  // El cuerpo lo controla el cliente. `null`, un array o un escalar son JSON valido pero
  // no tienen propiedades: sin esta comprobacion, body.activationCode lanzaba un
  // TypeError no capturado y la respuesta era un 500 con traza de Deno en vez de un 400.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return json({ error: 'cuerpo json invalido' }, 400, origin)
  }
  const body = parsed as Record<string, unknown>

  const PROVISION_SECRET = Deno.env.get('PROVISION_SECRET')
  if (!PROVISION_SECRET) {
    // Fail-closed: sin secret la funcion no debe aprovisionar nada.
    throw new Error('[provision-device] PROVISION_SECRET no configurada')
  }

  const activationCode = String(body.activationCode ?? body.activation_code ?? '').trim()
  // Sin truncar: un deviceId de 65 caracteres se recortaba a 64 y pasaba la validación,
  // con lo que el cliente acababa aprovisionando un dispositivo distinto del que
  // creia pedir. Si excede el limite, es un id invalido y se rechaza.
  const deviceId = String(body.deviceId ?? '').trim()

  // El codigo se hashea para usarlo como clave de rate limit: provision_rate_limits
  // es service_role-only, pero no hace falta guardar el secreto en texto plano.
  const codeKey = activationCode ? `code:${await sha256Hex(activationCode)}` : undefined

  if (!deviceId || !SAFE_DEVICE_ID.test(deviceId)) {
    await recordProvisioningFailure(clientIp, '')
    return json({ error: 'deviceId invalido' }, 400, origin)
  }

  // Verificación de Rate Limit por IP, deviceId y código de activación (Persistente en DB + In-memory fallback)
  const ipAllowed = await checkDbRateLimit(`ip:${clientIp}`)
  const deviceAllowed = await checkDbRateLimit(`device:${deviceId}`)
  const codeAllowed = codeKey ? await checkDbRateLimit(codeKey) : true

  if (!ipAllowed || !deviceAllowed || !codeAllowed) {
    return json({ error: 'demasiados intentos de aprovisionamiento. intente mas tarde' }, 429, origin)
  }

  // --- Autorizacion del codigo de activacion -------------------------------------------
  // AUTO_PROVISION es lo que el APK manda cuando nunca recibio un codigo: no es una
  // credencial. Por defecto se rechaza; solo se acepta si el operador lo habilita
  // explicitamente (ALLOW_AUTO_PROVISION=true), porque es el modo inseguro legacy.
  if (!activationCode || activationCode === 'AUTO_PROVISION') {
    if (Deno.env.get('ALLOW_AUTO_PROVISION') !== 'true') {
      await recordProvisioningFailure(clientIp, deviceId, codeKey)
      return json({ error: 'codigo de activacion invalido' }, 403, origin)
    }
  }

  // 1) Codigo de la organizacion: determina el tenant sin depender del orden de insercion.
  const { data: orgByCode, error: orgByCodeErr } = await supabase
    .from('organizations')
    .select('id')
    .eq('activation_code', activationCode)
    .maybeSingle()

  if (orgByCodeErr) {
    console.warn('provision-device: error consultando organizations por activation_code', orgByCodeErr.message)
    return json({ error: 'error validando el codigo de activacion' }, 500, origin)
  }

  // 2) Secret global: fallback para una instalacion de un solo tenant.
  let orgId: string | undefined = orgByCode?.id
  if (!orgId) {
    if (await secretEquals(activationCode, PROVISION_SECRET)) {
      const { data: defaultOrg } = await supabase
        .from('organizations')
        .select('id')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      orgId = defaultOrg?.id
    }
  }

  if (!orgId) {
    await recordProvisioningFailure(clientIp, deviceId, codeKey)
    return json({ error: 'codigo de activacion invalido' }, 403, origin)
  }

  // Verificación de registro previo en el sistema
  const existingReg = await supabase
    .from('device_registry')
    .select('device_id, organization_id')
    .eq('device_id', deviceId)
    .maybeSingle()

  // Los mensajes de Supabase nombran tablas, columnas y constraints. En un endpoint
  // publico eso es informacion gratuita sobre el esquema, asi que al cliente se le
  // devuelve un mensaje generico y el detalle se queda en el log del servidor.
  if (existingReg.error) {
    console.error('provision-device: error en device_registry', existingReg.error.message)
    return json({ error: 'error interno' }, 500, origin)
  }

  const deviceExisting = await supabase
    .from('devices')
    .select('auth_user_id, status, organization_id')
    .eq('id', deviceId)
    .maybeSingle()

  if (deviceExisting.error) {
    console.error('provision-device: error en devices', deviceExisting.error.message)
    return json({ error: 'error interno' }, 500, origin)
  }

  // Un codigo de la org A no puede re-aprovisionar un dispositivo dado de baja
  // que pertenece a la org B: moverlo de tenant con un codigo ajeno seria un
  // escalamiento de privilegios.
  const previousOrgId = existingReg.data?.organization_id ?? deviceExisting.data?.organization_id ?? null
  if (previousOrgId && previousOrgId !== orgId) {
    await recordProvisioningFailure(clientIp, deviceId, codeKey)
    return json({ error: 'El dispositivo pertenece a otra organizacion.' }, 403, origin)
  }

  // Si existe en device_registrations (existingReg.data), siempre lo consideramos registrado
  // Si existe en devices, lo consideramos registrado SOLO SI está activo/online.
  // Si está 'inactive', es porque fue eliminado (baja lógica), por lo que permitimos re-aprovisionar.
  const isInactive = deviceExisting.data && deviceExisting.data.status === 'inactive';
  const isAlreadyRegistered = Boolean(existingReg.data || (deviceExisting.data && !isInactive))

  if (isAlreadyRegistered) {
    // Anti-hijack protection: no re-provisioning allowed for existing devices
    await recordProvisioningFailure(clientIp, deviceId, codeKey)
    return json({ error: 'El dispositivo ya se encuentra registrado y activado.' }, 403, origin)
  }

  // Generamos un correo único agregando un timestamp corto para evitar colisiones "email already registered"
  // si hubo un intento fallido anterior que dejó al usuario huérfano en auth.users
  const uniqueSuffix = Math.floor(Date.now() / 1000).toString(36)
  const email = `device-${deviceId}-${uniqueSuffix}@local.rideguard`
  const password = randomPassword()

  // Si está inactivo, primero limpiamos el usuario de auth anterior si lo había,
  // o simplemente dejamos que el nuevo usuario tome el control sobreescribiendo el auth_user_id.
  if (isInactive && deviceExisting.data.auth_user_id) {
    try {
      await supabase.auth.admin.deleteUser(deviceExisting.data.auth_user_id);
    } catch (e) {
      // Ignorar si el usuario ya no existe
    }
  }

  // Primer aprovisionamiento del dispositivo
  const created = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: 'device', device_id: deviceId },
  })
  if (created.error) {
    // B1: Era recordFailedAttempt (no existe) — corregido a recordDbFailedAttempt.
    await recordProvisioningFailure(clientIp, deviceId, codeKey)
    console.error('provision-device: createUser fallo', created.error.message)
    return json({ error: 'error creando el usuario del dispositivo' }, 500, origin)
  }

  // La telemetria se captura en el alta: leerla del body del handshake evita que
  // model/app_version/battery queden para siempre en null o en un placeholder fijo.
  const platform = cleanText(body.platform, 40)
  const model = cleanText(body.model, 80)
  const appVersion = cleanText(body.appVersion ?? body.app_version, 32)
  const battery = cleanBattery(body.battery)
  const label = cleanText(body.label, 80)

  // Insert or Upsert into devices
  // 'status' debe ser 'active': la policy gps_locations_device_insert exige
  // status in ('active','online') y el default de la columna es 'offline',
  // sin este campo RLS rechazaria el 100% de los inserts de posicion.
  const { error: deviceErr } = await supabase.from('devices').upsert({
    id: deviceId,
    auth_user_id: created.data.user.id,
    organization_id: orgId,
    status: 'active',
    platform: platform ?? 'android',
    model,
    app_version: appVersion,
    battery,
  })

  // Insert or Upsert into vehicles
  const vehicleName = label ?? ('Auto-Móvil ' + deviceId.substring(0, 4))
  const { error: vehicleErr } = await supabase.from('vehicles').upsert({
    id: deviceId, // We use the same ID for simplicity in auto-provisioning
    device_id: deviceId,
    name: vehicleName,
    organization_id: orgId,
    status: 'active'
  })

  // Insert or Upsert into device_registry
  // Esta tabla es el puente device_id -> vehicle_id. Sin esta fila:
  //   - delete-device-user nunca resuelve vehicle_id y deja vehiculos huerfanos
  //   - reconcile_pending_deletions cae siempre en la rama ELSE y borra el device
  //     (cascada => se pierde todo el historial GPS) sin borrar el vehiculo
  //   - el UPDATE de device_registry en delete_vehicle_cascade es un no-op
  const { error: registryErr } = await supabase.from('device_registry').upsert({
    device_id: deviceId,
    organization_id: orgId,
    vehicle_id: deviceId,
    label: vehicleName,
    app_version: appVersion,
    status: 'active'
  })

  if (deviceErr || vehicleErr || registryErr) {
    await recordProvisioningFailure(clientIp, deviceId, codeKey)

    // Cleanup orphan user
    if (created.data?.user?.id) {
      const { error: deleteErr } = await supabase.auth.admin.deleteUser(created.data.user.id)
      if (deleteErr) {
        await supabase.from('orphan_auth_users').insert({
          auth_user_id: created.data.user.id,
          device_id: deviceId,
          reason: `auto-provision failed. deleteUser also failed: ${deleteErr.message}`,
        })
      }
    }
    console.error('provision-device: fallo de persistencia', deviceErr?.message, vehicleErr?.message, registryErr?.message)
    return json({ error: 'error al registrar el dispositivo' }, 500, origin)
  }

  await clearDbRateLimit(`ip:${clientIp}`)
  await clearDbRateLimit(`device:${deviceId}`)
  if (codeKey) await clearDbRateLimit(codeKey)
  return json({ ok: true, deviceId, email, password }, 200, origin)
})