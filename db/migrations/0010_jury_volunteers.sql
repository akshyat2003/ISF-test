-- 0010_jury_volunteers: Phase 6. Jury evaluation (FR-JRY-*, DC-10; TBD-20, -21, -43) and one-to-one volunteer assignment
-- (FR-VOL-*, DC-04…07; TBD-22, -23). The tables were created in 0002; this adds approval, versioning, history and the
-- database rules that must hold whatever the application code does. Decisions: docs/DECISIONS.md.
-- Jury scoring is kept apart from AI ranking and selection: nothing here touches applications, ranking or decisions,
-- and the ranking worker role (0008) has no privilege on any jury table.

-- ---------------------------------------------------------------- who may take part in an edition
-- A startup takes part in an edition when its leader holds (unrevoked) access to that edition: imported startups
-- (predefined access) and selected applicants (access granted on release) alike (TBD-22 target pool).
create function sj_startup_in_edition(p_startup uuid, p_edition smallint) returns boolean
  language sql stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from startup_memberships m
    join edition_access a on a.user_id = m.user_id and a.edition_id = p_edition and a.revoked_at is null
    join user_accounts u on u.id = m.user_id and u.status <> 'deactivated'
    where m.startup_id = p_startup and m.position = 'leader')
$$;

-- A person takes part in an edition in a role when the role grant (global or for that edition) and the edition access
-- are both unrevoked and the account is not deactivated. Pending (not yet activated) imports count: they see their
-- assignment once they activate.
create function sj_person_in_edition(p_user uuid, p_role text, p_edition smallint) returns boolean
  language sql stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from user_accounts u
    join role_grants g on g.user_id = u.id and g.role = p_role and g.revoked_at is null
                       and (g.edition_id is null or g.edition_id = p_edition)
    join edition_access a on a.user_id = u.id and a.edition_id = p_edition and a.revoked_at is null
    where u.id = p_user and u.status <> 'deactivated')
$$;

create function sj_is_active_management(p_user uuid) returns boolean
  language sql stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from role_grants g join user_accounts u on u.id = g.user_id
    where g.user_id = p_user and g.role = 'management' and g.revoked_at is null and u.status = 'active')
$$;

-- ---------------------------------------------------------------- scoring rubrics (FR-JRY-08, -09, -13; TBD-43)
alter table scoring_rubrics alter column created_by drop not null;   -- the seeded draft has no human author
alter table scoring_rubrics add column note text check (note is null or length(note) <= 500);
alter table scoring_rubrics add column comments_allowed boolean not null default true;   -- FR-JRY-06 "where permitted"
alter table scoring_rubrics add column approved_by uuid references user_accounts(id);
alter table scoring_rubrics add column approved_at timestamptz;
alter table scoring_rubrics add constraint rubric_approval_fields check ((approved_by is null) = (approved_at is null));
alter table scoring_rubrics add constraint rubric_parameters_array check (jsonb_typeof(parameters) = 'array');

-- An approved rubric is frozen (evaluations keep the version they used); approval needs an active Management account;
-- a rubric that an evaluation has used is never deleted.
create function rubric_rules() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if old.approved_at is not null or exists (select 1 from evaluations where rubric_id = old.id) then
      raise exception 'rubric % is approved or used and cannot be deleted', old.id using errcode = 'P0001', hint = 'RUBRIC-APPROVED';
    end if;
    return old;
  end if;
  if old.approved_at is not null then
    raise exception 'approved rubric % cannot be changed; create a new version', old.id using errcode = 'P0001', hint = 'RUBRIC-APPROVED';
  end if;
  if new.approved_by is not null and not sj_is_active_management(new.approved_by) then
    raise exception 'approved_by % is not an active account with an active management grant', new.approved_by
      using errcode = 'P0001', hint = 'DC-02';
  end if;
  return new;
end $$;
create trigger scoring_rubrics_rules before update or delete on scoring_rubrics
  for each row execute function rubric_rules();

