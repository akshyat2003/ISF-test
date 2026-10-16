-- 0005_lockdown_data_api: close the Supabase Data API (PostgREST) to our tables.
-- Supabase exposes the `public` schema over HTTP to holders of the public anon key and to signed-in users
-- (`anon` / `authenticated` roles). This platform never uses that path: all access goes through our API, which
-- connects to Postgres directly and enforces authorisation itself (ADR-001). So:
--   1. Row-level security is enabled on every table with NO policies → the Data API sees nothing.
--   2. The anon/authenticated roles lose all privileges on our tables, sequences and functions, now and for objects
--      created later. (Skipped where those roles do not exist: local Postgres, CI.)
-- The API's own role owns the tables, so RLS does not restrict it. Every future table must also enable RLS;
-- test/schema.test.ts fails the build if one does not.

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
      execute format('alter default privileges in schema public revoke all on functions from %I', r);
    end if;
  end loop;
end $$;
