-- 0012_helpdesk_support: Phase 8. AI Help Desk in the mobile app (FR-HD-*), support tickets (FR-SUP-*) and emergency
-- alerts with acknowledgement tracking and overdue escalation. The tables were created in 0002; this adds the ticket
-- lifecycle rules, alert tracking and the per-edition acknowledgement windows. Decisions: TBD-07, -27, -28 (awaiting
-- organisers) and TBD-54…57 in docs/DECISIONS.md.
-- WhatsApp is out of scope here (another workstream). Nothing in this migration adds or changes WhatsApp components;
-- the existing channel values and phone_identities are left exactly as they are.

-- ---------------------------------------------------------------- per-edition support policy (TBD-27, configurable)
-- Acknowledgement windows and re-alert intervals in minutes. The defaults are the TBD-27 recommendation, awaiting
-- organiser approval; Management can change them per edition without a code change.
create function sj_default_support_policy() returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select '{"emergencyAckMinutes": 5, "highAckMinutes": 30, "normalAckMinutes": 120,
           "emergencyRealertMinutes": 1, "highRealertMinutes": 10, "maxRealerts": 20}'::jsonb
$$;

create function sj_valid_support_policy(p jsonb) returns boolean language sql immutable set search_path = public, pg_temp as $$
  select jsonb_typeof(p) = 'object'
     and (select count(*) from jsonb_object_keys(p)) = 6
     and (select bool_and(jsonb_typeof(p -> k) = 'number' and (p ->> k)::numeric = floor((p ->> k)::numeric)
                          and (p ->> k)::numeric between 1 and 10080)
          from unnest(array['emergencyAckMinutes', 'highAckMinutes', 'normalAckMinutes',
                            'emergencyRealertMinutes', 'highRealertMinutes', 'maxRealerts']) k)
     and (p ->> 'emergencyAckMinutes')::int <= (p ->> 'highAckMinutes')::int
     and (p ->> 'highAckMinutes')::int <= (p ->> 'normalAckMinutes')::int
     and (p ->> 'maxRealerts')::int <= 100
$$;

alter table event_editions add column support_policy jsonb not null default sj_default_support_policy();
alter table event_editions add constraint support_policy_valid check (sj_valid_support_policy(support_policy));

create function sj_is_active_support(p_user uuid) returns boolean
  language sql stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from role_grants g join user_accounts u on u.id = g.user_id
    where g.user_id = p_user and g.role = 'customer_support' and g.revoked_at is null and u.status = 'active')
$$;

-- ---------------------------------------------------------------- Help Desk conversations (FR-HD-01, -16, -18)
alter table helpdesk_conversations add column edition_id smallint references event_editions(id);
alter table helpdesk_conversations add column last_message_at timestamptz not null default now();
-- The app channel always knows the signed-in account (FR-HD-02).
alter table helpdesk_conversations add constraint app_conversation_has_user check (channel <> 'app' or user_id is not null);
create index helpdesk_conversations_user on helpdesk_conversations (user_id, edition_id, channel, last_message_at desc);

-- Each message keeps its handling flags (emergency, fallback, blocked output, tools used and result sizes).
alter table helpdesk_messages add column meta jsonb not null default '{}'::jsonb;
alter table helpdesk_messages add constraint helpdesk_message_length check (length(content) <= 8000);
alter table helpdesk_messages add constraint helpdesk_message_meta check (jsonb_typeof(meta) = 'object');
create index helpdesk_messages_conversation on helpdesk_messages (conversation_id, id);
-- A transcript is never rewritten. Deletion stays possible for the retention purge (TBD-32, Phase 9).
create function forbid_update() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception '% rows are never edited', tg_table_name using errcode = 'P0001', hint = 'APPEND-ONLY';
end $$;
create trigger helpdesk_messages_no_update before update on helpdesk_messages
  for each row execute function forbid_update();

