-- 0006_function_search_path: pin search_path on every trigger function (Supabase advisor 0011,
-- "function_search_path_mutable"). With a fixed search_path, an object planted in another schema can never be
-- resolved in place of our tables. All functions here only touch public tables. Note: the regression tests for
-- 0005 and this migration live in apps/api/test/data-api-lockdown.test.ts.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('alter function %s set search_path = public, pg_temp', f.sig);
  end loop;
end $$;
