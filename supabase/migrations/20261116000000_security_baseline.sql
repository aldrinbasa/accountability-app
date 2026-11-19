-- Security baseline (Story 1.1, AD-16). Runs before any table exists.
--
-- After this migration nothing new is reachable by default: every later table, view and
-- function must GRANT exactly what it needs in its own migration.

-- 1. Unexposed schema for helpers. Not in [api].schemas, so PostgREST never serves it.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- 2. Default privileges for objects that the migration role (postgres) creates from now on.
--
-- Postgres grants EXECUTE on new functions to PUBLIC as a built-in, database-wide default.
-- A per-schema "revoke" cannot remove a database-wide default (per-schema default privileges
-- only add to it), so the database-wide revoke comes first. The per-schema statements then
-- strip what Supabase grants to anon/authenticated in public by default.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema public revoke all on tables from anon, authenticated;
-- Supabase also grants anon/authenticated default privileges on sequences in public.
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- 3. Shared updated_at trigger function. Group-scoped tables attach it as
--    `before update ... for each row execute function private.set_updated_at()`.
--    Trigger functions are not checked for EXECUTE when they fire, so no grant is needed.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;
