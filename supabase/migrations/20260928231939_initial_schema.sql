-- Run this in Supabase SQL Editor.
-- The publishable key belongs in Vercel/Android runtime configuration, never here.

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text,
  role text not null default 'operator' check (role in ('owner', 'admin', 'operator', 'viewer')),
  created_at timestamptz not null default now()
);

create table if not exists public.device_registry (
  device_id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vehicle_id text,
  label text,
  app_version text,
  status text not null default 'offline',
  last_seen timestamptz,
  created_at timestamptz not null default now()
);

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.device_registry enable row level security;

drop policy if exists "profiles_self_read" on public.profiles;
create policy "profiles_self_read" on public.profiles for select to authenticated using (user_id = auth.uid());

drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =====================================================================
-- Roles y permisos (RBAC)
-- =====================================================================

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role from public.profiles p where p.user_id = auth.uid();
$$;

create or replace function public.current_user_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.organization_id from public.profiles p where p.user_id = auth.uid();
$$;

create or replace function public.has_profile()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and coalesce((auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'device'
  );
$$;

create or replace function public.is_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_role() in ('operator', 'admin', 'owner');
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- B4: Aceptar también service_role para que pg_cron y RPCs internas puedan
  -- llamar a delete_vehicle_cascade y reconcile_pending_deletions sin fallar.
  -- current_role = 'service_role' cuando se invoca vía pg_cron o service_role JWT.
  select public.current_profile_role() in ('admin', 'owner')
      or current_role = 'service_role';
$$;

-- Sin esta policy, organizations queda con RLS habilitado y 0 policies: deny-all.
-- Cada operador necesita leer el nombre de SU organización para operar el panel.
-- Se declara aquí (y no junto al CREATE TABLE) porque depende de
-- current_user_org_id(), definida más arriba en este mismo script.
drop policy if exists "organizations_member_read" on public.organizations;
create policy "organizations_member_read"
  on public.organizations for select
  to authenticated
  using (id = public.current_user_org_id());

create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.role is distinct from old.role
      or new.organization_id is distinct from old.organization_id)
     and not public.is_admin() then
    raise exception 'No autorizado para cambiar rol u organizacion';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_fields on public.profiles;
create trigger profiles_protect_fields
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

drop policy if exists "device_registry_authenticated_read" on public.device_registry;
create policy "device_registry_authenticated_read" on public.device_registry for select to authenticated using (
  organization_id in (select organization_id from public.profiles where user_id = auth.uid())
);

drop policy if exists "device_registry_authenticated_write" on public.device_registry;
drop policy if exists "device_registry_admin_write" on public.device_registry;
create policy "device_registry_admin_write" on public.device_registry for all to authenticated using (
  public.is_admin() and organization_id = public.current_user_org_id()
) with check (
  public.is_admin() and organization_id = public.current_user_org_id()
);

create table if not exists public.gps_locations (
  id bigint generated by default as identity primary key,
  device_id text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  speed double precision not null default 0,
  accuracy double precision,
  altitude double precision,
  bearing double precision,
  timestamp timestamptz not null default now()
);

alter table public.gps_locations add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.gps_locations add column if not exists event_id text;

create index if not exists gps_locations_device_timestamp_idx
  on public.gps_locations (device_id, timestamp desc);

create index if not exists gps_locations_org_device_ts_idx
  on public.gps_locations (organization_id, device_id, timestamp desc);

-- C1: Índice único NO parcial sobre (device_id, event_id).
-- NULL != NULL en SQL → múltiples filas con event_id NULL conviven sin conflicto.
-- Un índice parcial (WHERE event_id IS NOT NULL) impide que PostgREST resuelva
-- el ON CONFLICT, lo que causa error 42P10 y que NINGUNA posición llegue a la DB.
create unique index if not exists gps_locations_device_event_idx
  on public.gps_locations (device_id, event_id);

alter table public.gps_locations enable row level security;

