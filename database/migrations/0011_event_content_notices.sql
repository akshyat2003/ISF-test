-- 0011_event_content_notices: Phase 7. Event information (FR-EVT-*), documents, notices and push notifications
-- (FR-NOT-*). Decisions TBD-06 (tentative programme), TBD-24 (who maintains what), TBD-29 (notice channels and
-- authorised groups), TBD-51 (documents), TBD-52 (push) in docs/DECISIONS.md. The tables were created in 0002; this
-- adds drafts, versions, audiences, delivery tracking and the rules that must hold whatever the application code does.

-- Who may see a piece of content: the public, every participant of the edition, or participants in given roles.
create function sj_valid_audience(a text[]) returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(array_length(a, 1), 0) between 1 and 6
     and a <@ array['public', 'participants', 'startup_team_leader', 'startup_team_member', 'jury_member', 'volunteer', 'delegate']
$$;

-- ---------------------------------------------------------------- content items (FR-EVT-01…17)
-- Live columns (title, body, audience, version, published_at) are what users see. Every edit goes to `draft` first;
-- publishing copies the draft into the live columns, raises the version and writes a content_versions row.
alter table content_items add column draft jsonb;                       -- {title, body, audience}, null when nothing pending
alter table content_items add column draft_by uuid references user_accounts(id);
alter table content_items add column draft_at timestamptz;
alter table content_items add column change_summary text check (change_summary is null or length(trim(change_summary)) between 1 and 500);
alter table content_items add column created_by uuid references user_accounts(id);
alter table content_items add column created_at timestamptz not null default now();
alter table content_items add column archived_at timestamptz;
alter table content_items add column archived_by uuid references user_accounts(id);
alter table content_items alter column version set default 0;
alter table content_items add constraint content_audience_valid check (sj_valid_audience(audience));
alter table content_items add constraint content_title_length check (length(trim(title)) between 1 and 200);
alter table content_items add constraint content_body_object check (jsonb_typeof(body) = 'object');
alter table content_items add constraint content_draft_object check (draft is null or jsonb_typeof(draft) = 'object');
-- version 0 = never published; a draft-state item has never been published; an archived item may or may not have been.
alter table content_items add constraint content_published_fields check (
  (published_at is null) = (version = 0) and (state <> 'draft' or version = 0) and (state <> 'published' or version >= 1));
alter table content_items add constraint content_archived_fields check ((state = 'archived') = (archived_at is not null and archived_by is not null));
create index content_items_edition on content_items (edition_id, type, state);

create table content_versions (
  item_id         uuid not null references content_items(id),
  version         integer not null check (version >= 1),
  title           text not null,
  body            jsonb not null,
  audience        text[] not null,
  change_summary  text,
  published_by    uuid references user_accounts(id),
  published_at    timestamptz not null default now(),
  primary key (item_id, version)
);

create function content_item_rules() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'content is archived, never deleted' using errcode = 'P0001', hint = 'CONTENT-HISTORY';
  end if;
  if new.edition_id <> old.edition_id or new.type <> old.type then
    raise exception 'a content item keeps its edition and type' using errcode = 'P0001', hint = 'CONTENT-HISTORY';
  end if;
  if old.state = 'archived' then
    raise exception 'archived content cannot change' using errcode = 'P0001', hint = 'CONTENT-HISTORY';
  end if;
  -- The live version changes only by a publish: version + 1 with a matching content_versions row written after.
  if (new.title, new.body, new.audience) is distinct from (old.title, old.body, old.audience)
     or new.version <> old.version or new.published_at is distinct from old.published_at then
    if new.state = 'archived' or new.version <> old.version + 1 or new.published_at is null
       or new.published_at is not distinct from old.published_at then
      raise exception 'live content changes only by publishing a new version' using errcode = 'P0001', hint = 'CONTENT-PUBLISH';
    end if;
  end if;
  return new;
end $$;
create trigger content_items_rules before update or delete on content_items
  for each row execute function content_item_rules();

