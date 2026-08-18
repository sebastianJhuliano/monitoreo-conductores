-- =============================================================
-- MonitoreoConductores - Total de km por conductor (SIN LÍMITES)
-- Ejecutar en Supabase: SQL Editor (o con `supabase db push`)
-- IDEMPOTENTE: se puede ejecutar varias veces sin errores.
--
-- El problema: el panel dibuja los últimos N puntos de `locations`
-- (el historial completo crece sin límite: 3 semanas = miles de
-- puntos). El km calculado en el panel solo cubría esa ventana.
--
-- Solución: el SERVIDOR acumula el km total en una columna nueva
-- `driver_status.distance_m`. Cada punto REAL aceptado suma su
-- distancia al total. El panel muestra ese total directo, sin
-- importar cuántos puntos haya (un conductor puede viajar un mes
-- y su km total sigue completo).
--
-- report_location v4 = v3 + acumulación de distance_m.
-- clear_trajectory v2 = v1 + resetea distance_m a 0.
-- =============================================================

alter table public.driver_status
  add column if not exists distance_m double precision not null default 0;

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
  v_dt        double precision;
  v_implied   double precision;
begin
  select d.id into v_driver_id
  from public.drivers d
  where d.auth_user_id = auth.uid();

  if v_driver_id is null then
    raise exception 'conductor no registrado';
  end if;

  -- Sin GPS (precisión mala): refrescar "última vez visto" sin mover el
  -- marcador ni sumar km.
  if not p_has_fix then
    insert into public.driver_status (driver_id, lat, lng, speed, is_moving, has_fix, distance_m, updated_at)
    values (v_driver_id, 0, 0, 0, false, false, 0, now())
    on conflict (driver_id) do update set
      speed      = 0,
      is_moving  = false,
      has_fix    = false,
      updated_at = now();
    return v_driver_id;
  end if;

  -- Velocidad reportada por el dispositivo absurda (>40 m/s = 144 km/h en
  -- ciudad): error de GPS, no un auto real. Mantener online sin mover.
  if p_speed is not null and p_speed > 40 then
    update public.driver_status
    set speed = 0, is_moving = false, has_fix = true, updated_at = now()
    where driver_id = v_driver_id;
    return v_driver_id;
  end if;

  -- Guarda de saltos por velocidad implícita y de ruido estando parado.
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
    v_dt := extract(epoch from (now() - v_last_at));
    if v_dt > 0 then
      v_implied := v_dist / v_dt;
      -- Movimiento menor al radio de error del GPS: ruido estando parado
      -- (el GPS "camina" 25-100 m sin moverse de verdad). No insertar
      -- punto ni sumar km: el pago es por trayecto real.
      if p_update and p_accuracy is not null and v_dist < p_accuracy then
        update public.driver_status
        set speed = 0, is_moving = false, has_fix = true, updated_at = now()
        where driver_id = v_driver_id;
        return v_driver_id;
      end if;
      -- Salto imposible: refrescar online pero no mover nada.
      if v_implied > 40 then
        update public.driver_status
        set speed = 0, is_moving = false, has_fix = true, updated_at = now()
        where driver_id = v_driver_id;
        return v_driver_id;
      end if;
    end if;
  end if;

  if p_update then
    insert into public.locations (driver_id, lat, lng, accuracy, speed, heading)
    values (v_driver_id, p_lat, p_lng, p_accuracy, p_speed, p_heading);

    -- Suma el tramo al total de km del conductor (coalesce(v_dist, 0) =
    -- 0 en el primer punto de la historia).
    insert into public.driver_status (driver_id, lat, lng, speed, is_moving, has_fix, distance_m, updated_at)
    values (
      v_driver_id, p_lat, p_lng,
      coalesce(p_speed, 0),
      coalesce(p_speed, v_implied, 0) > 2,
      true, coalesce(v_dist, 0), now()
    )
    on conflict (driver_id) do update set
      lat        = excluded.lat,
      lng        = excluded.lng,
      speed      = excluded.speed,
      is_moving  = excluded.is_moving,
      has_fix    = true,
      distance_m = public.driver_status.distance_m + excluded.distance_m,
      updated_at = now();
  else
    -- Movimiento mínimo (jitter): refrescar estado sin insertar ni mover.
    insert into public.driver_status (driver_id, lat, lng, speed, is_moving, has_fix, distance_m, updated_at)
    values (v_driver_id, p_lat, p_lng, 0, false, true, 0, now())
    on conflict (driver_id) do update set
      speed      = 0,
      is_moving  = false,
      has_fix    = true,
      updated_at = now();
  end if;

  return v_driver_id;
end;
$$;

grant execute on function public.report_location to anon, authenticated;

-- Borrar la trayectoria: también resetea el total de km del conductor.
create or replace function public.clear_trajectory(p_driver_id uuid)
returns void
language plpgsql security definer
as $$
begin
  if not public.is_admin() then
    raise exception 'no autorizado';
  end if;
  delete from public.locations where driver_id = p_driver_id;
  update public.driver_status set distance_m = 0 where driver_id = p_driver_id;
end;
$$;

grant execute on function public.clear_trajectory to authenticated;