-- ---------------------------------------------------------------- support tickets (FR-SUP-*, DC-08)
alter table support_tickets add column number bigint generated always as identity;
create unique index support_tickets_number on support_tickets (number);
alter table support_tickets add column subject text check (subject is null or length(trim(subject)) between 1 and 200);
alter table support_tickets add column description text check (description is null or length(description) <= 4000);
alter table support_tickets add column source text check (source in ('help_desk', 'emergency_control', 'requester', 'support_staff'));
alter table support_tickets add column created_by uuid references user_accounts(id);
-- A person who calls or walks in without an account (FR-SUP-14): the contact details the requester gave.
alter table support_tickets add column contact_name text check (contact_name is null or length(trim(contact_name)) between 1 and 120);
alter table support_tickets add column contact_phone text check (contact_phone is null or contact_phone ~ '^\+?[0-9 ()-]{3,20}$');
-- Retries of the same report from the app (double tap, flaky network) never create a second ticket.
alter table support_tickets add column client_request_id uuid;
create unique index support_tickets_client_request on support_tickets (requester_id, client_request_id) where client_request_id is not null;
alter table support_tickets add column acknowledged_by uuid references user_accounts(id);
alter table support_tickets add column ack_due_at timestamptz;
alter table support_tickets add column resolved_by uuid references user_accounts(id);
alter table support_tickets add column resolution_note text check (resolution_note is null or length(trim(resolution_note)) between 1 and 4000);
alter table support_tickets add column escalation_level smallint not null default 0 check (escalation_level between 0 and 5);
alter table support_tickets add column alert_round integer not null default 0 check (alert_round >= 0);
alter table support_tickets add column last_alert_at timestamptz;
alter table support_tickets add column overdue_flagged_at timestamptz;
alter table support_tickets add column updated_at timestamptz not null default now();
-- Escalation is an attribute; the four statuses stay (FR-SUP-12). Target: Management (TBD-27; names awaiting organisers).
alter table support_tickets add constraint escalation_target check (escalated_to is null or escalated_to = 'management');
alter table support_tickets add constraint escalation_fields check (
  (escalated_to is null) = (escalated_at is null) and (escalated_to is null) = (escalation_reason is null)
  and (escalated_to is null) = (escalation_level = 0));
alter table support_tickets add constraint escalation_reason_length check (escalation_reason is null or length(trim(escalation_reason)) between 1 and 1000);
-- Every status after Open has been acknowledged; Resolved carries who, when and how.
alter table support_tickets add constraint acknowledged_fields check ((status = 'Open') = (acknowledged_at is null));
alter table support_tickets add constraint resolved_fields check (
  (status = 'Resolved') = (resolved_at is not null) and (status <> 'Resolved' or resolution_note is not null));
-- A ticket made through the app or by support names its requester: an account, or a walk-in's name.
alter table support_tickets add constraint requester_known check (source is null or requester_id is not null or contact_name is not null);
create index support_tickets_queue on support_tickets (status, priority, created_at);
create index support_tickets_due on support_tickets (ack_due_at) where status = 'Open';
create index support_tickets_requester on support_tickets (requester_id, created_at desc);

create function sj_ack_minutes(p_edition smallint, p_priority text, p_emergency boolean) returns integer
  language sql stable set search_path = public, pg_temp as $$
  select (coalesce((select support_policy from event_editions where id = p_edition), sj_default_support_policy())
          ->> case when p_emergency then 'emergencyAckMinutes' when p_priority = 'high' then 'highAckMinutes' else 'normalAckMinutes' end)::int
$$;

