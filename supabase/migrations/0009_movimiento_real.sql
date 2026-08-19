-- =============================================================
-- MonitoreoConductores - Movimiento real confirmado por el dispositivo
-- Ejecutar en Supabase: SQL Editor (o con `supabase db push`)
-- IDEMPOTENTE: se puede ejecutar varias veces sin errores.
--
-- PROBLEMA REAL DETECTADO (regresión de v1.9.1): la "zona de parado" de
-- 80 m bloqueaba también el movimiento real lento y corto. Un conductor
-- que caminó ~20 m y volvió quedaba "Detenido" y sin trayectoria, porque
-- posicionalmente una ida y vuelta corta es idéntica al drift del GPS.
--
-- report_location v6 corrige la regla usando la velocidad del dispositivo
-- (el proveedor fused reporta ~1.3 m/s caminando, >5 m/s en auto):
--   1) speed >= 1 m/s -> MOVIMIENTO CONFIRMADO: se inserta el punto
--      aunque el avance sea corto o quede dentro de la zona de 80 m
--      (caminata de 20 m). Solo lo bloquea un salto imposible (>40 m/s).
--   2) speed < 1 m/s -> parado confirmado: cualquier "avance" es drift
--      del GPS -> jitter (no inserta, no suma km).
--   3) speed NULL (celulares sin sensor) -> conservador: dentro de la
--      zona de 80 m no se inserta; recién al salir se asume movimiento.
--   is_moving ahora usa umbral >= 1 m/s (antes > 2): caminar muestra
--   "En movimiento".
-- =============================================================

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

  -- El dispositivo dice que NO se mueve (velocidad < 1 m/s): cualquier
  -- "avance" de la coordenada es drift del GPS parado. Mantener online,
  -- NO insertar punto ni sumar km: la ubicación no debe cambiar.
  if p_speed is not null and p_speed < 1 then
    update public.driver_status
    set speed = 0, is_moving = false, has_fix = true, updated_at = now()
    where driver_id = v_driver_id;
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

  -- MOVIMIENTO CONFIRMADO por el dispositivo (speed >= 1 m/s): el avance
  -- es real aunque sea corto (caminata de 20 m) o quede dentro de la zona
  -- de parado. NO aplican la zona de 80 m ni el radio de error del GPS:
  -- el sensor del dispositivo ya confirmó que hay movimiento. Solo lo
  -- bloquea un salto imposible (distancia / tiempo > 40 m/s).
  if p_speed is not null and p_speed >= 1 then
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

      insert into public.driver_status (driver_id, lat, lng, speed, is_moving, has_fix, distance_m, updated_at)
      values (
        v_driver_id, p_lat, p_lng,
        coalesce(p_speed, 0),
        coalesce(p_speed, 0) >= 1,
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
      insert into public.driver_status (driver_id, lat, lng, speed, is_moving, has_fix, distance_m, updated_at)
      values (v_driver_id, p_lat, p_lng, 0, false, true, 0, now())
      on conflict (driver_id) do update set
        speed      = 0,
        is_moving  = false,
        has_fix    = true,
        updated_at = now();
    end if;

    return v_driver_id;
  end if;

  -- SIN velocidad del dispositivo (celulares viejos, GPS de baja calidad):
  -- posicionalmente un avance corto es indistinguible del drift, así que
  -- se es conservador: dentro de la zona de 80 m NO se inserta; recién al
  -- salir de la zona se asume movimiento real (un auto sale en segundos).
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
      -- (el GPS "camina" 25-100 m sin moverse de verdad).
      if p_update and p_accuracy is not null and v_dist < p_accuracy then
        update public.driver_status
        set speed = 0, is_moving = false, has_fix = true, updated_at = now()
        where driver_id = v_driver_id;
        return v_driver_id;
      end if;
      -- Dentro de la zona parada (80 m del último punto real): sin
      -- velocidad del dispositivo no se puede distinguir caminata de
      -- drift -> no insertar. Un auto real sale de la zona en segundos.
      if p_update and v_dist < 80 then
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
    -- 0 en el primer punto de la historia). is_moving con umbral >= 1 m/s:
    -- una caminata (implied ~1.3) ya muestra "En movimiento".
    insert into public.driver_status (driver_id, lat, lng, speed, is_moving, has_fix, distance_m, updated_at)
    values (
      v_driver_id, p_lat, p_lng,
      coalesce(p_speed, 0),
      coalesce(p_speed, v_implied, 0) >= 1,
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