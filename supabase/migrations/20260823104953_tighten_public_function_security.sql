-- Tighten function security after listings migration advisor review.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- PostgreSQL grants EXECUTE on functions to PUBLIC by default.
-- Revoke from PUBLIC as well as Supabase runtime roles so these helpers
-- cannot be called through the exposed API.
revoke execute on function public.set_updated_at() from public, anon, authenticated;

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'rls_auto_enable'
      and pg_get_function_identity_arguments(p.oid) = ''
  ) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
