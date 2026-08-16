-- Eliminar conductores desde el panel (admin)
-- Borra el conductor, su historial (cascade) y su cuenta anonima.

create or replace function public.delete_driver(p_id uuid)
returns void
language plpgsql security definer
as $$
declare
  v_auth uuid;
begin
  if not public.is_admin() then
    raise exception 'no autorizado';
  end if;

  select auth_user_id into v_auth from public.drivers where id = p_id;

  delete from public.drivers where id = p_id;

  if v_auth is not null then
    delete from auth.users where id = v_auth;
  end if;
end;
$$;

grant execute on function public.delete_driver to authenticated;

-- Politica RLS por si se quiere borrar directo por REST
drop policy if exists "drivers: borrar admin" on public.drivers;
create policy "drivers: borrar admin"
  on public.drivers for delete
  using (public.is_admin());