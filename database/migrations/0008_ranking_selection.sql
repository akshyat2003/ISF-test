-- 0008_ranking_selection: Phase 5. AI ranking (FR-RNK-*), override reasons (TBD-18), decision corrections and
-- withdrawals (TBD-37), and the email/SMS notification outbox (TBD-13, TBD-14). Decisions: docs/DECISIONS.md.

-- ---------------------------------------------------------------- applicant withdrawal (TBD-37)
alter table applications drop constraint applications_status_check;
alter table applications add constraint applications_status_check check (status in (
  'submitted', 'under_ai_evaluation', 'ranked', 'flagged_manual_review', 'decision_drafted', 'selected', 'not_selected',
  'withdrawn'));
alter table applications add column withdrawn_at timestamptz;
alter table applications add constraint withdrawn_fields check ((status = 'withdrawn') = (withdrawn_at is not null));

-- ---------------------------------------------------------------- criteria sets (FR-RNK-01, -07; TBD-01)
alter table criteria_sets add column created_by uuid references user_accounts(id);
alter table criteria_sets add column note text check (note is null or length(note) <= 500);
alter table criteria_sets add constraint approval_fields check ((approved_by is null) = (approved_at is null));

-- An approved criteria set is frozen (AT-12: earlier runs keep their version). Approval needs an active Management
-- account. A set that a run has used can never be deleted.
create function criteria_set_rules() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if old.approved_at is not null or exists (select 1 from ranking_runs where criteria_set_id = old.id) then
      raise exception 'criteria set % is approved or used and cannot be deleted', old.id using errcode = 'P0001', hint = 'CRITERIA-APPROVED';
    end if;
    return old;
  end if;
  if old.approved_at is not null then
    raise exception 'approved criteria set % cannot be changed; create a new version', old.id using errcode = 'P0001', hint = 'CRITERIA-APPROVED';
  end if;
  if new.approved_by is not null and not exists (
    select 1 from role_grants g join user_accounts u on u.id = g.user_id
    where g.user_id = new.approved_by and g.role = 'management' and g.revoked_at is null and u.status = 'active'
  ) then
    raise exception 'approved_by % is not an active account with an active management grant', new.approved_by
      using errcode = 'P0001', hint = 'DC-02';
  end if;
  return new;
end $$;
create trigger criteria_sets_rules before update or delete on criteria_sets
  for each row execute function criteria_set_rules();

-- Draft criteria set v1 (TBD-01): the five example criteria of RQ §7, equal weights, integer 1–5 with one line of
-- guidance per score. NOT approved: ranking cannot run until a Management user approves a set.
insert into criteria_sets (edition_id, version, criteria, note)
select e.id, 1, $criteria$
[
  {"key": "innovation", "label": "Innovation", "description": "How new or better is the solution compared with current alternatives?", "weight": 20, "min": 1, "max": 5,
   "guidance": ["No clear difference from existing alternatives.", "A minor improvement on existing alternatives.", "A clear improvement for a defined group of users.", "A substantially new approach with evident advantages.", "A novel approach with a strong, well-explained advantage."]},
  {"key": "feasibility", "label": "Feasibility", "description": "Can this team deliver the solution with its current stage, skills and resources?", "weight": 20, "min": 1, "max": 5,
   "guidance": ["An idea only, with no evidence the team can build it.", "An early concept with major gaps not addressed.", "A working prototype or a realistic plan for the next steps.", "A pilot or early users, with evidence of delivery.", "Proven delivery with paying or sustained users."]},
  {"key": "scalability", "label": "Scalability", "description": "Can the startup grow beyond its first market?", "weight": 20, "min": 1, "max": 5,
   "guidance": ["No path to growth beyond the first users.", "Growth depends on conditions that are not addressed.", "A plausible growth path with some evidence.", "A clear growth path with evidence that it can be repeated.", "Strong evidence of repeatable growth across markets."]},
  {"key": "market_relevance", "label": "Market relevance", "description": "Is there a real need among clearly identified customers?", "weight": 20, "min": 1, "max": 5,
   "guidance": ["Customers or need not identified.", "A need is asserted without evidence.", "Identified customers and a credible need.", "Evidence of demand from identified customers.", "Strong, quantified demand from a clear customer group."]},
  {"key": "impact", "label": "Impact", "description": "What economic, social or environmental impact can be expected?", "weight": 20, "min": 1, "max": 5,
   "guidance": ["No impact described.", "Impact described only in general terms.", "A specific impact on a defined group.", "A significant, measurable impact on a defined group.", "A large, measurable impact supported by evidence."]}
]
$criteria$::jsonb, 'Draft v1 (TBD-01): RQ §7 example criteria, equal weights. Awaiting Management approval.'
from event_editions e where e.id in (2026, 2027);

