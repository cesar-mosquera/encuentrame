// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const MIGRATION_PATH = path.resolve(
  __dirname,
  '../../../supabase/migrations/20260928231939_initial_schema.sql'
);
const sqlContent = fs.readFileSync(MIGRATION_PATH, 'utf-8');

describe('Multitenancy: organization_id', () => {
  it('incluye organization_id en gps_locations', () => {
    expect(sqlContent).toContain(
      'alter table public.gps_locations add column if not exists organization_id uuid'
    );
  });

  it('define un índice compuesto en gps_locations para consultas multitenant', () => {
    expect(sqlContent).toContain(
      'create index if not exists gps_locations_org_device_ts_idx'
    );
  });

  it('no auto-asigna la primera organización a usuarios nuevos (anti-IDOR, C6)', () => {
    expect(sqlContent).toContain(
      'create or replace function public.handle_new_user()'
    );
    // El bloque que asigna org automáticamente debe permanecer COMMENTED OUT.
    // Solo puede estar dentro de un comentario, nunca como código ejecutable.
    const fn = sqlContent.slice(
      sqlContent.indexOf('create or replace function public.handle_new_user()')
    );
    const body = fn.slice(0, fn.indexOf('$$;', 60));
    const code = body
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    expect(code).not.toContain('insert into public.organizations');
    expect(code).not.toContain('insert into public.profiles');
  });

  it('excluye del perfil a los dispositivos aprovisionados por la Edge Function', () => {
    expect(sqlContent).toContain(
      "new.email like 'device-%@local.rideguard'"
    );
  });

  it('current_user_org_id se define antes de las policies que dependen de ella', () => {
    const fnIdx = sqlContent.indexOf(
      'create or replace function public.current_user_org_id()'
    );
    expect(fnIdx).toBeGreaterThan(-1);
    for (const policy of [
      'create policy "organizations_member_read"',
      'create policy "devices_authenticated_read"',
      'create policy "vehicles_select"',
      'create policy "alerts_select"',
    ]) {
      const pIdx = sqlContent.indexOf(policy);
      expect(pIdx, `${policy} no encontrada`).toBeGreaterThan(-1);
      expect(pIdx, `${policy} se declara antes de current_user_org_id()`).toBeGreaterThan(
        fnIdx
      );
    }
  });
});

describe('RLS: organizations deja de ser deny-all', () => {
  it('tiene una policy de lectura para miembros', () => {
    expect(sqlContent).toContain(
      'create policy "organizations_member_read"'
    );
    expect(sqlContent).toMatch(
      /create policy "organizations_member_read"[\s\S]{0,200}using \(id = public\.current_user_org_id\(\)\)/
    );
  });

  it('no expone organizaciones a perfiles de dispositivo', () => {
    // La policy es `to authenticated` y exige current_user_org_id(), que devuelve
    // NULL para un JWT de dispositivo (app_metadata.device_id, sin profile).
    expect(sqlContent).toMatch(
      /create policy "organizations_member_read"[\s\S]{0,80}to authenticated/
    );
  });
});

describe('RLS: vista latest_gps_locations', () => {
  it('usa security_invoker = true para que la RLS de la tabla base aplique', () => {
    expect(sqlContent).toContain(
      'create or replace view public.latest_gps_locations'
    );
    expect(sqlContent).toContain('with (security_invoker = true)');
  });
});

describe('Integridad: status con CHECK en vez de validación en RPC', () => {
  it('devices.status tiene CHECK', () => {
    expect(sqlContent).toContain(
      'add constraint devices_status_check check (status in'
    );
  });

  it('device_registry.status tiene CHECK', () => {
    expect(sqlContent).toContain(
      'add constraint device_registry_status_check check (status in'
    );
  });

  it('vehicles.status tiene CHECK con el vocabulario completo que consume el front', () => {
    expect(sqlContent).toContain('add constraint vehicles_status_check');
    for (const s of ['active', 'online', 'offline', 'stopped', 'immobilized']) {
      expect(sqlContent).toMatch(
        new RegExp(`vehicles_status_check[\\s\\S]{0,200}'${s}'`)
      );
    }
  });
});

describe('Integridad: FKs de negocio', () => {
  it('gps_locations.device_id referencia devices con ON DELETE CASCADE', () => {
    expect(sqlContent).toContain(
      'add constraint gps_locations_device_id_fkey foreign key (device_id) references public.devices(id) on delete cascade'
    );
  });

  it('devices.auth_user_id queda en SET NULL, no CASCADE', () => {
    expect(sqlContent).toMatch(
      /foreign key \(auth_user_id\) references auth\.users\(id\) on delete set null/
    );
  });
});

describe('RLS: protección de campos estructurales', () => {
  it('protect_vehicle_structural_fields bloquea device_id y organization_id', () => {
    expect(sqlContent).toContain(
      'create or replace function public.protect_vehicle_structural_fields()'
    );
    expect(sqlContent).toContain(
      "raise exception 'No esta permitido modificar el device_id de un vehiculo existente'"
    );
    expect(sqlContent).toContain('before update on public.vehicles');
  });

  it('protect_device_structural_fields bloquea auth_user_id y organization_id', () => {
    expect(sqlContent).toContain(
      'create or replace function public.protect_device_structural_fields()'
    );
    expect(sqlContent).toContain(
      'NEW.auth_user_id is distinct from OLD.auth_user_id'
    );
    expect(sqlContent).toContain('before update on public.devices');
  });

  it('los dispositivos no tienen UPDATE directo: deben usar update_device_telemetry', () => {
    // B1: la policy devices_device_update fue eliminada intencionalmente.
    expect(sqlContent).not.toContain('create policy "devices_device_update"');
    expect(sqlContent).toContain(
      'create or replace function public.update_device_telemetry'
    );
  });

  it('device_registry solo es escribible por administradores', () => {
    expect(sqlContent).toContain('create policy "device_registry_admin_write"');
    expect(sqlContent).toContain('public.is_admin()');
  });
});