create function forbid_change() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'P0001', hint = 'APPEND-ONLY';
end $$;
create trigger content_versions_append_only before update or delete on content_versions
  for each row execute function forbid_change();

-- A schedule item's or meal's day must fall within the edition's event days (FR-EVT-03, AT-37).
create function content_day_rules() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare d date; e event_editions%rowtype;
begin
  if new.type in ('schedule_item', 'meal') and new.state <> 'archived' then
    select * into e from event_editions where id = new.edition_id;
    foreach d in array array[(new.body->>'day')::date, (new.draft->'body'->>'day')::date] loop
      if d is not null and e.pre_event_on is not null and e.event_ends_on is not null
         and (d < coalesce(e.pre_event_on, e.event_starts_on) or d > e.event_ends_on) then
        raise exception 'day % is outside the event days of edition %', d, new.edition_id using errcode = 'P0001', hint = 'EVENT-DAY';
      end if;
    end loop;
  end if;
  return new;
end $$;
create trigger content_items_day before insert or update on content_items
  for each row execute function content_day_rules();

-- ---------------------------------------------------------------- documents (FR-EVT-14, -17; TBD-24, TBD-51)
-- A document is immutable once uploaded: a new file is a new row that replaces the old one (history kept).
alter table documents add column description text check (description is null or length(description) <= 500);
alter table documents add column file_name text;
alter table documents add column content_type text;
alter table documents add column size_bytes integer;
alter table documents add column sha256 text;
alter table documents add column replaces_id uuid references documents(id);
alter table documents add column archived_at timestamptz;
alter table documents add column archived_by uuid references user_accounts(id);
update documents set file_name = 'file', content_type = 'application/pdf', size_bytes = 0, sha256 = '' where file_name is null;
alter table documents alter column file_name set not null;
alter table documents alter column content_type set not null;
alter table documents alter column size_bytes set not null;
alter table documents alter column sha256 set not null;
alter table documents add constraint document_audience_valid check (sj_valid_audience(audience));
alter table documents add constraint document_title_length check (length(trim(title)) between 1 and 200);
alter table documents add constraint document_type_allowed check (content_type in ('application/pdf', 'image/png', 'image/jpeg'));
alter table documents add constraint document_size check (size_bytes between 0 and 10485760);
alter table documents add constraint document_archived_fields check ((archived_at is null) = (archived_by is null));
create unique index documents_storage_key on documents (storage_key);
create unique index documents_one_successor on documents (replaces_id) where replaces_id is not null;

create function document_rules() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'documents are archived, never deleted' using errcode = 'P0001', hint = 'CONTENT-HISTORY';
  end if;
  if old.archived_at is not null
     or (new.title, new.description, new.storage_key, new.audience, new.edition_id, new.file_name, new.content_type,
         new.size_bytes, new.sha256, new.version, new.replaces_id, new.uploaded_by, new.uploaded_at)
        is distinct from
        (old.title, old.description, old.storage_key, old.audience, old.edition_id, old.file_name, old.content_type,
         old.size_bytes, old.sha256, old.version, old.replaces_id, old.uploaded_by, old.uploaded_at) then
    raise exception 'a document is never edited; upload a replacement' using errcode = 'P0001', hint = 'CONTENT-HISTORY';
  end if;
  return new;
end $$;
create trigger documents_rules before update or delete on documents
  for each row execute function document_rules();

