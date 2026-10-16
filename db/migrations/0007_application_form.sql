-- 0007_application_form: the application form is edition configuration, not code (ADR-001, FR-REG-12; decision
-- TBD-39 in docs/DECISIONS.md). The website and app render the questions from GET /v1/public/editions, so wording
-- changes never need an app release. The API validates answers against this configuration and rejects unknown keys.
-- Question wording is a recommended default awaiting Management approval.

alter table event_editions
  add column application_form jsonb not null default '{"version": "none", "questions": []}'::jsonb
  check (jsonb_typeof(application_form -> 'version') = 'string' and jsonb_typeof(application_form -> 'questions') = 'array');

-- The form version each application answered (audit and fair comparison).
alter table applications add column form_version text;

update event_editions set application_form = $form$
{
  "version": "2026-10-15",
  "questions": [
    {"key": "problem",  "label": "What problem are you solving, and for whom?", "minLength": 20, "maxLength": 1500},
    {"key": "solution", "label": "What is your solution, and what makes it new or better than current alternatives?", "minLength": 20, "maxLength": 1500},
    {"key": "stage",    "label": "What stage is the startup at (idea, prototype, pilot or revenue), and what have you achieved so far?", "minLength": 20, "maxLength": 1500},
    {"key": "market",   "label": "Who are your customers, how large is the opportunity, and how will the startup grow?", "minLength": 20, "maxLength": 1500},
    {"key": "impact",   "label": "What economic, social or environmental impact do you expect?", "minLength": 20, "maxLength": 1500},
    {"key": "team",     "label": "Who is in the founding team, and what relevant skills and experience do they bring?", "help": "Roles and experience only. Do not include contact details.", "minLength": 20, "maxLength": 1500}
  ]
}
$form$::jsonb
where id in (2026, 2027);

-- Fairness: once an edition has applications, every applicant must have answered the same questions.
create function freeze_application_form() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.application_form is distinct from old.application_form
     and exists (select 1 from applications where edition_id = old.id) then
    raise exception 'the application form of edition % is frozen because applications exist', old.id
      using errcode = 'P0001', hint = 'FORM-FROZEN';
  end if;
  return new;
end $$;
create trigger event_editions_form_frozen before update of application_form on event_editions
  for each row execute function freeze_application_form();
