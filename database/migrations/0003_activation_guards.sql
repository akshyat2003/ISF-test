-- 0003_activation_guards: database-level backstops for account activation (security fix, 15 Oct 2026).
-- The API already refuses non-active accounts before loading roles; these triggers make the same rules hold
-- for any write path, including future modules and direct SQL.

-- DC-02 strengthened: the decision maker must hold an active management grant AND have an active account.
create or replace function enforce_decider_is_management() returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from role_grants g join user_accounts u on u.id = g.user_id
    where g.user_id = new.decided_by and g.role = 'management' and g.revoked_at is null and u.status = 'active'
  ) then
    raise exception 'decided_by % is not an active account with an active management grant', new.decided_by
      using errcode = 'P0001', hint = 'DC-02';
  end if;
  return new;
end $$;

-- Release is a privileged act too: released_by must be an active management account.
create function enforce_releaser_is_management() returns trigger language plpgsql as $$
begin
  if new.released_by is not null and new.released_by is distinct from old.released_by and not exists (
    select 1 from role_grants g join user_accounts u on u.id = g.user_id
    where g.user_id = new.released_by and g.role = 'management' and g.revoked_at is null and u.status = 'active'
  ) then
    raise exception 'released_by % is not an active account with an active management grant', new.released_by
      using errcode = 'P0001', hint = 'DC-02';
  end if;
  return new;
end $$;
create trigger selection_releaser_is_management
  before update of released_by on selection_decisions
  for each row execute function enforce_releaser_is_management();

-- No new role grants or edition access for deactivated accounts. Pending accounts may hold pre-assigned grants
-- (e.g. from imports); those stay inert until activation because the API never loads them for non-active accounts.
create function forbid_grants_to_deactivated() returns trigger language plpgsql as $$
begin
  if exists (select 1 from user_accounts where id = new.user_id and status = 'deactivated') then
    raise exception 'cannot grant access to deactivated account %', new.user_id using errcode = 'P0001', hint = 'ACCOUNT-STATUS';
  end if;
  return new;
end $$;
create trigger role_grants_not_deactivated before insert on role_grants
  for each row execute function forbid_grants_to_deactivated();
create trigger edition_access_not_deactivated before insert on edition_access
  for each row execute function forbid_grants_to_deactivated();
