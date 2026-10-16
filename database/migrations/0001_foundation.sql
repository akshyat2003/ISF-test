-- 0001_foundation: identity, roles, editions, startups, year-wise applications, selection, notifications, audit.
-- PRD references in comments (FR-*, DC-*, TBD-*). Forward-only; never edit after it has run anywhere shared.

-- ---------------------------------------------------------------- editions (2026, 2027)
create table event_editions (
  id                      smallint primary key check (id between 2026 and 2100),   -- the year
  name                    text not null,
  pre_event_on            date,
  event_starts_on         date,
  event_ends_on           date,
  registration_opens_at   timestamptz,            -- null = open
  registration_closes_at  timestamptz,            -- null = no deadline set yet (2027: TBD-05)
  closes_at_confirmed     boolean not null default false,   -- false while TBD-11 is open
  selection_limit         integer check (selection_limit is null or selection_limit > 0),  -- FR-SEL-04
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ---------------------------------------------------------------- people (no passwords anywhere: FR-IAM-08, DC-09)
create table user_accounts (
  id            uuid primary key default gen_random_uuid(),
  auth_subject  text unique,                       -- identity-provider subject; null until first sign-in
  email         text,
  mobile_e164   text check (mobile_e164 is null or mobile_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  full_name     text not null check (length(trim(full_name)) between 1 and 200),
  status        text not null default 'active' check (status in ('pending_activation', 'active', 'deactivated')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index user_accounts_email_unique on user_accounts (lower(email)) where email is not null;
create index user_accounts_mobile on user_accounts (mobile_e164);   -- not unique: shared numbers are flagged (FR-IMP-10)

-- The eight PRD roles (FR-IAM-01). Optional edition scope (FR-IAM-13). Revocable, never deleted.
create table role_grants (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references user_accounts(id),
  role        text not null check (role in ('admin', 'management', 'startup_team_leader', 'startup_team_member',
                                            'jury_member', 'volunteer', 'delegate', 'customer_support')),
  edition_id  smallint references event_editions(id),
  granted_by  uuid references user_accounts(id),
  granted_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  revoked_by  uuid references user_accounts(id)
);
create unique index role_grants_active_unique on role_grants (user_id, role, coalesce(edition_id, 0)) where revoked_at is null;

-- Participation in an edition: gates event features for that year (FR-IAM-12, AT-09).
create table edition_access (
  user_id     uuid not null references user_accounts(id),
  edition_id  smallint not null references event_editions(id),
  source      text not null check (source in ('predefined', 'selected')),
  granted_by  uuid references user_accounts(id),
  granted_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  primary key (user_id, edition_id)
);

-- ---------------------------------------------------------------- startups (FR-IAM-04)
create table startups (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(trim(name)) between 2 and 200),
  name_normalized  text generated always as (lower(regexp_replace(trim(name), '\s+', ' ', 'g'))) stored,
  description      text check (description is null or length(description) <= 5000),
  website          text,
  city             text,
  state            text,
  origin           text not null check (origin in ('predefined', 'applicant')),   -- FR-IMP-08
  created_by       uuid references user_accounts(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index startups_name_normalized on startups (name_normalized);

create table startup_memberships (
  startup_id       uuid not null references startups(id),
  user_id          uuid not null references user_accounts(id),
  position         text not null check (position in ('leader', 'member')),
  team_management  boolean not null default false,     -- FR-IAM-07; scope TBD-17
  created_at       timestamptz not null default now(),
  primary key (startup_id, user_id)
);
create unique index startup_one_leader on startup_memberships (startup_id) where position = 'leader';

-- ---------------------------------------------------------------- year-wise applications (FR-REG-*)
create table applications (
  id                      uuid primary key default gen_random_uuid(),
  startup_id              uuid not null references startups(id),
  edition_id              smallint not null references event_editions(id),
  status                  text not null default 'submitted' check (status in (
                            'submitted', 'under_ai_evaluation', 'ranked', 'flagged_manual_review',
                            'decision_drafted', 'selected', 'not_selected')),
  form_answers            jsonb not null default '{}'::jsonb,   -- configurable fields (TBD-39)
  privacy_notice_version  text not null,
  flags                   text[] not null default '{}',
  submitted_by            uuid not null references user_accounts(id),
  submitted_at            timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint one_application_per_startup_per_edition unique (startup_id, edition_id)      -- DC-01, FR-REG-08
);
create index applications_edition_status on applications (edition_id, status);

-- ---------------------------------------------------------------- selection decisions (FR-SEL-*)
create table selection_decisions (
  application_id          uuid primary key references applications(id),   -- per application: editions independent (DC-03)
  outcome                 text not null check (outcome in ('selected', 'not_selected')),
  status_before_decision  text not null,
  decided_by              uuid not null references user_accounts(id),     -- always a human (DC-02)
  decided_at              timestamptz not null default now(),
  ai_rank_at_decision     integer,
  is_override             boolean,
  reason                  text check (reason is null or length(reason) <= 2000),
  released_at             timestamptz,
  released_by             uuid references user_accounts(id),
  constraint release_fields_together check ((released_at is null) = (released_by is null))
);

-- DC-02: the decision maker must hold an active management grant at the time of writing.
create function enforce_decider_is_management() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from role_grants
                 where user_id = new.decided_by and role = 'management' and revoked_at is null) then
    raise exception 'decided_by % does not hold an active management grant', new.decided_by
      using errcode = 'P0001', hint = 'DC-02';
  end if;
  return new;
end $$;
create trigger selection_decider_is_management
  before insert or update of outcome, decided_by on selection_decisions
  for each row execute function enforce_decider_is_management();

-- FR-SEL-11 / TBD-37: a released decision cannot be changed until a reversal policy exists.
create function forbid_released_decision_change() returns trigger language plpgsql as $$
begin
  if old.released_at is not null then
    raise exception 'released decision for application % cannot be changed (TBD-37)', old.application_id
      using errcode = 'P0001', hint = 'TBD-37';
  end if;
  -- A BEFORE DELETE trigger must return OLD; returning NEW (null) would silently cancel the delete.
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger selection_released_immutable
  before update or delete on selection_decisions
  for each row execute function forbid_released_decision_change();

-- ---------------------------------------------------------------- notifications (in-app outbox; FR-NOT-*)
create table notifications (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references user_accounts(id),
  edition_id       smallint references event_editions(id),
  kind             text not null,
  channel          text not null default 'in_app' check (channel in ('in_app', 'push', 'email', 'sms', 'whatsapp')),
  title            text not null,
  body             text not null,
  status           text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'read')),
  attempts         integer not null default 0,
  idempotency_key  text not null unique,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz,
  read_at          timestamptz
);
create index notifications_user on notifications (user_id, created_at desc);

-- ---------------------------------------------------------------- audit trail (FR-AUD-*, DC-13)
create table audit_events (
  id             bigint generated always as identity primary key,
  at             timestamptz not null default now(),
  actor_type     text not null check (actor_type in ('user', 'service', 'system')),
  actor_user_id  uuid references user_accounts(id),
  action         text not null,
  entity_type    text not null,
  entity_id      text,
  edition_id     smallint references event_editions(id),
  data           jsonb not null default '{}'::jsonb
);
create index audit_events_entity on audit_events (entity_type, entity_id);

create function forbid_audit_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'audit_events is append-only' using errcode = 'P0001', hint = 'DC-13';
end $$;
create trigger audit_events_append_only
  before update or delete on audit_events
  for each row execute function forbid_audit_mutation();

-- ---------------------------------------------------------------- generic updated_at maintenance
create function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger event_editions_touch before update on event_editions for each row execute function touch_updated_at();
create trigger user_accounts_touch before update on user_accounts for each row execute function touch_updated_at();
create trigger startups_touch before update on startups for each row execute function touch_updated_at();
create trigger applications_touch before update on applications for each row execute function touch_updated_at();

-- ---------------------------------------------------------------- reference data (PRD §2)
insert into event_editions (id, name, pre_event_on, event_starts_on, event_ends_on, registration_closes_at, closes_at_confirmed)
values
  -- 5 Nov 2026 is confirmed (RQ §2, §6); the time of day is provisional until TBD-11 is decided.
  (2026, 'Startup Jathara 2026', '2026-12-17', '2026-12-18', '2026-12-20', '2026-11-05 23:59:59+05:30', false),
  -- 2027 dates and deadline are TBD-05; registration stays open.
  (2027, 'Startup Jathara 2027', null, null, null, null, false);
