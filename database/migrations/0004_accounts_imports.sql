-- 0004_accounts_imports: Phase 3 — bulk import, secure activation, account administration (FR-IMP-*, FR-IAM-05/08/09/10).

-- An import targets one edition: imported participants get that edition's access (FR-IAM-12/13).
alter table import_batches add column edition_id smallint references event_editions(id);
update import_batches set edition_id = 2026 where edition_id is null;
alter table import_batches alter column edition_id set not null;
alter table import_batches add column summary jsonb not null default '{}'::jsonb;

-- Non-blocking findings shown to the Admin, e.g. a mobile number shared with another account (FR-IMP-10).
alter table import_rows add column warnings jsonb not null default '[]'::jsonb;
-- What committing a valid row will do / did: create a new account or link an existing one (FR-IMP-05).
alter table import_rows add column action text check (action in ('create', 'link'));

-- When an account first became active; lets reactivation restore the right state.
alter table user_accounts add column activated_at timestamptz;
update user_accounts set activated_at = created_at where status = 'active' and activated_at is null;
create function stamp_activated_at() returns trigger language plpgsql as $$
begin
  if new.status = 'active' and new.activated_at is null then new.activated_at := now(); end if;
  return new;
end $$;
create trigger user_accounts_activated_at before insert or update of status on user_accounts
  for each row execute function stamp_activated_at();

-- Single-use, time-limited activation (FR-IAM-08/10). Only a SHA-256 of the secret is stored; the plaintext is shown
-- once to the issuing Admin for delivery. The delivery channel (email, SMS or both) is TBD-13.
create table activation_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references user_accounts(id),
  token_sha256  text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  issued_by     uuid not null references user_accounts(id),
  issued_at     timestamptz not null default now(),
  expires_at    timestamptz not null,
  used_at       timestamptz,
  revoked_at    timestamptz,
  constraint expires_after_issue check (expires_at > issued_at),
  constraint used_or_revoked check (used_at is null or revoked_at is null)
);
-- At most one outstanding token per account: issuing a new one revokes the old one.
create unique index activation_one_outstanding on activation_tokens (user_id) where used_at is null and revoked_at is null;

-- A used or revoked token can never be brought back (single use).
create function forbid_token_reuse() returns trigger language plpgsql as $$
begin
  if old.used_at is not null or old.revoked_at is not null then
    raise exception 'activation token % is already used or revoked', old.id using errcode = 'P0001', hint = 'ACTIVATION-SINGLE-USE';
  end if;
  if new.user_id <> old.user_id or new.token_sha256 <> old.token_sha256 or new.expires_at <> old.expires_at then
    raise exception 'activation token % cannot be altered', old.id using errcode = 'P0001', hint = 'ACTIVATION-SINGLE-USE';
  end if;
  return new;
end $$;
create trigger activation_tokens_single_use before update on activation_tokens
  for each row execute function forbid_token_reuse();

-- Predefined startups come only from imports; at most one predefined startup per normalised name (FR-IMP-03/08).
create unique index startups_predefined_name_unique on startups (name_normalized) where origin = 'predefined';