-- C7: FORCE ROW LEVEL SECURITY garantiza que las suscripciones de Supabase Realtime
-- (que se conectan como owner, saltando RLS por defecto) apliquen las policies.
-- Sin esto, cualquier suscriptor ve filas de TODAS las organizaciones.
alter table public.gps_locations force row level security;

alter table public.gps_locations replica identity full;

-- B6: Tabla para rastrear usuarios Auth huérfanos que no pudieron eliminarse automáticamente.
-- Se inserta cuando provision-device crea un usuario Auth pero la RPC falla Y la eliminación
-- del usuario también falla. Permite limpieza manual o automatizada.
create table if not exists public.orphan_auth_users (
  id          uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  device_id   text,
  reason      text,
  created_at  timestamptz not null default now()
);

-- Solo service_role puede leer/escribir (no exponer a clientes).
alter table public.orphan_auth_users enable row level security;
revoke all on public.orphan_auth_users from public, anon, authenticated;
grant all on public.orphan_auth_users to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'gps_locations'
  ) then
    alter publication supabase_realtime add table public.gps_locations;
  end if;
end $$;

-- Vista de última ubicación por dispositivo con RLS de seguridad del invocador
create or replace view public.latest_gps_locations
with (security_invoker = true) as
select distinct on (device_id)
  id,
  device_id,
  latitude,
  longitude,
  speed,
  accuracy,
  altitude,
  bearing,
  timestamp,
  organization_id
from public.gps_locations
order by device_id, timestamp desc;

grant select on public.latest_gps_locations to authenticated;

-- =====================================================================
-- Tabla y función atómica para Rate Limiter persistente en Edge Function
-- =====================================================================
create table if not exists public.provision_rate_limits (
  key text primary key,
  attempts integer not null default 1,
  expires_at timestamptz not null
);

alter table public.provision_rate_limits enable row level security;
revoke all on public.provision_rate_limits from public, anon, authenticated;
grant all on public.provision_rate_limits to service_role;

