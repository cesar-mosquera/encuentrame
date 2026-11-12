-- Añadir código de activación a organizaciones para el aprovisionamiento multi-tenant
alter table public.organizations add column if not exists activation_code text unique;

-- Para las organizaciones existentes (o la principal que se crea por defecto), 
-- asignamos un uuid por defecto para que no queden nulas, aunque luego se pueda actualizar.
update public.organizations set activation_code = gen_random_uuid()::text where activation_code is null;

alter table public.organizations alter column activation_code set not null;
alter table public.organizations alter column activation_code set default gen_random_uuid()::text;
