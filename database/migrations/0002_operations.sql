-- 0002_operations: tables for milestones M2–M7, created now so their integrity rules are enforced and tested early.
-- Columns marked TBD may change through later forward migrations once the PRD decisions are made.

-- ---------------------------------------------------------------- bulk import (FR-IMP-*, M2)
create table import_batches (
  id             uuid primary key default gen_random_uuid(),
  category       text not null check (category in ('startups', 'jury', 'volunteers', 'delegates')),
  file_name      text not null,
  file_sha256    text not null,
  state          text not null default 'previewed' check (state in ('previewed', 'committed', 'discarded')),
  uploaded_by    uuid not null references user_accounts(id),
  uploaded_at    timestamptz not null default now(),
  committed_at   timestamptz,
  row_count      integer not null default 0,
  error_count    integer not null default 0
);
create table import_rows (
  batch_id    uuid not null references import_batches(id),
  row_number  integer not null,
  data        jsonb not null,
  outcome     text not null check (outcome in ('valid', 'invalid', 'duplicate', 'created', 'linked', 'excluded')),
  errors      jsonb not null default '[]'::jsonb,       -- [{field, reason}] (FR-IMP-04)
  user_id     uuid references user_accounts(id),
  primary key (batch_id, row_number)
);

-- WhatsApp identity: a verified number maps to at most one active account (FR-HD-03/04, DC-11).
create table phone_identities (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references user_accounts(id),
  number_e164  text not null check (number_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  verified_at  timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);
create unique index phone_identity_one_active on phone_identities (number_e164)
  where verified_at is not null and revoked_at is null;

-- ---------------------------------------------------------------- AI ranking (FR-RNK-*, M3)
create table criteria_sets (
  id           uuid primary key default gen_random_uuid(),
  edition_id   smallint not null references event_editions(id),
  version      integer not null,
  criteria     jsonb not null,             -- [{key, label, weight, min, max, guidance}] — content TBD-01
  approved_by  uuid references user_accounts(id),
  approved_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (edition_id, version)
);
create table ranking_runs (
  id               uuid primary key default gen_random_uuid(),
  edition_id       smallint not null references event_editions(id),
  criteria_set_id  uuid not null references criteria_sets(id),
  model_ref        text not null,
  prompt_version   text not null,
  status           text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  started_by       uuid not null references user_accounts(id),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz
);
create table ranking_results (
  run_id            uuid not null references ranking_runs(id),
  application_id    uuid not null references applications(id),
  rank              integer,
  criterion_scores  jsonb not null default '{}'::jsonb,
  explanation       text,
  flags             text[] not null default '{}',
  primary key (run_id, application_id)
);

-- ---------------------------------------------------------------- jury (FR-JRY-*, M4)
create table jury_assignments (
  id            uuid primary key default gen_random_uuid(),
  edition_id    smallint not null references event_editions(id),
  jury_user_id  uuid not null references user_accounts(id),
  startup_id    uuid not null references startups(id),
  created_by    uuid not null references user_accounts(id),
  created_at    timestamptz not null default now(),
  unique (edition_id, jury_user_id, startup_id)
);
create table scoring_rubrics (
  id          uuid primary key default gen_random_uuid(),
  edition_id  smallint not null references event_editions(id),
  version     integer not null,
  parameters  jsonb not null,                -- criteria, ranges, weights: TBD-43
  created_by  uuid not null references user_accounts(id),
  created_at  timestamptz not null default now(),
  unique (edition_id, version)
);
create table evaluations (
  id                 uuid primary key default gen_random_uuid(),
  jury_assignment_id uuid not null references jury_assignments(id),
  rubric_id          uuid not null references scoring_rubrics(id),
  state              text not null default 'draft' check (state in ('draft', 'submitted', 'reopened')),
  scores             jsonb not null default '{}'::jsonb,
  comments           text,
  submitted_at       timestamptz,
  reopened_by        uuid references user_accounts(id),
  reopened_at        timestamptz,
  unique (jury_assignment_id)                                                              -- DC-10
);
create table pitch_slots (
  id          uuid primary key default gen_random_uuid(),
  edition_id  smallint not null references event_editions(id),
  startup_id  uuid not null references startups(id),
  starts_at   timestamptz,
  venue       text,
  state       text not null default 'scheduled' check (state in ('scheduled', 'pitching', 'done'))
);
create unique index pitch_one_live_per_edition on pitch_slots (edition_id) where state = 'pitching';   -- TBD-21 operator

-- ---------------------------------------------------------------- volunteers: strict one-to-one (FR-VOL-*, DC-04…07, M4)
create table assignment_runs (
  id                   uuid primary key default gen_random_uuid(),
  edition_id           smallint not null references event_editions(id),
  seed                 text not null,
  volunteer_count      integer not null,
  target_count         integer not null,
  unassigned_targets   jsonb not null default '[]'::jsonb,
  unassigned_volunteers jsonb not null default '[]'::jsonb,
  state                text not null default 'draft' check (state in ('draft', 'approved', 'discarded')),
  started_by           uuid not null references user_accounts(id),
  reviewed_by          uuid references user_accounts(id),
  created_at           timestamptz not null default now(),
  reviewed_at          timestamptz
);
create table volunteer_assignments (
  id                   uuid primary key default gen_random_uuid(),
  edition_id           smallint not null references event_editions(id),
  run_id               uuid references assignment_runs(id),
  volunteer_user_id    uuid not null references user_accounts(id),
  target_startup_id    uuid references startups(id),
  target_jury_user_id  uuid references user_accounts(id),
  state                text not null default 'draft' check (state in ('draft', 'active', 'closed')),
  created_by           uuid not null references user_accounts(id),
  created_at           timestamptz not null default now(),
  closed_at            timestamptz,
  closed_by            uuid references user_accounts(id),
  close_reason         text,
  constraint exactly_one_target check (num_nonnulls(target_startup_id, target_jury_user_id) = 1),   -- DC-04
  constraint volunteer_is_not_target check (target_jury_user_id is distinct from volunteer_user_id),
  constraint closed_fields check ((state = 'closed') = (closed_at is not null))
);
create unique index volunteer_one_open_assignment on volunteer_assignments (edition_id, volunteer_user_id)
  where state <> 'closed';                                                                           -- DC-05
create unique index startup_one_open_volunteer on volunteer_assignments (edition_id, target_startup_id)
  where state <> 'closed' and target_startup_id is not null;                                        -- DC-06
create unique index jury_one_open_volunteer on volunteer_assignments (edition_id, target_jury_user_id)
  where state <> 'closed' and target_jury_user_id is not null;                                      -- DC-06

-- ---------------------------------------------------------------- content and notices (FR-EVT-*, FR-NOT-*, M5)
create table content_items (
  id            uuid primary key default gen_random_uuid(),
  edition_id    smallint not null references event_editions(id),
  type          text not null check (type in ('schedule_item', 'venue', 'meal', 'accommodation', 'travel',
                                               'safety_guideline', 'emergency_contact', 'page')),
  audience      text[] not null default '{public}',
  title         text not null,
  body          jsonb not null default '{}'::jsonb,
  version       integer not null default 1,
  state         text not null default 'draft' check (state in ('draft', 'published', 'archived')),
  updated_by    uuid references user_accounts(id),
  updated_at    timestamptz not null default now(),
  published_at  timestamptz
);
create table documents (
  id           uuid primary key default gen_random_uuid(),
  edition_id   smallint not null references event_editions(id),
  title        text not null,
  storage_key  text not null,
  audience     text[] not null default '{participants}',
  version      integer not null default 1,
  uploaded_by  uuid references user_accounts(id),
  uploaded_at  timestamptz not null default now()
);
create table notices (
  id            uuid primary key default gen_random_uuid(),
  edition_id    smallint not null references event_editions(id),
  audience      jsonb not null,                 -- {roles:[...]} or {groupId}; authorised groups TBD-29
  title         text not null,
  body          text not null,
  send_push     boolean not null default false,
  published_by  uuid not null references user_accounts(id),
  published_at  timestamptz not null default now(),
  withdrawn_at  timestamptz
);
create table push_tokens (
  user_id     uuid not null references user_accounts(id),
  token       text not null,
  platform    text not null check (platform in ('android', 'ios')),
  created_at  timestamptz not null default now(),
  primary key (user_id, token)
);

-- ---------------------------------------------------------------- help desk and support (FR-HD-*, FR-SUP-*, M7)
create table helpdesk_conversations (
  id                uuid primary key default gen_random_uuid(),
  channel           text not null check (channel in ('app', 'whatsapp', 'web')),
  user_id           uuid references user_accounts(id),              -- null for unverified numbers / public visitors
  phone_identity_id uuid references phone_identities(id),
  started_at        timestamptz not null default now()
);
create table helpdesk_messages (
  id               bigint generated always as identity primary key,
  conversation_id  uuid not null references helpdesk_conversations(id),
  role             text not null check (role in ('user', 'assistant', 'tool')),
  content          text not null,
  tool_name        text,
  at               timestamptz not null default now()
);
create table support_tickets (
  id               uuid primary key default gen_random_uuid(),
  edition_id       smallint references event_editions(id),
  requester_id     uuid references user_accounts(id),
  conversation_id  uuid references helpdesk_conversations(id),
  priority         text not null default 'normal' check (priority in ('normal', 'high')),
  is_emergency     boolean not null default false,
  status           text not null default 'Open' check (status in ('Open', 'Acknowledged', 'In Progress', 'Resolved')),  -- DC-08
  assignee_id      uuid references user_accounts(id),
  escalated_to     text,                               -- escalation is an attribute, not a status (FR-SUP-12); targets TBD-27
  escalated_by     uuid references user_accounts(id),
  escalated_at     timestamptz,
  escalation_reason text,
  created_at       timestamptz not null default now(),
  acknowledged_at  timestamptz,
  resolved_at      timestamptz,
  constraint emergency_is_high_priority check (not is_emergency or priority = 'high')
);
create table ticket_events (
  id         bigint generated always as identity primary key,
  ticket_id  uuid not null references support_tickets(id),
  actor_id   uuid references user_accounts(id),
  kind       text not null check (kind in ('created', 'status', 'assigned', 'note', 'contact', 'escalated')),
  detail     jsonb not null default '{}'::jsonb,
  at         timestamptz not null default now()
);