-- File bytes for the development storage adapter only (STORAGE_PROVIDER=database, refused in production).
create table document_blobs (
  storage_key  text primary key,
  bytes        bytea not null,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------- authorised groups (FR-NOT-08; TBD-29)
create table notice_groups (
  id           uuid primary key default gen_random_uuid(),
  edition_id   smallint not null references event_editions(id),
  name         text not null check (length(trim(name)) between 1 and 100),
  description  text check (description is null or length(description) <= 300),
  created_by   uuid not null references user_accounts(id),
  created_at   timestamptz not null default now(),
  archived_at  timestamptz
);
create unique index notice_groups_name on notice_groups (edition_id, lower(name)) where archived_at is null;
create table notice_group_members (
  group_id  uuid not null references notice_groups(id),
  user_id   uuid not null references user_accounts(id),
  added_by  uuid not null references user_accounts(id),
  added_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);
-- A member must take part in the group's edition (edition access, not deactivated): FR-NOT-05.
create function notice_group_member_rules() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from notice_groups g join edition_access a on a.edition_id = g.edition_id and a.user_id = new.user_id and a.revoked_at is null
    join user_accounts u on u.id = new.user_id and u.status <> 'deactivated'
    where g.id = new.group_id and g.archived_at is null) then
    raise exception 'user % does not take part in this group''s edition', new.user_id using errcode = 'P0001', hint = 'GROUP-MEMBER';
  end if;
  return new;
end $$;
create trigger notice_group_members_rules before insert on notice_group_members
  for each row execute function notice_group_member_rules();

-- ---------------------------------------------------------------- notices (FR-NOT-01, -02, -05, -06)
-- audience: {"kind":"everyone"} | {"kind":"roles","roles":[...]} | {"kind":"group","groupId":"..."}.
alter table notices add column recipients integer not null default 0;
alter table notices add column edited_at timestamptz;
alter table notices add column edited_by uuid references user_accounts(id);
alter table notices add column withdrawn_by uuid references user_accounts(id);
alter table notices add column withdraw_reason text check (withdraw_reason is null or length(trim(withdraw_reason)) between 1 and 500);
alter table notices add constraint notice_title_length check (length(trim(title)) between 1 and 200);
alter table notices add constraint notice_body_length check (length(trim(body)) between 1 and 4000);
create function sj_valid_notice_audience(a jsonb) returns boolean language sql immutable set search_path = public, pg_temp as $$
  select case a->>'kind'
    when 'everyone' then true
    when 'roles' then jsonb_typeof(a->'roles') = 'array' and jsonb_array_length(a->'roles') between 1 and 5
      and array(select jsonb_array_elements_text(a->'roles'))
          <@ array['startup_team_leader', 'startup_team_member', 'jury_member', 'volunteer', 'delegate']
    when 'group' then (a->>'groupId') ~ '^[0-9a-f-]{36}$'
    else false end
$$;
alter table notices add constraint notice_audience_shape check (sj_valid_notice_audience(audience));
alter table notices add constraint notice_withdrawn_fields check (
  (withdrawn_at is null) = (withdrawn_by is null) and (withdrawn_at is null) = (withdraw_reason is null));
alter table notices add constraint notice_edited_fields check ((edited_at is null) = (edited_by is null));
create index notices_edition on notices (edition_id, published_at desc);

-- The audience, edition and push choice are fixed at publishing (recipients were resolved then). Text may be corrected
-- (audited); a withdrawn notice is final. Notices are never deleted.
create function notice_rules() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'notices are withdrawn, never deleted' using errcode = 'P0001', hint = 'NOTICE-HISTORY';
  end if;
  if old.withdrawn_at is not null then
    raise exception 'a withdrawn notice cannot change' using errcode = 'P0001', hint = 'NOTICE-HISTORY';
  end if;
  if new.audience <> old.audience or new.edition_id <> old.edition_id or new.send_push <> old.send_push
     or new.published_by <> old.published_by or new.published_at <> old.published_at then
    raise exception 'a notice keeps its audience, edition and channels; withdraw it and publish a new one' using errcode = 'P0001', hint = 'NOTICE-HISTORY';
  end if;
  return new;
end $$;
create trigger notices_rules before update or delete on notices
  for each row execute function notice_rules();

