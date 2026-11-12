-- Migración para arreglar problemas de RLS y cascada (Task 3)

-- 1. Helpers de rol: devolver siempre un booleano real (false en vez de NULL).
--
--    El bug original: `current_profile_role() in ('admin','owner')` devuelve NULL
--    cuando el usuario no tiene fila en profiles. En PL/pgSQL `if not NULL then`
--    NO entra (NOT NULL = NULL), por lo que las guardas de seguridad se saltaban
--    en silencio.
--
--    OJO: el `coalesce` debe envolver la EXPRESION COMPLETA, no solo el primer
--    operando. `coalesce(A, false) or B` sigue devolviendo NULL si B es NULL.
create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where user_id = auth.uid();
$$;

-- 'viewer' es un valor válido del CHECK de profiles.role (owner/admin/operator/viewer).
-- Excluirlo hacía que un viewer pasara el AuthGate y viera el dashboard completo con
-- las 5 listas vacías y sin error. Se incluye para no dejarlo como rol muerto.
create or replace function public.has_profile()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_profile_role() in ('owner', 'admin', 'operator', 'viewer'),
    false
  );
$$;

create or replace function public.is_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_profile_role() in ('operator', 'admin', 'owner'),
    false
  );
$$;

-- is_admin():
--   - `auth.role()` se lee de request.jwt.claim.role, que PostgREST solo fija tras
--     verificar la firma del JWT -> no es falsificable por un usuario autenticado.
--   - `session_user` NO cambia dentro de SECURITY DEFINER (a diferencia de
--     current_user, que siempre es el dueño de la función). Bajo pg_cron la sesión
--     es 'postgres'; vía PostgREST es 'authenticator'. Por eso el termino de pg_cron
--     NO puede ser explotado por un usuario autenticado normal.
--   - el `auth.uid() is null` evita que una fila de profiles huerfana pueda
--    auto-escalarse en un contexto sin JWT.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (public.current_profile_role() in ('admin', 'owner'))
    or (auth.role() = 'service_role')
    or (session_user = 'postgres' and auth.uid() is null),
    false
  );
$$;

-- 2. delete_vehicle_cascade
--
--    IMPORTANTE: NO declarar `p_org_id uuid default null`.
--    Postgres hace match de una llamada de 1 argumento contra cualquier overload cuyo
--    ultimo parametro tenga default, asi que `delete_vehicle_cascade('veh-A')` quedaria
--    ambiguo entre (text) y (text,uuid) -> "function is not unique" -> error en runtime.
--    Eso rompia el RPC existente en supabase/functions/delete-device-user/index.ts.
--    En su lugar se mantienen DOS overloads sin defaults:
--      (text)      -> wrapper retrocompatible, delega con org NULL
--      (text,uuid) -> la logica real
--
--    a) Filtra los UPDATE por organization_id (cierra el cross-tenant: un admin de la
--       org A ya no puede desactivar el device de la org B vía vehicles.device_id).
--    b) organization_id es NULLABLE en devices, y set_device_insert_org_id permite
--       insertar con NULL. Con el filtro por org, un device sin org NO se desactivaba
--       pero el vehiculo SÍ se borraba -> el device seguía subiendo GPS con contraseña
--       válida y sin vehiculo. De ahí el `or organization_id is null`.
--    c) `current_role = 'service_role'` es inalcanzable dentro de SECURITY DEFINER
--       (current_role es sinónimo de current_user = dueño de la función). Se usa
--       `p_org_id`, que solo se honra cuando el contexto ya pasó is_admin() Y no tiene
--       org propia (service_role / pg_cron). Un admin autenticado SIEMPRE usa la org de
--       su propio perfil, así que el argumento nunca puede elevar privilegios.
--    d) Se devuelve un `code` legible por máquina además de `error`, para que el
--       llamador no tenga que hacer match de strings.
create or replace function public.delete_vehicle_cascade(
  p_vehicle_id text,
  p_org_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device_id text;
  v_org_id uuid;
  v_auth_user_id uuid;
begin
  if public.is_admin() is not true then
    return jsonb_build_object(
      'success', false,
      'code', 'forbidden',
      'error', 'Acceso denegado: Requiere rol de administrador'
    );
  end if;

  -- La org siempre se deriva del perfil del llamador. p_org_id solo rellena el caso
  -- en que no hay perfil (service_role / pg_cron), donde ya se pasó is_admin().
  v_org_id := coalesce(public.current_user_org_id(), p_org_id);

  if v_org_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'org_not_found',
      'error', 'Acceso denegado: Organización no encontrada'
    );
  end if;

  select device_id into v_device_id
  from public.vehicles
  where id = p_vehicle_id and organization_id = v_org_id;

  if not found then
    return jsonb_build_object(
      'success', false,
      'code', 'not_found',
      'error', 'Vehículo no encontrado o sin permisos'
    );
  end if;

  if v_device_id is not null then
    select auth_user_id into v_auth_user_id from public.devices where id = v_device_id;

    update public.devices
    set status = 'inactive', auth_user_id = null, updated_at = now()
    where id = v_device_id
      and (organization_id = v_org_id or organization_id is null);

    update public.device_registry
    set vehicle_id = null, status = 'inactive', last_seen = now()
    where device_id = v_device_id
      and (organization_id = v_org_id or organization_id is null);

  end if;

  delete from public.vehicles
  where id = p_vehicle_id and organization_id = v_org_id;

  return jsonb_build_object(
    'success', true,
    'code', 'deleted',
    'device_id', v_device_id,
    'auth_user_id', v_auth_user_id
  );