describe('RLS: aislamiento de dispositivos y prevención de recursión', () => {
  it('gps_locations_device_insert exige dispositivo activo del propio JWT', () => {
    expect(sqlContent).toContain('create policy "gps_locations_device_insert"');
    expect(sqlContent).toContain('public.current_device_id()');
  });

  it('set_gps_location_org_id sobreescribe organization_id y exige registro', () => {
    expect(sqlContent).toContain(
      'create or replace function public.set_gps_location_org_id()'
    );
    expect(sqlContent).toContain('select organization_id into target_org_id');
    expect(sqlContent).toContain('new.organization_id := target_org_id;');
    expect(sqlContent).toContain(
      "raise exception 'El dispositivo % no esta registrado o asignado a una organizacion'"
    );
  });

  it('set_device_insert_org_id impide insertar con organización arbitraria', () => {
    expect(sqlContent).toContain(
      'create or replace function public.set_device_insert_org_id()'
    );
    expect(sqlContent).toContain('create trigger trg_set_device_insert_org_id');
    expect(sqlContent).toContain('before insert on public.devices');
  });

  it('la policy de lectura de gps_locations no consulta public.devices (evita recursión RLS)', () => {
    expect(sqlContent).toContain(
      'create policy "gps_locations_authenticated_read"'
    );
    expect(sqlContent).not.toContain('select 1 from public.devices d');
  });
});

describe('Retención y mantenimiento', () => {
  it('programa la purga de gps_locations con una ventana de 90 días', () => {
    expect(sqlContent).toContain("cron.schedule(");
    expect(sqlContent).toContain("'purge-old-gps-locations'");
    expect(sqlContent).toContain(
      "delete from public.gps_locations where timestamp < now() - interval '90 days'"
    );
  });

  it('programa la reconciliación de borrados pendientes cada 15 minutos', () => {
    expect(sqlContent).toContain("'reconcile-pending-deletions'");
    expect(sqlContent).toContain('*/15 * * * *');
  });

  it('tolera que pg_cron no esté disponible sin abortar la migración', () => {
    expect(sqlContent).toContain('pg_cron no disponible o no instalado');
  });
});

describe('Grants: la migracion no depende de la plataforma', () => {
  it('declara los grants de tabla explicitamente', () => {
    // Sin esto, en cualquier Postgres que no tenga los default privileges de
    // Supabase, TODAS las policies quedan invalidadas por "permission denied".
    expect(sqlContent).toContain('grant usage on schema public to authenticated, service_role;');
    expect(sqlContent).toContain('to authenticated;');
    expect(sqlContent).toContain('grant all on');
    expect(sqlContent).toContain('to service_role;');
  });

  it('no concede nada a anon y revoca las tablas de infraestructura', () => {
    expect(sqlContent).toContain(
      'revoke all on public.orphan_auth_users, public.provision_rate_limits from anon, authenticated;'
    );
    expect(sqlContent).not.toMatch(/grant[^;]*\bto anon\b/);
  });
});

describe('Regresión: el backfill no reintroduce el IDOR de C6', () => {
  it('excluye public.profiles del backfill de organization_id', () => {
    const block = sqlContent.slice(
      sqlContent.indexOf('Backfill de organization_id en filas heredadas')
    );
    const end = block.indexOf('end $$;');
    const body = block.slice(0, end);
    // El perfil sin org debe seguir sin org: reasignarlo a la primera org
    // convertiria "nadie ve la flota ajena" en un IDOR.
    expect(body).not.toContain('update public.profiles set organization_id');
  });

  it('no crea una organizacion espuria en una base nueva', () => {
    expect(sqlContent).toContain('if legacy_rows = 0 then');
    expect(sqlContent).toContain('return;');
  });
});

describe('Regresión: código muerto retirado del esquema', () => {
  it('no existe la tabla device_activation_codes', () => {
    expect(sqlContent).not.toContain('device_activation_codes');
  });

  it('no existe la función provision_device_atomic', () => {
    expect(sqlContent).not.toContain('provision_device_atomic');
  });

  it('no existe la RPC update_vehicle_status (la cubre el CHECK de vehicles)', () => {
    expect(sqlContent).not.toContain('update_vehicle_status');
  });

  it('no existen tablas ni funciones de la functionality de comandos de vehículo', () => {
    for (const dead of [
      'public.vehicle_commands',
      'ack_vehicle_command',
      'admin_cancel_vehicle_command',
      'clean_stale_vehicle_commands',
      'sync_vehicle_status_on_command_done',
      'set_vehicle_command_org_id',
    ]) {
      expect(sqlContent, `${dead} sigue presente`).not.toContain(dead);
    }
  });

  it('device_registry sí se conserva: es el puente device_id -> vehicle_id', () => {
    expect(sqlContent).toContain('create table if not exists public.device_registry');
    expect(sqlContent).toContain('vehicle_id text');
  });
});