-- ---------------------------------------------------------------- ranking runs and results (FR-RNK-03, -07, -11, -13)
alter table ranking_runs add column cut_line integer check (cut_line is null or cut_line > 0);
alter table ranking_runs add column error text check (error is null or length(error) <= 1000);
alter table ranking_runs add column claimed_at timestamptz;
-- Creation order. With one active run per edition, the latest run is the one with the highest sequence (clock-independent).
alter table ranking_runs add column seq bigint generated always as identity;
-- One active run per edition: a run ranks the whole cohort, so concurrent runs would only race (FR-RNK-08).
create unique index ranking_one_active_run on ranking_runs (edition_id) where status in ('queued', 'running');

-- A run may only use an APPROVED criteria set of its own edition (FR-RNK-01, TBD-01).
create function ranking_run_needs_approved_criteria() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from criteria_sets c where c.id = new.criteria_set_id and c.edition_id = new.edition_id and c.approved_at is not null) then
    raise exception 'ranking runs need an approved criteria set of edition %', new.edition_id using errcode = 'P0001', hint = 'CRITERIA-NOT-APPROVED';
  end if;
  return new;
end $$;
create trigger ranking_runs_approved_criteria before insert on ranking_runs
  for each row execute function ranking_run_needs_approved_criteria();

alter table ranking_results add column state text not null default 'pending' check (state in ('pending', 'scored', 'flagged'));
alter table ranking_results add column total_score numeric(5, 2) check (total_score is null or total_score between 0 and 100);
alter table ranking_results add column input_sha256 text check (input_sha256 is null or input_sha256 ~ '^[0-9a-f]{64}$');
alter table ranking_results add column attempts integer not null default 0;
-- Flagged applications are never ranked (FR-RNK-13); scored ones carry a total.
alter table ranking_results add constraint result_state_fields check (
  (state = 'scored' and total_score is not null) or (state = 'flagged' and rank is null and total_score is null)
  or (state = 'pending' and rank is null and total_score is null));

-- ---------------------------------------------------------------- decisions: override context, corrections (TBD-18, TBD-37)
alter table selection_decisions add column cut_line_at_decision integer;
alter table selection_decisions add column corrected_at timestamptz;

create table decision_corrections (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references applications(id),
  from_outcome    text not null check (from_outcome in ('selected', 'not_selected')),
  to_outcome      text not null check (to_outcome in ('selected', 'not_selected')),
  reason          text not null check (length(trim(reason)) between 1 and 2000),
  requested_by    uuid not null references user_accounts(id),
  requested_at    timestamptz not null default now(),
  status          text not null default 'pending' check (status in ('pending', 'applied', 'rejected', 'cancelled')),
  reviewed_by     uuid references user_accounts(id),
  reviewed_at     timestamptz,
  review_note     text check (review_note is null or length(review_note) <= 2000),
  constraint correction_changes_outcome check (from_outcome <> to_outcome),
  -- The two-person rule (TBD-37): whoever applies or rejects a correction is never the person who requested it.
  constraint correction_second_person check (reviewed_by is null or reviewed_by <> requested_by),
  constraint correction_review_fields check ((status = 'pending') = (reviewed_at is null)),
  constraint correction_reviewer_present check (status not in ('applied', 'rejected') or reviewed_by is not null)
);
alter table decision_corrections enable row level security;
create unique index decision_corrections_one_pending on decision_corrections (application_id) where status = 'pending';

create function correction_people_are_management() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare who uuid;
begin
  -- The requester is checked when the request is made; the reviewer when they apply or reject it.
  foreach who in array (case when tg_op = 'INSERT' then array[new.requested_by, new.reviewed_by] else array[new.reviewed_by] end) loop
    if who is not null and not exists (
      select 1 from role_grants g join user_accounts u on u.id = g.user_id
      where g.user_id = who and g.role = 'management' and g.revoked_at is null and u.status = 'active'
    ) then
      raise exception '% is not an active account with an active management grant', who using errcode = 'P0001', hint = 'DC-02';
    end if;
  end loop;
  if tg_op = 'UPDATE' and old.status <> 'pending' then
    raise exception 'correction % is already %', old.id, old.status using errcode = 'P0001', hint = 'TBD-37';
  end if;
  return new;
end $$;
create trigger decision_corrections_people before insert or update on decision_corrections
  for each row execute function correction_people_are_management();
create function forbid_correction_delete() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'decision corrections are kept permanently (TBD-37)' using errcode = 'P0001', hint = 'TBD-37';
end $$;
create trigger decision_corrections_no_delete before delete on decision_corrections
  for each row execute function forbid_correction_delete();