-- Draft rubric v1 (TBD-43): the five draft criteria (TBD-01) plus pitch delivery, integers 1–10, equal (relative)
-- weights. NOT approved: jurors cannot score until a Management user approves a rubric version.
insert into scoring_rubrics (edition_id, version, parameters, note)
select e.id, 1, $rubric$
[
  {"key": "innovation", "label": "Innovation", "description": "How new or better is the solution compared with current alternatives?", "weight": 1, "min": 1, "max": 10},
  {"key": "feasibility", "label": "Feasibility", "description": "Can this team deliver the solution with its current stage, skills and resources?", "weight": 1, "min": 1, "max": 10},
  {"key": "scalability", "label": "Scalability", "description": "Can the startup grow beyond its first market?", "weight": 1, "min": 1, "max": 10},
  {"key": "market_relevance", "label": "Market relevance", "description": "Is there a real need among clearly identified customers?", "weight": 1, "min": 1, "max": 10},
  {"key": "impact", "label": "Impact", "description": "What economic, social or environmental impact can be expected?", "weight": 1, "min": 1, "max": 10},
  {"key": "pitch_delivery", "label": "Pitch delivery", "description": "How clearly and convincingly did the team present and answer questions?", "weight": 1, "min": 1, "max": 10}
]
$rubric$::jsonb, 'Draft v1 (TBD-43): draft criteria v1 plus pitch delivery, 1–10, equal weights. Awaiting Management approval.'
from event_editions e where e.id in (2026, 2027);

-- ---------------------------------------------------------------- jury assignments (FR-JRY-02, -08; TBD-20)
-- Management assigns explicitly which startups each juror evaluates. Both must take part in the edition.
create function jury_assignment_rules() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if not sj_person_in_edition(new.jury_user_id, 'jury_member', new.edition_id) then
    raise exception 'user % is not a jury member of edition %', new.jury_user_id, new.edition_id using errcode = 'P0001', hint = 'JURY-NOT-ELIGIBLE';
  end if;
  if not sj_startup_in_edition(new.startup_id, new.edition_id) then
    raise exception 'startup % does not take part in edition %', new.startup_id, new.edition_id using errcode = 'P0001', hint = 'STARTUP-NOT-IN-EDITION';
  end if;
  if not sj_is_active_management(new.created_by) then
    raise exception 'created_by % is not an active account with an active management grant', new.created_by using errcode = 'P0001', hint = 'DC-02';
  end if;
  return new;
end $$;
create trigger jury_assignments_rules before insert on jury_assignments
  for each row execute function jury_assignment_rules();
-- Assignments are never edited in place; removing one is only possible while it has no evaluation (FK from evaluations).
create function forbid_jury_assignment_update() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'jury assignments are not edited; remove and add instead' using errcode = 'P0001', hint = 'JURY-ASSIGNMENT-IMMUTABLE';
end $$;
create trigger jury_assignments_immutable before update on jury_assignments
  for each row execute function forbid_jury_assignment_update();

-- ---------------------------------------------------------------- evaluations (FR-JRY-05…07, -12, -13; DC-10)
alter table evaluations add column created_at timestamptz not null default now();
alter table evaluations add column updated_at timestamptz not null default now();
alter table evaluations add column reopen_reason text check (reopen_reason is null or length(trim(reopen_reason)) between 1 and 2000);
-- Weighted total (0–100), computed by the API at submission from the rubric version used. Decision support only.
alter table evaluations add column total_score numeric(5, 2) check (total_score is null or total_score between 0 and 100);
alter table evaluations add constraint evaluation_comment_length check (comments is null or length(comments) <= 2000);
-- A submission always carries its time and total. A reopened evaluation keeps the last submission's values until resubmitted.
alter table evaluations add constraint evaluation_submitted_fields check (state <> 'submitted' or (submitted_at is not null and total_score is not null));
alter table evaluations add constraint evaluation_reopen_fields check (
  (reopened_at is null) = (reopened_by is null) and (reopened_at is null) = (reopen_reason is null));

