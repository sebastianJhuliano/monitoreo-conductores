-- Tabla para registrar errores de la app (diagnostico)
create table if not exists public.app_errors (
  id         bigint generated always as identity primary key,
  where_     text not null,
  message    text,
  stack      text,
  created_at timestamptz not null default now()
);

alter table public.app_errors enable row level security;

-- RPC para que la app registre un error (sin privilegios extra)
create or replace function public.report_error(
  p_where   text,
  p_message text default null,
  p_stack   text default null
)
returns void
language sql security definer
as $$
  insert into public.app_errors (where_, message, stack)
  values (p_where, p_message, p_stack);
$$;

grant execute on function public.report_error to anon, authenticated;
