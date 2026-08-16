-- Lectura abierta de app_errors para diagnosticar crashes desde afuera.
-- Contiene solo stack traces de errores (sin datos personales).
drop policy if exists "app_errors: lectura abierta" on public.app_errors;
create policy "app_errors: lectura abierta"
  on public.app_errors for select
  using (true);

grant select on public.app_errors to anon;