-- DC-10: one evaluation per assignment (unique since 0002). A submitted evaluation is locked: the only change allowed
-- is an audited reopen by an active Management account with a reason. The rubric must be an approved version of the
-- assignment's edition. Evaluations are never deleted.
create function evaluation_rules() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'evaluations are kept permanently' using errcode = 'P0001', hint = 'DC-10';
  end if;
  if not exists (select 1 from scoring_rubrics r join jury_assignments j on j.id = new.jury_assignment_id
                 where r.id = new.rubric_id and r.edition_id = j.edition_id and r.approved_at is not null) then
    raise exception 'evaluations need an approved rubric of the assignment''s edition' using errcode = 'P0001', hint = 'RUBRIC-NOT-APPROVED';
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'draft' and new.state <> 'submitted' then
      raise exception 'a new evaluation is a draft or a submission' using errcode = 'P0001', hint = 'DC-10';
    end if;
    return new;
  end if;
  if new.jury_assignment_id <> old.jury_assignment_id then
    raise exception 'an evaluation cannot move to another assignment' using errcode = 'P0001', hint = 'DC-10';
  end if;
  if old.state = 'submitted' then
    -- Only a reopen: same scores, comments and rubric; state 'reopened'; a NEW reopen stamp by active Management.
    if new.state <> 'reopened' or new.scores <> old.scores or new.comments is distinct from old.comments
       or new.rubric_id <> old.rubric_id or new.reopened_at is not distinct from old.reopened_at
       or new.reopened_by is null or not sj_is_active_management(new.reopened_by) then
      raise exception 'a submitted evaluation can change only through a reopen by Management' using errcode = 'P0001', hint = 'DC-10';
    end if;
  elsif new.state = 'reopened' and old.state = 'draft' then
    raise exception 'only a submitted evaluation can be reopened' using errcode = 'P0001', hint = 'DC-10';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger evaluations_rules before insert or update or delete on evaluations
  for each row execute function evaluation_rules();

-- ---------------------------------------------------------------- pitch schedule (FR-JRY-02, -03, -14; TBD-21)
alter table pitch_slots add column created_by uuid references user_accounts(id);
alter table pitch_slots add column updated_at timestamptz not null default now();
alter table pitch_slots add constraint pitch_venue_length check (venue is null or length(venue) <= 200);
create unique index pitch_one_slot_per_startup on pitch_slots (edition_id, startup_id);
create function pitch_slot_rules() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' or new.startup_id <> old.startup_id then
    if not sj_startup_in_edition(new.startup_id, new.edition_id) then
      raise exception 'startup % does not take part in edition %', new.startup_id, new.edition_id using errcode = 'P0001', hint = 'STARTUP-NOT-IN-EDITION';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger pitch_slots_rules before insert or update on pitch_slots
  for each row execute function pitch_slot_rules();

-- ---------------------------------------------------------------- volunteer assignment runs (FR-VOL-04, -07, -11)
-- What the generator saw (sorted ids), so a run can be reproduced from its seed.
alter table assignment_runs add column inputs jsonb not null default '{}'::jsonb;
-- One draft run per edition: concurrent "generate" requests cannot both produce drafts.
create unique index assignment_one_draft_run on assignment_runs (edition_id) where state = 'draft';
create function assignment_run_rules() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.state <> 'draft' then
    raise exception 'assignment run % is already %', old.id, old.state using errcode = 'P0001', hint = 'RUN-CLOSED';
  end if;
  if new.state = 'approved' and (new.reviewed_by is null or not sj_is_active_management(new.reviewed_by)) then
    raise exception 'an assignment run is approved only by an active Management account' using errcode = 'P0001', hint = 'DC-02';
  end if;
  if new.seed <> old.seed or new.inputs <> old.inputs or new.edition_id <> old.edition_id then
    raise exception 'a run''s seed and inputs are fixed' using errcode = 'P0001', hint = 'RUN-CLOSED';
  end if;
  return new;
end $$;
create trigger assignment_runs_rules before update on assignment_runs
  for each row execute function assignment_run_rules();