-- A released decision stays immutable, except for the outcome change of an APPLIED two-person correction: the
-- decision row must point at that correction (corrected_at = its review time) and move exactly from → to.
create or replace function forbid_released_decision_change() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.released_at is not null then
    if tg_op = 'UPDATE'
       and new.released_at = old.released_at and new.released_by = old.released_by
       and new.corrected_at is distinct from old.corrected_at
       and exists (select 1 from decision_corrections c
                   where c.application_id = old.application_id and c.status = 'applied' and c.reviewed_at = new.corrected_at
                     and c.from_outcome = old.outcome and c.to_outcome = new.outcome) then
      return new;
    end if;
    raise exception 'released decision for application % cannot be changed (TBD-37)', old.application_id
      using errcode = 'P0001', hint = 'TBD-37';
  end if;
  -- A BEFORE DELETE trigger must return OLD; returning NEW (null) would silently cancel the delete.
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

-- ---------------------------------------------------------------- notification outbox (TBD-13, TBD-14)
alter table notifications add column recipient text;
alter table notifications add column next_attempt_at timestamptz;
alter table notifications add column last_error text check (last_error is null or length(last_error) <= 500);
-- Messages carrying a secret (activation codes) have their body scrubbed once delivered or failed.
alter table notifications add column sensitive boolean not null default false;
-- Variables for fixed message templates (Indian SMS must match a DLT-registered template).
alter table notifications add column payload jsonb not null default '{}'::jsonb;
alter table notifications add constraint outbox_recipient check (channel not in ('email', 'sms') or recipient is not null);
create index notifications_outbox on notifications (next_attempt_at) where status = 'queued' and channel in ('email', 'sms');

-- ---------------------------------------------------------------- ranking service identity (FR-RNK-04, AT-11)
-- The ranking worker runs every database statement as this role (SET LOCAL ROLE). It can read the cohort and the
-- criteria, write ranking results and move applications only between the AI-evaluation states. It has NO privilege
-- on decisions, accounts or contact data, so the AI path cannot select, reject or read personal contacts.
do $$
begin
  -- Roles are cluster-wide: tolerate another database on the same server creating it at the same moment.
  if not exists (select 1 from pg_roles where rolname = 'sj_ranking_worker') then
    begin
      create role sj_ranking_worker nologin;
    exception when duplicate_object or unique_violation then null;
    end;
  end if;
  -- The API's database user switches to this role for ranking work (superusers already can).
  if not pg_has_role(current_user, 'sj_ranking_worker', 'member') then
    execute format('grant sj_ranking_worker to %I', current_user);
  end if;
end $$;

grant usage on schema public to sj_ranking_worker;
grant select on applications, criteria_sets, event_editions, ranking_runs, ranking_results to sj_ranking_worker;
-- Startup profile fields only; the website link is never sent to the model (untrusted, and not needed by the criteria).
grant select (id, name, description, city, state) on startups to sj_ranking_worker;
grant update (status) on applications to sj_ranking_worker;
grant update (status, finished_at, error, claimed_at) on ranking_runs to sj_ranking_worker;
grant update (rank, criterion_scores, explanation, flags, state, total_score, input_sha256, attempts) on ranking_results to sj_ranking_worker;
grant insert on audit_events to sj_ranking_worker;

-- Row-level security is on for every table (0005). These policies apply ONLY to the worker role; the Data API roles
-- (anon, authenticated) still have no privileges and no policies.
create policy ranking_worker_read on applications for select to sj_ranking_worker using (true);
create policy ranking_worker_update on applications for update to sj_ranking_worker using (true) with check (true);
create policy ranking_worker_read on startups for select to sj_ranking_worker using (true);
create policy ranking_worker_read on criteria_sets for select to sj_ranking_worker using (true);
create policy ranking_worker_read on event_editions for select to sj_ranking_worker using (true);
create policy ranking_worker_read on ranking_runs for select to sj_ranking_worker using (true);
create policy ranking_worker_update on ranking_runs for update to sj_ranking_worker using (true) with check (true);
create policy ranking_worker_read on ranking_results for select to sj_ranking_worker using (true);
create policy ranking_worker_update on ranking_results for update to sj_ranking_worker using (true) with check (true);
create policy ranking_worker_audit on audit_events for insert to sj_ranking_worker with check (actor_type = 'service' and actor_user_id is null);

-- The worker may only move an application between the AI-evaluation states, never to or from a decision state.
create function ranking_worker_status_guard() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user = 'sj_ranking_worker' and (
       old.status not in ('submitted', 'under_ai_evaluation', 'ranked', 'flagged_manual_review')
    or new.status not in ('under_ai_evaluation', 'ranked', 'flagged_manual_review')) then
    raise exception 'the ranking service cannot set application status % (FR-RNK-04)', new.status
      using errcode = 'P0001', hint = 'FR-RNK-04';
  end if;
  return new;
end $$;
create trigger applications_ranking_worker_guard before update of status on applications
  for each row execute function ranking_worker_status_guard();
