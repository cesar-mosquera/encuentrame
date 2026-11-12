-- El panel muestra devices.label como nombre; el APK envia el modelo real del
-- telefono en la telemetria. Si label queda nulo, el panel caia al id crudo.
-- Ahora el telemetry rellena label con el modelo cuando no hay nombre manual.
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
      label = coalesce(label, p_model),
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
