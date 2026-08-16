-- =============================================================
-- MonitoreoConductores - Schema inicial
-- Ejecutar en Supabase: SQL Editor (o con `supabase db push`)
-- IDEMPOTENTE: se puede ejecutar varias veces sin errores.
-- =============================================================

-- -------------------------------
-- Tablas
-- -------------------------------

-- Conductores / usuarios
create table if not exists public.drivers (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  name         text not null,
  phone        text not null,
  color        text not null default '#3b82f6',
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Historial de posiciones (permite dibujar trayectorias despues)
create table if not exists public.locations (
  id         bigint generated always as identity primary key,
  driver_id  uuid not null references public.drivers(id) on delete cascade,
  lat        double precision not null,
  lng        double precision not null,
  accuracy   double precision,
  speed      double precision,
  heading    double precision,
  created_at timestamptz not null default now()
);

create index if not exists idx_locations_driver_time
  on public.locations (driver_id, created_at desc);

-- Ultima posicion conocida (para el mapa en tiempo real)
create table if not exists public.driver_status (
  driver_id  uuid primary key references public.drivers(id) on delete cascade,
  lat        double precision not null,
  lng        double precision not null,
  speed      double precision not null default 0,
  is_moving  boolean not null default false,
  updated_at timestamptz not null default now()
);

-- -------------------------------
-- Helpers
-- -------------------------------

-- ¿El usuario logueado es admin?
create or replace function public.is_admin()
returns boolean
language sql stable security definer
as $$
  select exists (
    select 1 from public.drivers
    where auth_user_id = auth.uid() and is_admin
  );
$$;

-- Reportar una posicion (lo llama la app del conductor).
-- Inserta el historial y actualiza la ultima posicion de forma atomica.
create or replace function public.report_location(
  p_lat      double precision,
  p_lng      double precision,
  p_accuracy double precision default null,
  p_speed    double precision default null,
  p_heading  double precision default null
)
returns uuid
language plpgsql security definer
as $$
declare
  v_driver_id uuid;
begin
  select d.id into v_driver_id
  from public.drivers d
  where d.auth_user_id = auth.uid();

  if v_driver_id is null then
    raise exception 'conductor no registrado';
  end if;

  insert into public.locations (driver_id, lat, lng, accuracy, speed, heading)
  values (v_driver_id, p_lat, p_lng, p_accuracy, p_speed, p_heading);

  insert into public.driver_status (driver_id, lat, lng, speed, is_moving, updated_at)
  values (v_driver_id, p_lat, p_lng, p_speed, coalesce(p_speed, 0) > 2, now())
  on conflict (driver_id) do update set
    lat        = excluded.lat,
    lng        = excluded.lng,
    speed      = excluded.speed,
    is_moving  = excluded.is_moving,
    updated_at = now();

  return v_driver_id;
end;
$$;

-- Recuperar la sesion de un conductor ya registrado (reinstala la app o expiro la sesion).
-- Solo se permite si el telefono coincide con el registrado.
create or replace function public.reclaim_driver(p_id uuid, p_phone text)
returns void
language plpgsql security definer
as $$
declare
  v_id uuid;
begin
  select d.id into v_id
  from public.drivers d
  where d.id = p_id and d.phone = p_phone;

  if v_id is null then
    raise exception 'no autorizado';
  end if;

  update public.drivers
  set auth_user_id = auth.uid()
  where id = v_id;
end;
$$;

-- El primer usuario registrado se convierte automaticamente en admin
-- (las cuentas anonimas de la app del conductor NO se promueven)
create or replace function public.handle_new_driver()
returns trigger
language plpgsql security definer
as $$
declare
  v_is_anon boolean := coalesce(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'is_anonymous')::boolean,
    false
  );
begin
  if not exists (select 1 from public.drivers) and not v_is_anon then
    new.is_admin := true;
  end if;
  return new;
end;
$$;

drop trigger if exists on_driver_registered on public.drivers;
create trigger on_driver_registered
  before insert on public.drivers
  for each row execute function public.handle_new_driver();

-- -------------------------------
-- Row Level Security
-- -------------------------------

alter table public.drivers       enable row level security;
alter table public.locations     enable row level security;
alter table public.driver_status enable row level security;

-- drivers
drop policy if exists "drivers: leer propia o admin" on public.drivers;
create policy "drivers: leer propia o admin"
  on public.drivers for select
  using (auth.uid() = auth_user_id or public.is_admin());

drop policy if exists "drivers: insertar propia" on public.drivers;
create policy "drivers: insertar propia"
  on public.drivers for insert
  with check (auth.uid() = auth_user_id);

drop policy if exists "drivers: actualizar propia o admin" on public.drivers;
create policy "drivers: actualizar propia o admin"
  on public.drivers for update
  using (auth.uid() = auth_user_id or public.is_admin());

-- locations
drop policy if exists "locations: insertar propia" on public.locations;
create policy "locations: insertar propia"
  on public.locations for insert
  with check (
    exists (
      select 1 from public.drivers d
      where d.id = locations.driver_id and d.auth_user_id = auth.uid()
    )
  );

drop policy if exists "locations: leer propias o admin" on public.locations;
create policy "locations: leer propias o admin"
  on public.locations for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.drivers d
      where d.id = locations.driver_id and d.auth_user_id = auth.uid()
    )
  );

drop policy if exists "locations: borrar admin" on public.locations;
create policy "locations: borrar admin"
  on public.locations for delete
  using (public.is_admin());

-- driver_status
drop policy if exists "status: insertar propia" on public.driver_status;
create policy "status: insertar propia"
  on public.driver_status for insert
  with check (
    exists (
      select 1 from public.drivers d
      where d.id = driver_status.driver_id and d.auth_user_id = auth.uid()
    )
  );

drop policy if exists "status: actualizar propia" on public.driver_status;
create policy "status: actualizar propia"
  on public.driver_status for update
  using (
    exists (
      select 1 from public.drivers d
      where d.id = driver_status.driver_id and d.auth_user_id = auth.uid()
    )
  );

drop policy if exists "status: leer propias o admin" on public.driver_status;
create policy "status: leer propias o admin"
  on public.driver_status for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.drivers d
      where d.id = driver_status.driver_id and d.auth_user_id = auth.uid()
    )
  );

-- -------------------------------
-- Realtime (para el mapa del admin)
-- -------------------------------

alter publication supabase_realtime add table public.driver_status;
alter publication supabase_realtime add table public.locations;
alter publication supabase_realtime add table public.drivers;

-- -------------------------------
-- Permisos
-- -------------------------------

grant execute on function public.report_location to anon, authenticated;
grant execute on function public.reclaim_driver to anon, authenticated;
grant execute on function public.is_admin to anon, authenticated;