end;
$$;

-- Overload de 1 argumento, retrocompatible con el RPC ya desplegado
-- (rpc('delete_vehicle_cascade', { p_vehicle_id })). Delega en la version de 2 args.
-- Al no declarar defaults, no hay ambigüedad entre overloads.
create or replace function public.delete_vehicle_cascade(
  p_vehicle_id text
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.delete_vehicle_cascade(p_vehicle_id, null::uuid);
$$;

-- El grant anterior sigue vigente (create or replace preserva el ACL), pero los
-- params nuevos tambien necesitan permiso de ejecucion para authenticated.
grant execute on function public.delete_vehicle_cascade(text, uuid) to authenticated;
grant execute on function public.delete_vehicle_cascade(text) to authenticated;

-- 3. gps_locations_device_insert
--
--    La version previa exigia `registered_device.status = 'active'`, pero el default de
--    devices.status es 'offline' y provision-device no mandaba status, asi que RLS
--    rechazaba el 100% de los inserts de posicion. Ahora se acepta 'offline' tambien:
--    lo que restringe de verdad es que devices.status NOT IN ('inactive','revoked').
create or replace function public.device_is_gps_enabled(p_device_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(exists (
    select 1
    from public.devices d
    where d.id = p_device_id
      and d.status in ('active', 'online', 'offline')
  ), false);
$$;

drop policy if exists "gps_locations_device_insert" on public.gps_locations;
create policy "gps_locations_device_insert"
  on public.gps_locations for insert
  to authenticated
  with check (
    device_id = public.current_device_id()
    and public.device_is_gps_enabled(device_id)
  );

-- 4. reconcile_pending_deletions
--
--    Antes comparaba strings con `like '%no encontrad%'`, lo que convertía un fallo
--    real ('Acceso denegado: Organización no encontrada') en "reconciliado", dejando
--    vehiculos huerfanos marcados como resueltos y sin reintento. Ahora usa el `code`.
--    Además le pasa la organización, que ya viene en el SELECT, porque bajo pg_cron
--    no hay JWT del cual derivarla.
create or replace function public.reconcile_pending_deletions()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  reconciled int := 0;
  rpc_result jsonb;
begin
  for rec in
    select d.id as device_id, dr.vehicle_id, d.organization_id
    from public.devices d
    left join public.device_registry dr on dr.device_id = d.id
    where d.deletion_pending = true
    order by d.updated_at asc
    limit 50
  loop
    begin
      if rec.vehicle_id is not null then
        select public.delete_vehicle_cascade(rec.vehicle_id, rec.organization_id)
          into rpc_result;

        if rpc_result->>'success' = 'true' or rpc_result->>'code' = 'not_found' then
          update public.devices set deletion_pending = false where id = rec.device_id;
          reconciled := reconciled + 1;
        else
          raise warning 'reconcile_pending_deletions: no se pudo borrar vehicle_id=% (code=%)',
            rec.vehicle_id, coalesce(rpc_result->>'code', 'desconocido');
        end if;
      else
        -- Sin vehiculo no hay nada que limpiar en cascada: se borra solo el device.
        -- Esto SI dispara el ON DELETE CASCADE de gps_locations (borra el historial),
        -- que es el comportamiento correcto al eliminar un dispositivo.
        delete from public.devices where id = rec.device_id;
        reconciled := reconciled + 1;
      end if;

    exception when others then
      raise warning 'reconcile_pending_deletions: error procesando device_id=% vehicle_id=%: %',
        rec.device_id, rec.vehicle_id, sqlerrm;
    end;
  end loop;

  return reconciled;
end;
$$;

-- 5. Revocar ejecucion anon/public de los helpers de rol.
--    Supabase concede EXECUTE por default a anon en toda funcion nueva del schema
--    public (alter default privileges). No filtran nada (todos estan scopeados a
--    auth.uid()), pero no hay motivo para dejarlos ejecutables sin sesion.
revoke execute on function public.current_profile_role() from public, anon;
revoke execute on function public.has_profile() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_operator() from public, anon;
revoke execute on function public.device_is_gps_enabled(text) from public, anon;

grant execute on function public.current_profile_role() to authenticated, service_role;
grant execute on function public.has_profile() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.is_operator() to authenticated, service_role;
grant execute on function public.device_is_gps_enabled(text) to authenticated, service_role;

-- 6. CHECKs de rango en telemetria. Sin esto un device puede insertar
--    speed = 1e308 o bearing = -5e9 y los clamps del cliente no son un control de DB.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gps_locations_speed_check') then
    alter table public.gps_locations
      add constraint gps_locations_speed_check check (speed is null or speed between 0 and 400);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gps_locations_bearing_check') then
    alter table public.gps_locations
      add constraint gps_locations_bearing_check check (bearing is null or bearing between 0 and 360);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gps_locations_accuracy_check') then
    alter table public.gps_locations
      add constraint gps_locations_accuracy_check check (accuracy is null or accuracy >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehicles_speed_check') then
    alter table public.vehicles
      add constraint vehicles_speed_check check (speed is null or speed between 0 and 400);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehicles_battery_check') then
    alter table public.vehicles
      add constraint vehicles_battery_check check (battery between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'devices_battery_check') then
    alter table public.devices
      add constraint devices_battery_check check (battery is null or battery between 0 and 100);
  end if;
end;
$$;

-- 7. Indices en organization_id. Todas las policies filtran por organization_id y
--    las tablas están publicadas en supabase_realtime: sin índice, cada evento de
--    GPS dispara un seq scan por org en cada tabla.
create index if not exists profiles_organization_id_idx on public.profiles (organization_id);
create index if not exists device_registry_organization_id_idx on public.device_registry (organization_id);
create index if not exists devices_organization_id_idx on public.devices (organization_id);
create index if not exists vehicles_organization_id_idx on public.vehicles (organization_id);
create index if not exists alerts_organization_id_idx on public.alerts (organization_id);
create index if not exists geofences_organization_id_idx on public.geofences (organization_id);
create index if not exists vehicles_device_id_idx on public.vehicles (device_id);

-- check_rate_limit hace `delete from provision_rate_limits where expires_at < now()`
-- en cada request, sin indice de soporte -> seq scan + escritura con row locks.
create index if not exists provision_rate_limits_expires_at_idx on public.provision_rate_limits (expires_at);

-- 8. Grants de secuencia. gps_locations, alerts y geofences usan
--    `generated by default as identity`; sin esto los inserts fallan con
--    'permission denied for sequence' en cualquier Postgres sin los default
--    privileges de Supabase.
grant usage, select on all sequences in schema public to authenticated, service_role;