-- ---------------------------------------------------------------- push (FR-NOT-02, -04; TBD-52)
alter table push_tokens add column disabled_at timestamptz;
alter table push_tokens add column disabled_reason text;
alter table push_tokens add column last_seen_at timestamptz not null default now();
alter table push_tokens add constraint push_token_format check (token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$');
-- A device token belongs to one account at a time (the last one signed in on that device).
create unique index push_tokens_token on push_tokens (token);

-- Notices land in the in-app inbox (linked rows: current text, hidden when withdrawn) and, when chosen, as one push
-- message per registered device. 'cancelled' = a queued message that was withdrawn before it went out.
alter table notifications add column notice_id uuid references notices(id);
alter table notifications add column provider_ref text;
alter table notifications add column receipt_checked_at timestamptz;
alter table notifications drop constraint notifications_status_check;
alter table notifications add constraint notifications_status_check check (status in ('queued', 'sent', 'failed', 'read', 'cancelled'));
alter table notifications drop constraint outbox_recipient;
alter table notifications add constraint outbox_recipient check (channel not in ('email', 'sms', 'push') or recipient is not null);
create index notifications_push_outbox on notifications (next_attempt_at) where status = 'queued' and channel = 'push';
create index notifications_push_receipts on notifications (sent_at) where channel = 'push' and status = 'sent' and receipt_checked_at is null;
create index notifications_notice on notifications (notice_id) where notice_id is not null;

-- New tables stay closed to the Supabase Data API, like every other table (0005).
alter table content_versions enable row level security;
alter table document_blobs enable row level security;
alter table notice_groups enable row level security;
alter table notice_group_members enable row level security;

-- ---------------------------------------------------------------- TBD-06: the tentative 2026 programme from RQ §2
-- Seeded as DRAFTS (nobody sees them until Management publishes). Only what RQ §2 states: no invented times or venues.
insert into content_items (edition_id, type, audience, title, body, draft, version, state)
select 2026, 'schedule_item', '{public}', t.title, t.body, jsonb_build_object('title', t.title, 'body', t.body, 'audience', '["public"]'::jsonb), 0, 'draft'
from (values
  ('Pre-event domain-wise startup activities', '{"day":"2026-12-17","startTime":"13:30","endTime":"17:30","details":"With food arrangements.","tentative":true,"order":1}'::jsonb),
  ('Registration and breakfast', '{"day":"2026-12-18","tentative":true,"order":1}'::jsonb),
  ('Exhibition inauguration', '{"day":"2026-12-18","tentative":true,"order":2}'::jsonb),
  ('Inauguration ceremony and awards', '{"day":"2026-12-18","tentative":true,"order":3}'::jsonb),
  ('Roundtables', '{"day":"2026-12-18","tentative":true,"order":4}'::jsonb),
  ('Startup pitches', '{"day":"2026-12-18","tentative":true,"order":5}'::jsonb),
  ('Cultural programme', '{"day":"2026-12-18","tentative":true,"order":6}'::jsonb),
  ('Networking dinner', '{"day":"2026-12-18","tentative":true,"order":7}'::jsonb),
  ('Forest trekking at Dandakaranya Forest, GIET University', '{"day":"2026-12-19","tentative":true,"order":1}'::jsonb),
  ('Breakfast', '{"day":"2026-12-20","tentative":true,"order":1}'::jsonb),
  ('Roundtable discussion on strengthening the rural and tribal startup ecosystem', '{"day":"2026-12-20","tentative":true,"order":2}'::jsonb),
  ('Early lunch before delegates depart', '{"day":"2026-12-20","tentative":true,"order":3}'::jsonb)
) as t(title, body)
where exists (select 1 from event_editions where id = 2026);
insert into content_items (edition_id, type, audience, title, body, draft, version, state)
select 2026, 'venue', '{public}', 'GIET University', '{"address":"Gunupur, Odisha"}'::jsonb,
       jsonb_build_object('title', 'GIET University', 'body', '{"address":"Gunupur, Odisha"}'::jsonb, 'audience', '["public"]'::jsonb), 0, 'draft'
where exists (select 1 from event_editions where id = 2026);
