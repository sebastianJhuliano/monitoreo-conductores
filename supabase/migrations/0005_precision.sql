-- =============================================================
-- MonitoreoConductores - Precisión de ubicación
-- Ejecutar en Supabase: SQL Editor (o con `supabase db push`)
-- IDEMPOTENTE: se puede ejecutar varias veces sin errores.
--
-- 1) driver_status.has_fix: la app avisa cuando NO tiene GPS
--    (el marcador se queda en la última posición buena).
-- 2) report_location v2: acepta p_has_fix y p_update.
--    - p_has_fix=false  -> solo refresca "última vez visto" (latido).
--    - p_update=false   -> refresca estado sin insertar punto ni mover
--                          el marcador (filtro de jitter < 25 m).
--    - Guarda de saltos: si el punto nuevo está a >1.2 km del último
--      y llegó en <45 s (imposible en ciudad), se descarta.
-- 3) clear_trajectory: el admin borra la trayectoria de un conductor.
-- =============================================================

alter table public.driver_status
  add column if not exists has_fix boolean not null default true;

-- Reportar una posicion (lo llama la app del conductor).
create or replace function public.report_location(
  p_lat      double precision default null,
  p_lng      double precision default null,
  p_accuracy double precision default null,
  p_speed    double precision default null,
  p_heading  double precision default null,
  p_has_fix  boolean default true,
  p_update   boolean default true
)
returns uuid
language plpgsql security definer
as $$
declare
  v_driver_id uuid;
  v_last_lat  double precision;
  v_last_lng  double precision;
  v_last_at   timestamptz;
  v_dist      double precision;
begin
  select d.id into v_driver_id
  from public.drivers d
  where d.auth_user_id = auth.uid();

  if v_driver_id is null then
    raise exception 'conductor no registrado';
  end if;

  -- Sin GPS (precisión mala): refrescar "última vez visto" sin mover el marcador.
  if not p_has_fix then
    insert into public.driver_status (driver_id, lat, lng, speed, is_moving, has_fix, updated_at)
    values (v_driver_id, 0, 0, 0, false, false, now())
    on conflict (driver_id) do update set
      speed      = 0,
      is_moving  = false,
      has_fix    = false,
      updated_at = now();
    return v_driver_id;
  end if;

  -- Guarda contra saltos GPS: si el nuevo punto está a >1.2 km del último
  -- almacenado y llegó en menos de 45 s, es un error de GPS (no un auto real).
  select lat, lng, created_at into v_last_lat, v_last_lng, v_last_at
  from public.locations
  where driver_id = v_driver_id
  order by created_at desc
  limit 1;

  if v_last_lat is not null and p_lat is not null and p_lng is not null then
    v_dist := 6371000 * 2 * asin(sqrt(
      power(sin(radians(p_lat - v_last_lat) / 2), 2) +
      cos(radians(v_last_lat)) * cos(radians(p_lat)) *
        power(sin(radians(p_lng - v_last_lng) / 2), 2)
    ));

    if v_dist > 1200 and (extract(epoch from (now() - v_last_at))) < 45 then
      -- Salto imposible: refrescar online pero no mover nada.
      update public.driver_status
      set speed = 0, is_moving = false, has_fix = true, updated_at = now()
      where driver_id = v_driver_id;
      return v_driver_id;
    end if;
  end if;

  if p_update then
    insert into public.locations (driver_id, lat, lng, accuracy, speed, heading)
    values (v_driver_id, p_lat, p_lng, p_accuracy, p_speed, p_heading);

    insert into public.driver_status (driver_id, lat, lng, speed, is_moving, has_fix, updated_at)
    values (v_driver_id, p_lat, p_lng, coalesce(p_speed, 0), coalesce(p_speed, 0) > 2, true, now())
    on conflict (driver_id) do update set
      lat        = excluded.lat,
      lng        = excluded.lng,
      speed      = excluded.speed,
      is_moving  = excluded.is_moving,
      has_fix    = true,
      updated_at = now();
  else
    -- Movimiento mínimo (jitter): refrescar estado sin insertar ni mover.
    insert into public.driver_status (driver_id, lat, lng, speed, is_moving, has_fix, updated_at)
    values (v_driver_id, p_lat, p_lng, 0, false, true, now())
    on conflict (driver_id) do update set
      speed      = 0,
      is_moving  = false,
      has_fix    = true,
      updated_at = now();
  end if;

  return v_driver_id;
end;
$$;

-- Borrar la trayectoria (historial de puntos) de un conductor. Solo admin.
create or replace function public.clear_trajectory(p_driver_id uuid)
returns void
language plpgsql security definer
as $$
begin
  if not public.is_admin() then
    raise exception 'no autorizado';
  end if;
  delete from public.locations where driver_id = p_driver_id;
end;
$$;

grant execute on function public.report_location to anon, authenticated;
grant execute on function public.clear_trajectory to authenticated;