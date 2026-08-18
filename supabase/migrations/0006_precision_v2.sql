-- =============================================================
-- MonitoreoConductores - Precisión de ubicación v2
-- Ejecutar en Supabase: SQL Editor (o con `supabase db push`)
-- IDEMPOTENTE: se puede ejecutar varias veces sin errores.
--
-- report_location v3:
--   1) Velocidad reportada por el dispositivo >40 m/s (144 km/h en
--      ciudad) -> no mover el marcador (es un error de GPS).
--   2) Guarda de saltos por VELOCIDAD IMPLÍCITA (distancia / tiempo
--      transcurrido >40 m/s) en vez de la regla fija "1.2 km en <45 s".
--      Si el GPS entrega un punto a 800 m de distancia 10 s después del
--      anterior (80 m/s), se descarta: ningún vehículo real va a esa
--      velocidad. El conductor queda online pero no se mueve.
--   3) is_moving se calcula con la velocidad implícita cuando el GPS
--      no reporta speed (algunos celulares no lo dan).
--   4) Movimiento menor al radio de error del GPS (dist < accuracy):
--      es ruido estando parado (el GPS "camina" 25-100 m) -> no se
--      inserta punto ni se suman km. CRÍTICO para el pago por trayecto.
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

  -- Velocidad reportada por el dispositivo absurda (>40 m/s = 144 km/h en
  -- ciudad): error de GPS, no un auto real. Mantener online sin mover.
  if p_speed is not null and p_speed > 40 then
    update public.driver_status
    set speed = 0, is_moving = false, has_fix = true, updated_at = now()
    where driver_id = v_driver_id;
    return v_driver_id;
  end if;

  -- Guarda de saltos por velocidad implícita: si el punto nuevo está
  -- demasiado lejos del último para el tiempo transcurrido, es un error
  -- de GPS (las antenas/WiFi pueden dar posiciones "fantasma").
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

    insert into public.driver_status (driver_id, lat, lng, speed, is_moving, has_fix, updated_at)
    values (
      v_driver_id, p_lat, p_lng,
      coalesce(p_speed, 0),
      -- is_moving con velocidad real: la implícita cuando el GPS no da speed.
      coalesce(p_speed, v_implied, 0) > 2,
      true, now()
    )
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

grant execute on function public.report_location to anon, authenticated;