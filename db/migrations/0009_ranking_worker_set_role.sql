-- 0009_ranking_worker_set_role: the API's database user must be able to SET ROLE sj_ranking_worker (migration 0008).
-- Found on the Supabase staging project (PostgreSQL 17, non-superuser `postgres` with CREATEROLE): creating a role
-- gives its creator a membership WITH ADMIN OPTION but without the SET option (createrole_self_grant is empty), so
-- 0008's "already a member" check skipped the grant and `SET LOCAL ROLE sj_ranking_worker` failed with 42501.
-- Superusers (local development, CI) were never affected. Membership with SET and without INHERIT: the API user can
-- switch to the restricted role for ranking work but never gains its privileges implicitly.
do $$
begin
  if not pg_has_role(current_user, 'sj_ranking_worker', 'SET') then
    execute format('grant sj_ranking_worker to %I with set true, inherit false', current_user);
  end if;
end $$;