-- B3: check_rate_limit ahora es SOLO LECTURA. No incrementa.
-- Solo registra fallo quien llama a record_rate_limit_failure.
create or replace function public.check_rate_limit(
  p_key text,
  p_max_attempts int default 5,
  p_window_seconds int default 900
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  v_attempts int;
begin
  -- Limpiar expirados (efecto secundario mínimo aceptable)
  delete from public.provision_rate_limits where expires_at < now_ts;

  -- Solo leer, sin incrementar
  select attempts into v_attempts
  from public.provision_rate_limits
  where key = p_key and expires_at >= now_ts;

  if not found then
    return true; -- Sin registro = permitido
  end if;

  return v_attempts < p_max_attempts;
end;
$$;

create or replace function public.clear_rate_limit(
  p_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.provision_rate_limits where key = p_key;
end;
$$;

-- B3: record_rate_limit_failure ahora realmente incrementa el contador.
-- Se llama ÚNICAMENTE cuando una solicitud falla.
create or replace function public.record_rate_limit_failure(
  p_key text,
  p_window_seconds int default 900
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.provision_rate_limits (key, attempts, expires_at)
  values (p_key, 1, now() + (p_window_seconds || ' seconds')::interval)
  on conflict (key) do update
  set attempts = public.provision_rate_limits.attempts + 1;
end;
$$;

revoke execute on function public.check_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, int, int) to service_role;
revoke execute on function public.clear_rate_limit(text) from public, anon, authenticated;
grant execute on function public.clear_rate_limit(text) to service_role;
revoke execute on function public.record_rate_limit_failure(text, int) from public, anon, authenticated;
grant execute on function public.record_rate_limit_failure(text, int) to service_role;





-- RPC para actualización de telemetría de dispositivos (batería, modelo, plataforma, versión, last_seen, location_status)
create or replace function public.update_device_telemetry(
  p_device_id text,
  p_battery smallint default null,
  p_model text default null,
  p_platform text default null,
  p_app_version text default null,
  p_location_status text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count int;
begin
  if p_device_id is null or p_device_id <> public.current_device_id() then
    raise exception 'Dispositivo no autorizado';
  end if;

  update public.devices
  set battery = coalesce(p_battery, battery),
      model = coalesce(p_model, model),
      platform = coalesce(p_platform, platform),
      app_version = coalesce(p_app_version, app_version),
      location_status = coalesce(p_location_status, location_status),
      status = 'online',
      last_seen = now(),
      updated_at = now()
  where id = p_device_id
    and auth_user_id = auth.uid()
    and status not in ('inactive', 'revoked');

  get diagnostics updated_count = row_count;
  if updated_count = 0 then
    raise exception 'El dispositivo esta inactivo, revocado o no autorizado';
  end if;
  return true;
end;
$$;

revoke execute on function public.update_device_telemetry(text, smallint, text, text, text, text) from public, anon;
grant execute on function public.update_device_telemetry(text, smallint, text, text, text, text) to authenticated, service_role;

create table if not exists public.devices (
  id text primary key,
  status text not null default 'offline',
  last_seen timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.devices add column if not exists platform text;
alter table public.devices add column if not exists model text;
alter table public.devices add column if not exists app_version text;
alter table public.devices add column if not exists battery smallint;
alter table public.devices add column if not exists label text;
alter table public.devices add column if not exists location_status text;
alter table public.devices add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.devices add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
-- B6: flag para eliminación segura. Marcado antes de borrar Auth; limpiado por la cascada SQL.
alter table public.devices add column if not exists deletion_pending boolean not null default false;

alter table public.devices enable row level security;

-- C7: FORCE ROW LEVEL SECURITY para Realtime.
alter table public.devices force row level security;

-- Add business FKs and Check constraints
alter table public.gps_locations drop constraint if exists gps_locations_device_id_fkey;
alter table public.gps_locations add constraint gps_locations_device_id_fkey foreign key (device_id) references public.devices(id) on delete cascade;

alter table public.devices drop constraint if exists devices_status_check;
alter table public.devices add constraint devices_status_check check (status in ('active', 'inactive', 'online', 'offline', 'revoked'));

alter table public.device_registry drop constraint if exists device_registry_status_check;
alter table public.device_registry add constraint device_registry_status_check check (status in ('active', 'inactive', 'online', 'offline', 'revoked'));

alter table public.devices replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'devices'
  ) then
    alter publication supabase_realtime add table public.devices;
  end if;
end $$;

create or replace function public.set_gps_location_org_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_org_id uuid;
begin
  select organization_id into target_org_id
  from public.devices
  where id = new.device_id;

  if target_org_id is null then
    raise exception 'El dispositivo % no esta registrado o asignado a una organizacion', new.device_id;
  end if;

  -- Sobrescribir incondicionalmente el valor recibido con la organización real asignada al dispositivo
  new.organization_id := target_org_id;
  return new;
end;
$$;

drop trigger if exists gps_locations_set_org on public.gps_locations;
create trigger gps_locations_set_org
  before insert on public.gps_locations
  for each row execute function public.set_gps_location_org_id();


-- =====================================================================
-- Flota de vehiculos
-- =====================================================================

create table if not exists public.vehicles (
  id text primary key,
  device_id text,
  name text not null,
  plate text,
  driver text,
  status text not null default 'offline',
  speed double precision not null default 0,
  battery smallint not null default 0,
  fuel smallint,
  temp double precision,
  odometer text,
  location text,
  route jsonb,
  last_update timestamptz not null default now()
);

alter table public.vehicles add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

alter table public.vehicles enable row level security;

drop policy if exists "vehicles_authenticated_all" on public.vehicles;
drop policy if exists "vehicles_select" on public.vehicles;
create policy "vehicles_select"
  on public.vehicles for select
  to authenticated
  using (public.has_profile() and organization_id = public.current_user_org_id());

drop policy if exists "vehicles_admin_insert" on public.vehicles;
create policy "vehicles_admin_insert"
  on public.vehicles for insert
  to authenticated
  with check (public.is_admin() and organization_id = public.current_user_org_id());

drop policy if exists "vehicles_admin_delete" on public.vehicles;
create policy "vehicles_admin_delete"
  on public.vehicles for delete
  to authenticated
  using (public.is_admin() and organization_id = public.current_user_org_id());

-- Trigger para proteger inmutabilidad de device_id u organization_id en vehiculos (evita recursión RLS)
create or replace function public.protect_vehicle_structural_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.device_id is distinct from OLD.device_id then
    raise exception 'No esta permitido modificar el device_id de un vehiculo existente';
  end if;
  if NEW.organization_id is distinct from OLD.organization_id then
    raise exception 'No esta permitido modificar la organizacion de un vehiculo existente';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_protect_vehicle_structural_fields on public.vehicles;
create trigger trg_protect_vehicle_structural_fields
  before update on public.vehicles
  for each row
  execute function public.protect_vehicle_structural_fields();

drop policy if exists "vehicles_operator_update" on public.vehicles;
create policy "vehicles_operator_update"
  on public.vehicles for update
  to authenticated
  using (public.is_operator() and organization_id = public.current_user_org_id())
  with check (public.is_operator() and organization_id = public.current_user_org_id());

-- La validación de status vive aquí y no en una RPC: un CHECK protege a todos los
-- escritores (Edge Function, service_role, dashboard vía vehicles_operator_update),
-- mientras que una RPC solo protege a quien la invoca.
alter table public.vehicles drop constraint if exists vehicles_status_check;
alter table public.vehicles add constraint vehicles_status_check
  check (status in ('active', 'online', 'offline', 'stopped', 'immobilized'));

alter table public.vehicles replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'vehicles'
  ) then
    alter publication supabase_realtime add table public.vehicles;
  end if;
end $$;

-- C7: FORCE ROW LEVEL SECURITY para vehicles — Realtime usaría owner sin esto.
alter table public.vehicles force row level security;

-- =====================================================================
-- Alertas
-- =====================================================================

create table if not exists public.alerts (
  id bigint generated by default as identity primary key,
  severity text not null default 'info' check (severity in ('critical', 'warning', 'info')),
  title text not null,
  description text,
  vehicle_id text,
  plate text,
  speed double precision not null default 0,
  battery smallint,
  voltage double precision,
  location_name text,
  lat double precision,
  lng double precision,
  read boolean not null default false,
  timestamp timestamptz not null default now()
);

alter table public.alerts add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

alter table public.alerts enable row level security;

drop policy if exists "alerts_authenticated_all" on public.alerts;
drop policy if exists "alerts_select" on public.alerts;
create policy "alerts_select"
  on public.alerts for select
  to authenticated
  using (public.has_profile() and organization_id = public.current_user_org_id());

drop policy if exists "alerts_admin_insert" on public.alerts;
create policy "alerts_admin_insert"
  on public.alerts for insert
  to authenticated
  with check (public.is_admin() and organization_id = public.current_user_org_id());

drop policy if exists "alerts_admin_delete" on public.alerts;
create policy "alerts_admin_delete"
  on public.alerts for delete
  to authenticated
  using (public.is_admin() and organization_id = public.current_user_org_id());

drop policy if exists "alerts_operator_update" on public.alerts;
create policy "alerts_operator_update"
  on public.alerts for update
  to authenticated
  using (public.is_operator() and organization_id = public.current_user_org_id())
  with check (public.is_operator() and organization_id = public.current_user_org_id());

create index if not exists alerts_timestamp_idx on public.alerts (timestamp desc);

-- C7: Realtime de alertas sin fuga entre orgs.
alter table public.alerts force row level security;

-- A11: Agregar alerts a la publicación de Realtime (el frontend se suscribe pero la tabla no estaba).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'alerts'
  ) then
    alter publication supabase_realtime add table public.alerts;
  end if;
end $$;

-- =====================================================================
-- Geocercas
-- =====================================================================

create table if not exists public.geofences (
  id bigint generated by default as identity primary key,
  name text not null,
  type text not null default 'circle' check (type in ('circle', 'polygon')),
  center numeric[],
  positions jsonb,
  radius double precision not null default 600,
  color text not null default '#00E676',
  rule text not null default 'outside' check (rule in ('outside', 'inside')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.geofences add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

alter table public.geofences enable row level security;

drop policy if exists "geofences_authenticated_all" on public.geofences;
drop policy if exists "geofences_select" on public.geofences;
create policy "geofences_select"
  on public.geofences for select
  to authenticated
  using (public.has_profile() and organization_id = public.current_user_org_id());

drop policy if exists "geofences_admin_all" on public.geofences;
create policy "geofences_admin_all"
  on public.geofences for all
  to authenticated
  using (public.is_admin() and organization_id = public.current_user_org_id())
  with check (public.is_admin() and organization_id = public.current_user_org_id());

-- C7: Realtime de geocercas sin fuga entre orgs.
alter table public.geofences force row level security;

-- A11: Agregar geofences a la publicación de Realtime.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'geofences'
  ) then
    alter publication supabase_realtime add table public.geofences;
  end if;
end $$;

-- =====================================================================
-- Login por dispositivo (multitenant)
-- =====================================================================

-- P8: Migración explícita de FK auth_user_id: CASCADE → SET NULL.
-- ADD COLUMN IF NOT EXISTS no modifica constraints existentes, por lo que bases antiguas
-- pueden tener ON DELETE CASCADE. Este bloque normaliza el comportamiento.
do $$ begin
  -- Detectar y eliminar la constraint antigua (ON DELETE CASCADE)
  if exists (
    select 1 from information_schema.referential_constraints rc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = rc.constraint_name
    where kcu.table_name = 'devices'
      and kcu.column_name = 'auth_user_id'
      and rc.delete_rule = 'CASCADE'
  ) then
    alter table public.devices drop constraint if exists devices_auth_user_id_fkey;
    alter table public.devices
      add constraint devices_auth_user_id_fkey
      foreign key (auth_user_id) references auth.users(id) on delete set null;
  end if;
end $$;

alter table public.devices add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
create unique index if not exists devices_auth_user_id_idx
  on public.devices (auth_user_id)
  where auth_user_id is not null;

create or replace function public.current_device_id()
returns text
language sql
stable
as $$
  select auth.jwt() -> 'app_metadata' ->> 'device_id';
$$;

drop policy if exists "devices_authenticated_read" on public.devices;
create policy "devices_authenticated_read"
  on public.devices for select
  to authenticated
  using (
    (public.has_profile() and organization_id = public.current_user_org_id())
    or auth_user_id = auth.uid()
  );

-- Trigger para prevenir asignaciones arbitrarias de organización al insertar dispositivos
create or replace function public.set_device_insert_org_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_org_id uuid;
begin
  if not public.is_admin() then
    select organization_id into existing_org_id
    from public.devices
    where id = NEW.id;

    if existing_org_id is null then
      select organization_id into existing_org_id
      from public.device_registry
      where device_id = NEW.id;
    end if;

    if existing_org_id is not null then
      NEW.organization_id := existing_org_id;
    elsif NEW.organization_id is not null then
      raise exception 'No esta permitido asignar una organizacion arbitraria a un dispositivo sin aprovisionamiento';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_set_device_insert_org_id on public.devices;
create trigger trg_set_device_insert_org_id
  before insert on public.devices
  for each row execute function public.set_device_insert_org_id();

drop policy if exists "devices_device_insert" on public.devices;
create policy "devices_device_insert"
  on public.devices for insert
  to authenticated
  with check (id = public.current_device_id() and auth_user_id = auth.uid());




create or replace function public.protect_device_structural_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    if NEW.organization_id is distinct from OLD.organization_id
       or NEW.auth_user_id is distinct from OLD.auth_user_id
       or NEW.id is distinct from OLD.id then
      raise exception 'No esta permitido modificar la estructura u organizacion de un dispositivo existente';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_protect_device_structural_fields on public.devices;
create trigger trg_protect_device_structural_fields
  before update on public.devices
  for each row execute function public.protect_device_structural_fields();

-- B1: Los dispositivos NO pueden hacer UPDATE directo de su propia fila.
-- Solo pueden actualizar telemetría a través de la RPC update_device_telemetry(),
-- que está definida con security definer y controla exactamente qué campos puede tocar.
-- Se elimina esta política para evitar que un JWT comprometido modifique status, deletion_pending, etc.
-- (política eliminada intencionalmente)

drop policy if exists "devices_admin_insert" on public.devices;
create policy "devices_admin_insert"
  on public.devices for insert
  to authenticated
  with check (public.is_admin() and organization_id = public.current_user_org_id());

drop policy if exists "devices_admin_update" on public.devices;
create policy "devices_admin_update"
  on public.devices for update
  to authenticated
  using (public.is_admin() and organization_id = public.current_user_org_id())
  with check (public.is_admin() and organization_id = public.current_user_org_id());

drop policy if exists "devices_admin_delete" on public.devices;
create policy "devices_admin_delete"
  on public.devices for delete
  to authenticated
  using (public.is_admin() and organization_id = public.current_user_org_id());

drop policy if exists "gps_locations_public_insert" on public.gps_locations;
drop policy if exists "gps_locations_device_insert" on public.gps_locations;
create policy "gps_locations_device_insert"
  on public.gps_locations for insert
  to authenticated
  with check (
    device_id = public.current_device_id()
    and exists (
      select 1 from public.devices registered_device
      where registered_device.id = public.current_device_id()
        and registered_device.status = 'active'
    )
  );

drop policy if exists "gps_locations_authenticated_read" on public.gps_locations;
create policy "gps_locations_authenticated_read"
  on public.gps_locations for select
  to authenticated
  using (
    (public.has_profile() and organization_id = public.current_user_org_id())
    or device_id = public.current_device_id()
  );



-- =====================================================================
-- Trigger de creación de perfil para nuevos registros de Auth (Excluye dispositivos GPS)
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_org_id uuid;
begin
  -- Dispositivos GPS (rol 'device' o email 'device-*@local.rideguard') NO deben recibir perfil de operador viewer
  if coalesce(new.raw_app_meta_data->>'role', '') = 'device' or new.email like 'device-%@local.rideguard' then
    return new;
  end if;

  -- C6 SEGURIDAD: NO auto-asignar la primera organización a usuarios nuevos.
  -- Un usuario que se registra por sí mismo NO debe poder leer flota ajena.
  -- La asignación de organización debe hacerse SOLO por invitación de un admin.
  -- Los admins otorgan acceso mediante un INSERT directo en profiles con el org_id correcto.
  --
  -- Si esta lógica se comenta, cualquier persona puede registrarse y ver toda la flota
  -- de la primera organización creada (IDOR total).
  --
  -- Para entornos de desarrollo de instancia única donde el comportamiento anterior
  -- es intencional, descomentar el bloque siguiente:
  --
  -- select id into target_org_id from public.organizations order by created_at limit 1;
  -- if target_org_id is null then
  --   insert into public.organizations (name) values ('Organización Principal') returning id into target_org_id;
  -- end if;
  -- insert into public.profiles (user_id, organization_id, full_name, role)
  -- values (new.id, target_org_id, coalesce(split_part(new.email, '@', 1), 'Usuario'), 'viewer')
  -- on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- Eliminación de vehículo en cascada (Desvincula dispositivo y revoque de acceso)
-- =====================================================================
create or replace function public.delete_vehicle_cascade(
  p_vehicle_id text
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
  if not public.is_admin() then
    return jsonb_build_object('success', false, 'error', 'Acceso denegado: Requiere rol de administrador');
  end if;

  v_org_id := public.current_user_org_id();
  if current_role = 'service_role' then
    select organization_id into v_org_id from public.vehicles where id = p_vehicle_id;
  end if;

  if v_org_id is null then
    return jsonb_build_object('success', false, 'error', 'Acceso denegado: Organización no encontrada');
  end if;

  select device_id into v_device_id
  from public.vehicles
  where id = p_vehicle_id and organization_id = v_org_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Vehículo no encontrado o sin permisos');
  end if;

  if v_device_id is not null then
    select auth_user_id into v_auth_user_id from public.devices where id = v_device_id;

    update public.devices
    set status = 'inactive', auth_user_id = null, updated_at = now()
    where id = v_device_id;

    update public.device_registry
    set vehicle_id = null, status = 'inactive', last_seen = now()
    where device_id = v_device_id;

  end if;

  delete from public.vehicles
  where id = p_vehicle_id and organization_id = v_org_id;

  return jsonb_build_object('success', true, 'device_id', v_device_id, 'auth_user_id', v_auth_user_id);
end;
$$;

revoke execute on function public.delete_vehicle_cascade(text) from public, anon;
grant execute on function public.delete_vehicle_cascade(text) to authenticated;

-- =====================================================================
-- Migración de Backfill AL FINAL (después de crear todas las tablas, columnas e índices) (Punto 1)
-- =====================================================================
-- Backfill de organization_id en filas heredadas
-- ---------------------------------------------------------------------
-- Solo tiene sentido al adoptar un esquema previo que carecía de
-- organization_id. En una base nueva no hay nada que rellenar.
--
-- public.profiles queda EXCLUIDO a propósito: un perfil sin organización debe
-- seguir sin organización. Asignarle la primera org convertiría C6 (nadie ve la
-- flota ajena) en un IDOR, porque el archivo es idempotente y se puede volver a
-- aplicar: cada re-ejecución devolvería al primer org todo perfil huérfano.
-- El alta de un operador es siempre manual y explícita.
-- =====================================================================
do $$
declare
  default_org_id uuid;
  legacy_rows bigint;
begin
  -- Limpieza de perfiles residuales pertenecientes a cuentas de dispositivo
  delete from public.profiles
  where user_id in (
    select id from auth.users
    where coalesce(raw_app_meta_data->>'role', '') = 'device'
       or email like 'device-%@local.rideguard'
  );

  select count(*) into legacy_rows from (
    select 1 from public.vehicles where organization_id is null
    union all select 1 from public.devices  where organization_id is null
    union all select 1 from public.geofences where organization_id is null
    union all select 1 from public.alerts   where organization_id is null
    union all select 1 from public.gps_locations where organization_id is null
  ) pending;

  if legacy_rows = 0 then
    raise notice 'Sin filas heredadas sin organization_id: no se crea ni reasigna ninguna organización.';
    return;
  end if;

  select id into default_org_id from public.organizations order by created_at limit 1;
  if default_org_id is null then
    insert into public.organizations (name) values ('Organización Principal') returning id into default_org_id;
    raise notice 'Backfill: % filas heredadas asignadas a la organización %', legacy_rows, default_org_id;
  else
    raise notice 'Backfill: % filas heredadas asignadas a la organización existente %', legacy_rows, default_org_id;
  end if;

  update public.vehicles      set organization_id = default_org_id where organization_id is null;
  update public.devices       set organization_id = default_org_id where organization_id is null;
  update public.geofences     set organization_id = default_org_id where organization_id is null;
  update public.alerts        set organization_id = default_org_id where organization_id is null;
  update public.gps_locations set organization_id = default_org_id where organization_id is null;
end $$;

-- =====================================================================
-- B4/B12: Reconciliación de eliminaciones pendientes
-- Cierra el gap donde deletion_pending = true queda sin finalizar si
-- falla algún paso de la eliminación distribuida en delete-device-user.
-- La función usa vehicle_id del registro (no auth_user_id) para que
-- funcione incluso después de que Auth fue eliminado exitosamente.
-- =====================================================================
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
    -- C3: device_registry tiene vehicle_id; devices NO.
    select d.id as device_id, dr.vehicle_id, d.auth_user_id, d.organization_id
    from public.devices d
    left join public.device_registry dr on dr.device_id = d.id
    where d.deletion_pending = true
    order by d.updated_at asc
    limit 50  -- Procesar máximo 50 por llamada para evitar timeouts
  loop
    begin
      -- Caso 1: auth_user_id ya es NULL (Auth fue eliminado, faltó la RPC SQL).
      -- Ejecutar delete_vehicle_cascade si hay vehicle_id pendiente.
      if rec.vehicle_id is not null then
        select public.delete_vehicle_cascade(rec.vehicle_id) into rpc_result;
        if rpc_result->>'success' = 'true' or
           (rpc_result->>'error' is not null and rpc_result->>'error' like '%no encontrado%') then
          -- A10: Limpiar deletion_pending explícitamente para evitar reproceso infinito.
          update public.devices set deletion_pending = false where id = rec.device_id;
          reconciled := reconciled + 1;
        end if;
      else
        -- No hay vehículo asociado: solo eliminar el registro del dispositivo.
        delete from public.devices where id = rec.device_id;
        reconciled := reconciled + 1;
      end if;

    exception when others then
      -- Registrar pero continuar con el siguiente registro.
      raise warning 'reconcile_pending_deletions: error procesando device_id=% vehicle_id=%: %',
        rec.device_id, rec.vehicle_id, sqlerrm;
    end;
  end loop;

  return reconciled;
end;
$$;

revoke execute on function public.reconcile_pending_deletions() from public, anon, authenticated;
grant execute on function public.reconcile_pending_deletions() to service_role;

-- B5: Programar reconciliación en un bloque DO para que un error de pg_cron
-- no aborte el script completo de configuración.
do $$
begin
  create extension if not exists pg_cron;

  -- Upsert del cron: eliminar antes de recrear (idempotente).
  begin
    perform cron.unschedule('reconcile-pending-deletions');
  exception when others then
    null; -- El schedule no existía todavía, ignorar.
  end;

  perform cron.schedule(
    'reconcile-pending-deletions',
    '*/15 * * * *',
    $cmd$select public.reconcile_pending_deletions()$cmd$
  );

  -- Retention policy: delete gps_locations older than 90 days (runs daily at midnight)
  begin
    perform cron.unschedule('purge-old-gps-locations');
  exception when others then
    null;
  end;

  perform cron.schedule(
    'purge-old-gps-locations',
    '0 0 * * *',
    $cmd$delete from public.gps_locations where timestamp < now() - interval '90 days'$cmd$
  );
exception when others then
  raise notice 'pg_cron no disponible o no instalado: %. La reconciliación y limpieza deben invocarse manualmente.', sqlerrm;
end $$;

-- Para invocar manualmente desde service_role:
-- SELECT public.reconcile_pending_deletions();

-- =====================================================================
-- Grants explícitos de tabla
-- =====================================================================
-- En Supabase la plataforma instala default privileges para el rol postgres que
-- conceden acceso a anon/authenticated/service_role sobre el schema public. Eso
-- hace que la migración funcione sin tocar los grants, pero deja el esquema
-- dependiente de esa configuración externa: en cualquier otro Postgres (local,
-- self-hosted, o un proyecto donde el default privilege no exista) TODAS las
-- policies quedan invalidadas por "permission denied for table", porque la RLS
-- nunca llega a evaluarse.
--
-- Declararlos aquí hace la migración autocontenida y verificable. Es aditivo: en
-- Supabase solo re-confirma lo que ya estaba concedido. La RLS sigue siendo la
-- que autoriza; estos grants únicamente hacen la tabla alcanzable.
--
-- anon NO recibe nada: el panel y el dispositivo se autentican antes de leer.
do $$
begin
  -- Objetos de solo lectura o con escritura acotada por policy.
  grant usage on schema public to authenticated, service_role;

  grant select, insert, update, delete on
    public.organizations,
    public.profiles,
    public.devices,
    public.vehicles,
    public.alerts,
    public.geofences,
    public.gps_locations,
    public.device_registry
  to authenticated;

  -- service_role bypasa RLS: necesita acceso completo para Edge Functions,
  -- jobs de pg_cron y la reconciliación de borrados.
  grant all on
    public.organizations,
    public.profiles,
    public.devices,
    public.vehicles,
    public.alerts,
    public.geofences,
    public.gps_locations,
    public.device_registry
  to service_role;

  -- Tablas de infraestructura: nunca accesibles desde el cliente.
  revoke all on public.orphan_auth_users, public.provision_rate_limits from anon, authenticated;
end $$;