-- ---------------------------------------------------------------- volunteer assignments (DC-04…07, FR-VOL-09)
alter table volunteer_assignments add column replaces_id uuid references volunteer_assignments(id);
alter table volunteer_assignments add column reason text check (reason is null or length(trim(reason)) between 1 and 2000);
alter table volunteer_assignments add column activated_at timestamptz;
alter table volunteer_assignments add column activated_by uuid references user_accounts(id);
-- A closed assignment always says who closed it and why (DC-07 history).
alter table volunteer_assignments add constraint close_fields_complete check (
  state <> 'closed' or (closed_by is not null and close_reason is not null and length(trim(close_reason)) between 1 and 2000));
-- Hand-made assignments (outside a generator run) and reassignments carry a reason.
alter table volunteer_assignments add constraint manual_assignment_reason check (run_id is not null or reason is not null);
create index volunteer_assignments_target_history on volunteer_assignments (edition_id, target_startup_id, target_jury_user_id);

create function volunteer_assignment_rules() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'volunteer assignments are kept permanently (DC-07)' using errcode = 'P0001', hint = 'DC-07';
  end if;
  if tg_op = 'UPDATE' then
    if old.state = 'closed' then
      raise exception 'a closed assignment cannot change (DC-07)' using errcode = 'P0001', hint = 'DC-07';
    end if;
    if new.volunteer_user_id <> old.volunteer_user_id or new.target_startup_id is distinct from old.target_startup_id
       or new.target_jury_user_id is distinct from old.target_jury_user_id or new.edition_id <> old.edition_id
       or new.run_id is distinct from old.run_id or new.replaces_id is distinct from old.replaces_id
       or new.created_by <> old.created_by or new.reason is distinct from old.reason then
      raise exception 'an assignment is never edited in place; close it and create a new one (DC-07)' using errcode = 'P0001', hint = 'DC-07';
    end if;
    if old.state = 'active' and new.state = 'draft' then
      raise exception 'an active assignment cannot return to draft' using errcode = 'P0001', hint = 'DC-07';
    end if;
    if new.state = 'active' and old.state = 'draft' and (new.activated_by is null or not sj_is_active_management(new.activated_by)) then
      raise exception 'only an active Management account can save assignments' using errcode = 'P0001', hint = 'DC-02';
    end if;
    if new.state = 'closed' then return new; end if;   -- closing needs no eligibility (e.g. a deactivated volunteer)
  else
    if new.state = 'closed' then
      raise exception 'a new assignment is a draft or active' using errcode = 'P0001', hint = 'DC-07';
    end if;
    if new.replaces_id is not null and not exists (
      select 1 from volunteer_assignments r where r.id = new.replaces_id and r.state = 'closed' and r.edition_id = new.edition_id) then
      raise exception 'a reassignment replaces a closed assignment of the same edition' using errcode = 'P0001', hint = 'DC-07';
    end if;
  end if;
  -- Leave "both targets" / "no target" to the exactly_one_target check constraint (DC-04).
  if num_nonnulls(new.target_startup_id, new.target_jury_user_id) = 1 then
    if not sj_person_in_edition(new.volunteer_user_id, 'volunteer', new.edition_id) then
      raise exception 'user % is not a volunteer of edition %', new.volunteer_user_id, new.edition_id using errcode = 'P0001', hint = 'VOLUNTEER-NOT-ELIGIBLE';
    end if;
    if new.target_startup_id is not null and not sj_startup_in_edition(new.target_startup_id, new.edition_id) then
      raise exception 'startup % does not take part in edition %', new.target_startup_id, new.edition_id using errcode = 'P0001', hint = 'STARTUP-NOT-IN-EDITION';
    end if;
    if new.target_jury_user_id is not null and not sj_person_in_edition(new.target_jury_user_id, 'jury_member', new.edition_id) then
      raise exception 'user % is not a jury member of edition %', new.target_jury_user_id, new.edition_id using errcode = 'P0001', hint = 'JURY-NOT-ELIGIBLE';
    end if;
  end if;
  return new;
end $$;
create trigger volunteer_assignments_rules before insert or update or delete on volunteer_assignments
  for each row execute function volunteer_assignment_rules();