-- DC-08 and the lifecycle (TBD-56): Open → Acknowledged → In Progress → Resolved. Acknowledged may go straight to
-- Resolved. Nothing leaves Resolved; follow-up is a new ticket. Requester, edition, source and origin never change;
-- emergency never turns into non-emergency and priority never drops. Only active support staff acknowledge, resolve
-- or are assigned. Tickets are never deleted.
create function support_ticket_rules() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'support tickets are kept, never deleted' using errcode = 'P0001', hint = 'TICKET-HISTORY';
  end if;
  if tg_op = 'INSERT' then
    -- Unknown status values are left to the DC-08 check constraint.
    if new.status in ('Acknowledged', 'In Progress', 'Resolved') then
      raise exception 'a new ticket is Open' using errcode = 'P0001', hint = 'TICKET-LIFECYCLE';
    end if;
    new.ack_due_at := coalesce(new.created_at, now()) + make_interval(mins => sj_ack_minutes(new.edition_id, new.priority, new.is_emergency));
    return new;
  end if;
  if old.status = 'Resolved' then
    raise exception 'a resolved ticket cannot change; open a new ticket instead' using errcode = 'P0001', hint = 'TICKET-LIFECYCLE';
  end if;
  if (new.requester_id, new.edition_id, new.conversation_id, new.created_at, new.number, new.source, new.created_by,
      new.client_request_id, new.contact_name, new.contact_phone, new.subject)
     is distinct from
     (old.requester_id, old.edition_id, old.conversation_id, old.created_at, old.number, old.source, old.created_by,
      old.client_request_id, old.contact_name, old.contact_phone, old.subject) then
    raise exception 'a ticket keeps its requester, edition and origin' using errcode = 'P0001', hint = 'TICKET-HISTORY';
  end if;
  if old.is_emergency and not new.is_emergency then
    raise exception 'an emergency ticket stays an emergency' using errcode = 'P0001', hint = 'TICKET-LIFECYCLE';
  end if;
  if old.priority = 'high' and new.priority = 'normal' then
    raise exception 'ticket priority is never lowered' using errcode = 'P0001', hint = 'TICKET-LIFECYCLE';
  end if;
  if new.status <> old.status and not (
       (old.status = 'Open' and new.status = 'Acknowledged')
    or (old.status = 'Acknowledged' and new.status in ('In Progress', 'Resolved'))
    or (old.status = 'In Progress' and new.status = 'Resolved')) then
    raise exception 'a ticket cannot move from % to %', old.status, new.status using errcode = 'P0001', hint = 'TICKET-LIFECYCLE';
  end if;
  if new.status = 'Acknowledged' and old.status = 'Open'
     and (new.acknowledged_by is null or not sj_is_active_support(new.acknowledged_by)) then
    raise exception 'only active support staff acknowledge tickets' using errcode = 'P0001', hint = 'SUPPORT-STAFF';
  end if;
  if new.acknowledged_by is distinct from old.acknowledged_by and old.status <> 'Open' then
    raise exception 'the acknowledgement is recorded once' using errcode = 'P0001', hint = 'TICKET-HISTORY';
  end if;
  if new.status = 'Resolved' and (new.resolved_by is null or not sj_is_active_support(new.resolved_by)) then
    raise exception 'only active support staff resolve tickets' using errcode = 'P0001', hint = 'SUPPORT-STAFF';
  end if;
  if new.assignee_id is not null and new.assignee_id is distinct from old.assignee_id and not sj_is_active_support(new.assignee_id) then
    raise exception 'tickets are assigned only to active support staff' using errcode = 'P0001', hint = 'SUPPORT-STAFF';
  end if;
  if new.escalation_level < old.escalation_level
     or (old.escalated_to is not null and (new.escalated_to is distinct from old.escalated_to)) then
    raise exception 'an escalation is never withdrawn' using errcode = 'P0001', hint = 'TICKET-HISTORY';
  end if;
  if new.escalated_by is not null and new.escalated_by is distinct from old.escalated_by and not sj_is_active_support(new.escalated_by) then
    raise exception 'only active support staff escalate by hand' using errcode = 'P0001', hint = 'SUPPORT-STAFF';
  end if;
  -- A raised priority while still unacknowledged tightens the acknowledgement window.
  if new.status = 'Open' and (new.priority <> old.priority or new.is_emergency <> old.is_emergency) then
    new.ack_due_at := least(old.ack_due_at, new.created_at + make_interval(mins => sj_ack_minutes(new.edition_id, new.priority, new.is_emergency)));
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger support_tickets_rules before insert or update or delete on support_tickets
  for each row execute function support_ticket_rules();

-- Ticket history is append-only (FR-SUP-05, audit).
alter table ticket_events drop constraint ticket_events_kind_check;
alter table ticket_events add constraint ticket_events_kind_check check (kind in (
  'created', 'status', 'assigned', 'note', 'contact', 'escalated', 'reply', 'requester_note', 'priority'));
alter table ticket_events add constraint ticket_event_detail check (jsonb_typeof(detail) = 'object');
create index ticket_events_ticket on ticket_events (ticket_id, id);
create trigger ticket_events_append_only before update or delete on ticket_events
  for each row execute function forbid_change();

-- ---------------------------------------------------------------- alerts and acknowledgement tracking
-- One row per recipient per alert round. Re-alerts (retries) add rounds; nothing is overwritten. A recipient marking
-- an alert as seen is recorded once; acknowledging the ticket is a separate, accountable action on the ticket.
create table support_alerts (
  id            bigint generated always as identity primary key,
  ticket_id     uuid not null references support_tickets(id),
  recipient_id  uuid not null references user_accounts(id),
  reason        text not null check (reason in ('emergency', 'high_priority', 'reminder', 'escalation', 'overdue',
                                                'no_support_staff', 'reported_again')),
  round         integer not null default 0 check (round >= 0),
  created_at    timestamptz not null default now(),
  seen_at       timestamptz,
  unique (ticket_id, recipient_id, reason, round)
);
create index support_alerts_recipient on support_alerts (recipient_id, created_at desc) where seen_at is null;
alter table support_alerts enable row level security;

create function support_alert_rules() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'alerts are kept' using errcode = 'P0001', hint = 'APPEND-ONLY';
  end if;
  if (new.ticket_id, new.recipient_id, new.reason, new.round, new.created_at) is distinct from
     (old.ticket_id, old.recipient_id, old.reason, old.round, old.created_at)
     or old.seen_at is not null or new.seen_at is null then
    raise exception 'an alert only records when it was first seen' using errcode = 'P0001', hint = 'APPEND-ONLY';
  end if;
  return new;
end $$;
create trigger support_alerts_rules before update or delete on support_alerts
  for each row execute function support_alert_rules();
