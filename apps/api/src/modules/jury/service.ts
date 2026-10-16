// Jury evaluation (PRD §8, FR-JRY-*; decisions TBD-20, -21, -43 in docs/DECISIONS.md).
// Management configures versioned rubrics, assigns jurors to startups, keeps the pitch schedule and sets the startup
// currently pitching; jurors score only their own assignments; Management reviews the evaluations.
// Jury scoring is decision support for the event only. It is completely separate from AI ranking and from startup
// selection: this module never reads or writes applications' decisions, ranking runs or ranking results, and no
// selection or ranking code reads evaluations (tested in jury.test.ts).
import {
  checkJuryScores, juryTotal, JuryParameterList, type EvaluationDetail, type EvaluationReview, type JuryHome, type JuryOverview,
  type JuryParameter, type JuryStartupProfile, type PitchSlot, type Rubric, type RubricCreate,
} from "@sj/contracts";
import { ApplicationForm } from "@sj/contracts";
import { isUniqueViolation, type Db, type Sql } from "../../db/client.js";
import { audit } from "../../platform/audit.js";
import { AppError, notFound } from "../../platform/errors.js";
import type { Principal } from "../../platform/principal.js";
import { getEdition } from "../editions/service.js";

// ---------------------------------------------------------------- rubrics (FR-JRY-08, -09, -13; TBD-43)
type RubricRow = {
  id: string; edition: number; version: number; parameters: unknown; commentsAllowed: boolean; note: string | null; createdBy: string | null;
  createdAt: Date; approvedBy: string | null; approvedAt: Date | null; usedByEvaluations: number;
};

const RUBRIC_SELECT = (db: Db) => db`
  select r.id, r.edition_id as edition, r.version, r.parameters, r.comments_allowed as "commentsAllowed", r.note,
         cu.full_name as "createdBy", r.created_at as "createdAt", au.full_name as "approvedBy", r.approved_at as "approvedAt",
         (select count(*)::int from evaluations e where e.rubric_id = r.id) as "usedByEvaluations"
  from scoring_rubrics r left join user_accounts cu on cu.id = r.created_by left join user_accounts au on au.id = r.approved_by`;

const toRubric = (r: RubricRow): Rubric => ({
  id: r.id, edition: r.edition, version: r.version, parameters: JuryParameterList.parse(r.parameters), commentsAllowed: r.commentsAllowed,
  note: r.note, createdBy: r.createdBy, createdAt: r.createdAt.toISOString(), approvedBy: r.approvedBy,
  approvedAt: r.approvedAt?.toISOString() ?? null, usedByEvaluations: r.usedByEvaluations,
});

async function listRubrics(db: Db, year: number): Promise<Rubric[]> {
  return (await db<RubricRow[]>`${RUBRIC_SELECT(db)} where r.edition_id = ${year} order by r.version desc`).map(toRubric);
}

async function getRubric(db: Db, id: string): Promise<Rubric> {
  const [r] = await db<RubricRow[]>`${RUBRIC_SELECT(db)} where r.id = ${id}`;
  if (!r) throw notFound("Rubric");
  return toRubric(r);
}

/** The rubric jurors score with now: the latest APPROVED version of the edition (null until one is approved). */
async function activeRubric(db: Db, year: number): Promise<Rubric | null> {
  const [r] = await db<RubricRow[]>`${RUBRIC_SELECT(db)} where r.edition_id = ${year} and r.approved_at is not null order by r.version desc limit 1`;
  return r ? toRubric(r) : null;
}

export async function createRubric(sql: Sql, p: Principal, year: number, input: RubricCreate & { parameters: JuryParameter[] }): Promise<Rubric> {
  await getEdition(sql, year);
  const id = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`rubric:${year}`}, 0))`;
    const [n] = await tx<{ v: number }[]>`select coalesce(max(version), 0) + 1 as v from scoring_rubrics where edition_id = ${year}`;
    const [row] = await tx<{ id: string }[]>`
      insert into scoring_rubrics (edition_id, version, parameters, comments_allowed, note, created_by)
      values (${year}, ${n!.v}, ${tx.json(input.parameters as never)}, ${input.commentsAllowed ?? true}, ${input.note ?? null}, ${p.account!.id})
      returning id`;
    await audit(tx, { actorUserId: p.account!.id, action: "jury.rubric_created", entityType: "scoring_rubric", entityId: row!.id,
      editionId: year, data: { version: n!.v, parameters: input.parameters.map((x) => ({ key: x.key, weight: x.weight, min: x.min, max: x.max })) } });
    return row!.id;
  });
  return getRubric(sql, id);
}

export async function approveRubric(sql: Sql, p: Principal, id: string): Promise<Rubric> {
  await sql.begin(async (tx) => {
    const [r] = await tx<{ edition: number; version: number; approvedAt: Date | null }[]>`
      select edition_id as edition, version, approved_at as "approvedAt" from scoring_rubrics where id = ${id} for update`;
    if (!r) throw notFound("Rubric");
    if (r.approvedAt) throw new AppError(409, "rubric_approved", "Already approved", "This rubric version is already approved.");
    await tx`update scoring_rubrics set approved_by = ${p.account!.id}, approved_at = now() where id = ${id}`;
    await audit(tx, { actorUserId: p.account!.id, action: "jury.rubric_approved", entityType: "scoring_rubric", entityId: id,
      editionId: r.edition, data: { version: r.version } });
  });
  return getRubric(sql, id);
}

// ---------------------------------------------------------------- people and startups taking part (TBD-20, TBD-22)
export async function eligibleJurors(db: Db, year: number) {
  return db<{ id: string; fullName: string; status: "pending_activation" | "active" | "deactivated" }[]>`
    select u.id, u.full_name as "fullName", u.status from user_accounts u
    where sj_person_in_edition(u.id, 'jury_member', ${year}::smallint) order by u.full_name, u.id`;
}

export async function eligibleStartups(db: Db, year: number) {
  return db<{ id: string; name: string; origin: "predefined" | "applicant" }[]>`
    select s.id, s.name, s.origin from startups s where sj_startup_in_edition(s.id, ${year}::smallint) order by s.name, s.id`;
}

// ---------------------------------------------------------------- Management overview, assignments, schedule
type SlotRow = { id: string; startupId: string; startupName: string; startsAt: Date | null; venue: string | null; state: PitchSlot["state"] };
const toSlot = (s: SlotRow): PitchSlot => ({ ...s, startsAt: s.startsAt?.toISOString() ?? null });

async function slots(db: Db, year: number): Promise<PitchSlot[]> {
  const rows = await db<SlotRow[]>`
    select p.id, p.startup_id as "startupId", s.name as "startupName", p.starts_at as "startsAt", p.venue, p.state
    from pitch_slots p join startups s on s.id = p.startup_id where p.edition_id = ${year}
    order by p.starts_at nulls last, s.name`;
  return rows.map(toSlot);
}

export async function juryOverview(db: Db, year: number): Promise<JuryOverview> {
  await getEdition(db, year);
  const [rubrics, active, jurors, startups, slotList] = await Promise.all([
    listRubrics(db, year), activeRubric(db, year), eligibleJurors(db, year), eligibleStartups(db, year), slots(db, year),
  ]);
  const assignments = await db<{
    id: string; juryUserId: string; juryName: string; startupId: string; startupName: string; createdAt: Date;
    evaluationId: string | null; state: "draft" | "submitted" | "reopened" | null; totalScore: string | null; submittedAt: Date | null;
  }[]>`
    select j.id, j.jury_user_id as "juryUserId", u.full_name as "juryName", j.startup_id as "startupId", s.name as "startupName",
           j.created_at as "createdAt", e.id as "evaluationId", e.state, e.total_score::text as "totalScore", e.submitted_at as "submittedAt"
    from jury_assignments j join user_accounts u on u.id = j.jury_user_id join startups s on s.id = j.startup_id
    left join evaluations e on e.jury_assignment_id = j.id
    where j.edition_id = ${year} order by u.full_name, s.name`;
  const count = new Map<string, number>();
  for (const a of assignments) count.set(a.juryUserId, (count.get(a.juryUserId) ?? 0) + 1);
  return {
    edition: year,
    rubrics,
    activeRubricId: active?.id ?? null,
    jurors: jurors.map((j) => ({ ...j, assigned: count.get(j.id) ?? 0 })),
    startups: [...startups],
    assignments: assignments.map((a) => ({
      id: a.id, juryUserId: a.juryUserId, juryName: a.juryName, startupId: a.startupId, startupName: a.startupName, createdAt: a.createdAt.toISOString(),
      evaluation: a.evaluationId
        ? { id: a.evaluationId, state: a.state!, totalScore: a.totalScore === null ? null : Number(a.totalScore), submittedAt: a.submittedAt?.toISOString() ?? null }
        : null,
    })),
    slots: slotList,
    currentPitch: slotList.find((s) => s.state === "pitching") ?? null,
  };
}

/** TBD-20: Management assigns explicitly which startups each juror evaluates. */
export async function assignJury(sql: Sql, p: Principal, year: number, input: { juryUserId: string; startupId: string }) {
  await getEdition(sql, year);
  await sql.begin(async (tx) => {
    const [ok] = await tx<{ juror: boolean; startup: boolean }[]>`
      select sj_person_in_edition(${input.juryUserId}, 'jury_member', ${year}::smallint) as juror,
             sj_startup_in_edition(${input.startupId}, ${year}::smallint) as startup`;
    if (!ok!.juror) throw new AppError(409, "not_a_juror", "Not a jury member", `This person is not a jury member of the ${year} event.`);
    if (!ok!.startup) throw new AppError(409, "startup_not_in_edition", "Startup not in this event", `This startup does not take part in the ${year} event.`);
    try {
      const [row] = await tx<{ id: string }[]>`
        insert into jury_assignments (edition_id, jury_user_id, startup_id, created_by)
        values (${year}, ${input.juryUserId}, ${input.startupId}, ${p.account!.id}) returning id`;
      await audit(tx, { actorUserId: p.account!.id, action: "jury.assigned", entityType: "jury_assignment", entityId: row!.id, editionId: year,
        data: { juryUserId: input.juryUserId, startupId: input.startupId } });
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError(409, "already_assigned", "Already assigned", "This juror already evaluates this startup.");
      throw err;
    }
  });
  return juryOverview(sql, year);
}

export async function removeJuryAssignment(sql: Sql, p: Principal, id: string) {
  const year = await sql.begin(async (tx) => {
    const [a] = await tx<{ edition: number; juryUserId: string; startupId: string; hasEvaluation: boolean }[]>`
      select j.edition_id as edition, j.jury_user_id as "juryUserId", j.startup_id as "startupId",
             exists (select 1 from evaluations e where e.jury_assignment_id = j.id) as "hasEvaluation"
      from jury_assignments j where j.id = ${id} for update`;
    if (!a) throw notFound("Jury assignment");
    if (a.hasEvaluation) {
      throw new AppError(409, "evaluation_exists", "The juror has started scoring", "An assignment with an evaluation is kept, so its scores stay accountable.");
    }
    await tx`delete from jury_assignments where id = ${id}`;
    await audit(tx, { actorUserId: p.account!.id, action: "jury.unassigned", entityType: "jury_assignment", entityId: id, editionId: a.edition,
      data: { juryUserId: a.juryUserId, startupId: a.startupId } });
    return a.edition;
  });
  return juryOverview(sql, year);
}

export async function createSlot(sql: Sql, p: Principal, year: number, input: { startupId: string; startsAt?: string | null; venue?: string | null }) {
  await getEdition(sql, year);
  await sql.begin(async (tx) => {
    const [ok] = await tx<{ ok: boolean }[]>`select sj_startup_in_edition(${input.startupId}, ${year}::smallint) as ok`;
    if (!ok!.ok) throw new AppError(409, "startup_not_in_edition", "Startup not in this event", `This startup does not take part in the ${year} event.`);
    try {
      const [row] = await tx<{ id: string }[]>`
        insert into pitch_slots (edition_id, startup_id, starts_at, venue, created_by)
        values (${year}, ${input.startupId}, ${input.startsAt ? new Date(input.startsAt) : null}, ${input.venue || null}, ${p.account!.id}) returning id`;
      await audit(tx, { actorUserId: p.account!.id, action: "jury.slot_created", entityType: "pitch_slot", entityId: row!.id, editionId: year,
        data: { startupId: input.startupId, startsAt: input.startsAt ?? null, venue: input.venue ?? null } });
    } catch (err) {
      if (isUniqueViolation(err, "pitch_one_slot_per_startup")) throw new AppError(409, "slot_exists", "Already scheduled", "This startup already has a pitch slot; edit it instead.");
      throw err;
    }
  });
  return juryOverview(sql, year);
}

async function lockSlot(tx: Db, id: string) {
  const [s] = await tx<{ edition: number; state: PitchSlot["state"]; startupId: string }[]>`
    select edition_id as edition, state, startup_id as "startupId" from pitch_slots where id = ${id} for update`;
  if (!s) throw notFound("Pitch slot");
  return s;
}

export async function updateSlot(sql: Sql, p: Principal, id: string, input: { startsAt?: string | null; venue?: string | null }) {
  const year = await sql.begin(async (tx) => {
    const s = await lockSlot(tx, id);
    await tx`update pitch_slots set
      starts_at = ${input.startsAt === undefined ? tx`starts_at` : input.startsAt ? new Date(input.startsAt) : null},
      venue = ${input.venue === undefined ? tx`venue` : input.venue || null} where id = ${id}`;
    await audit(tx, { actorUserId: p.account!.id, action: "jury.slot_updated", entityType: "pitch_slot", entityId: id, editionId: s.edition,
      data: { startsAt: input.startsAt, venue: input.venue } });
    return s.edition;
  });
  return juryOverview(sql, year);
}

export async function deleteSlot(sql: Sql, p: Principal, id: string) {
  const year = await sql.begin(async (tx) => {
    const s = await lockSlot(tx, id);
    if (s.state === "pitching") throw new AppError(409, "slot_live", "This startup is pitching now", "Finish the pitch first.");
    await tx`delete from pitch_slots where id = ${id}`;
    await audit(tx, { actorUserId: p.account!.id, action: "jury.slot_deleted", entityType: "pitch_slot", entityId: id, editionId: s.edition,
      data: { startupId: s.startupId } });
    return s.edition;
  });
  return juryOverview(sql, year);
}

/** FR-JRY-14 / TBD-21: a Management operator sets the startup currently pitching. One live pitch per edition (DB). */
export async function startPitch(sql: Sql, p: Principal, id: string) {
  const year = await sql.begin(async (tx) => {
    const s = await lockSlot(tx, id);
    // Serialise "start" per edition, so two operators cannot leave two live pitches racing for the unique index.
    await tx`select 1 from event_editions where id = ${s.edition} for update`;
    const finished = await tx<{ id: string }[]>`
      update pitch_slots set state = 'done' where edition_id = ${s.edition} and state = 'pitching' and id <> ${id} returning id`;
    await tx`update pitch_slots set state = 'pitching' where id = ${id}`;
    await audit(tx, { actorUserId: p.account!.id, action: "jury.pitch_started", entityType: "pitch_slot", entityId: id, editionId: s.edition,
      data: { startupId: s.startupId, finishedSlots: finished.map((f) => f.id) } });
    return s.edition;
  });
  return juryOverview(sql, year);
}

export async function finishPitch(sql: Sql, p: Principal, id: string) {
  const year = await sql.begin(async (tx) => {
    const s = await lockSlot(tx, id);
    if (s.state !== "pitching") throw new AppError(409, "not_pitching", "Not pitching", "Only the startup pitching now can be finished.");
    await tx`update pitch_slots set state = 'done' where id = ${id}`;
    await audit(tx, { actorUserId: p.account!.id, action: "jury.pitch_finished", entityType: "pitch_slot", entityId: id, editionId: s.edition,
      data: { startupId: s.startupId } });
    return s.edition;
  });
  return juryOverview(sql, year);
}

// ---------------------------------------------------------------- Management review (FR-JRY-16; TBD-20; AT-18)
type EvalRow = {
  id: string; assignmentId: string; startupId: string; startupName: string; juryUserId: string; juryName: string;
  state: "draft" | "submitted" | "reopened"; rubricId: string; rubricVersion: number; parameters: unknown; scores: Record<string, number>;
  comments: string | null; totalScore: string | null; submittedAt: Date | null; reopenedAt: Date | null; reopenReason: string | null;
};

const EVAL_SELECT = (db: Db) => db`
  select e.id, j.id as "assignmentId", j.startup_id as "startupId", s.name as "startupName", j.jury_user_id as "juryUserId",
         u.full_name as "juryName", e.state, e.rubric_id as "rubricId", r.version as "rubricVersion", r.parameters, e.scores, e.comments,
         e.total_score::text as "totalScore", e.submitted_at as "submittedAt", e.reopened_at as "reopenedAt", e.reopen_reason as "reopenReason"
  from evaluations e join jury_assignments j on j.id = e.jury_assignment_id join startups s on s.id = j.startup_id
  join user_accounts u on u.id = j.jury_user_id join scoring_rubrics r on r.id = e.rubric_id`;

const toDetail = (e: EvalRow): EvaluationDetail => ({
  id: e.id, assignmentId: e.assignmentId, startupId: e.startupId, startupName: e.startupName, juryUserId: e.juryUserId, juryName: e.juryName,
  state: e.state, rubricId: e.rubricId, rubricVersion: e.rubricVersion, scores: e.scores, comments: e.comments,
  totalScore: e.totalScore === null ? null : Number(e.totalScore), submittedAt: e.submittedAt?.toISOString() ?? null,
  reopenedAt: e.reopenedAt?.toISOString() ?? null, reopenReason: e.reopenReason,
});

const avg = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100;

/**
 * Score summaries per startup and every evaluation that has been submitted (or reopened after a submission).
 * Drafts stay the juror's own until submitted. No ranking of startups and no winner is produced here (FR-JRY-10).
 */
export async function reviewEvaluations(db: Db, year: number): Promise<EvaluationReview> {
  await getEdition(db, year);
  const rows = await db<EvalRow[]>`${EVAL_SELECT(db)} where j.edition_id = ${year} and e.submitted_at is not null order by s.name, u.full_name`;
  const assigned = await db<{ startupId: string; startupName: string; n: number }[]>`
    select j.startup_id as "startupId", s.name as "startupName", count(*)::int as n
    from jury_assignments j join startups s on s.id = j.startup_id where j.edition_id = ${year}
    group by j.startup_id, s.name order by s.name`;
  const startups = assigned.map((a) => {
    const submitted = rows.filter((r) => r.startupId === a.startupId && r.state === "submitted");
    const byRubric = [...new Set(submitted.map((r) => r.rubricId))].map((rubricId) => {
      const group = submitted.filter((r) => r.rubricId === rubricId);
      const parameters = JuryParameterList.parse(group[0]!.parameters);
      return {
        rubricId, version: group[0]!.rubricVersion, count: group.length,
        averageTotal: avg(group.map((g) => Number(g.totalScore))),
        parameters: parameters.map((pm) => ({ key: pm.key, label: pm.label, average: avg(group.map((g) => g.scores[pm.key]!)), min: pm.min, max: pm.max })),
      };
    });
    return { startupId: a.startupId, startupName: a.startupName, assigned: a.n, submitted: submitted.length, byRubric };
  });
  return { edition: year, startups, evaluations: rows.map(toDetail) };
}

/** FR-JRY-12: only Management reopens a submitted evaluation, with a reason; the previous submission is audited. */
export async function reopenEvaluation(sql: Sql, p: Principal, id: string, reason: string): Promise<EvaluationDetail> {
  await sql.begin(async (tx) => {
    const [e] = await tx<{ state: string; edition: number; scores: unknown; comments: string | null; totalScore: string | null; rubricId: string }[]>`
      select e.state, j.edition_id as edition, e.scores, e.comments, e.total_score::text as "totalScore", e.rubric_id as "rubricId"
      from evaluations e join jury_assignments j on j.id = e.jury_assignment_id where e.id = ${id} for update of e`;
    if (!e) throw notFound("Evaluation");
    if (e.state !== "submitted") throw new AppError(409, "not_submitted", "Not submitted", "Only a submitted evaluation can be reopened.");
    await tx`update evaluations set state = 'reopened', reopened_by = ${p.account!.id}, reopened_at = clock_timestamp(), reopen_reason = ${reason}
             where id = ${id}`;
    await audit(tx, { actorUserId: p.account!.id, action: "jury.evaluation_reopened", entityType: "evaluation", entityId: id, editionId: e.edition,
      data: { reason, previous: { scores: e.scores, comments: e.comments, totalScore: e.totalScore, rubricId: e.rubricId } } });
  });
  const [row] = await sql<EvalRow[]>`${EVAL_SELECT(sql)} where e.id = ${id}`;
  return toDetail(row!);
}

// ---------------------------------------------------------------- jurors (FR-JRY-01…07, -11, -15; AT-16, AT-17)
/** The caller must take part in this edition as a jury member (the role may be scoped to another edition). */
async function assertJuror(db: Db, p: Principal, year: number) {
  const [ok] = await db<{ ok: boolean }[]>`select sj_person_in_edition(${p.account!.id}, 'jury_member', ${year}::smallint) as ok`;
  if (!ok!.ok) throw new AppError(403, "not_a_juror", "Forbidden", `You are not a jury member of the ${year} event.`);
}

export async function juryHome(db: Db, p: Principal, year: number): Promise<JuryHome> {
  await assertJuror(db, p, year);
  const rubric = await activeRubric(db, year);
  const rows = await db<{
    startupId: string; name: string; city: string | null; state: string | null; startsAt: Date | null; venue: string | null;
    slotState: "scheduled" | "pitching" | "done" | null; evState: "draft" | "submitted" | "reopened" | null; scores: Record<string, number> | null;
    comments: string | null; totalScore: string | null; submittedAt: Date | null; rubricVersion: number | null;
  }[]>`
    select s.id as "startupId", s.name, s.city, s.state, ps.starts_at as "startsAt", ps.venue, ps.state as "slotState",
           e.state as "evState", e.scores, e.comments, e.total_score::text as "totalScore", e.submitted_at as "submittedAt", r.version as "rubricVersion"
    from jury_assignments j join startups s on s.id = j.startup_id
    left join pitch_slots ps on ps.edition_id = j.edition_id and ps.startup_id = j.startup_id
    left join evaluations e on e.jury_assignment_id = j.id left join scoring_rubrics r on r.id = e.rubric_id
    where j.edition_id = ${year} and j.jury_user_id = ${p.account!.id}
    order by ps.starts_at nulls last, s.name`;
  const [live] = await db<{ startupId: string; startupName: string; venue: string | null }[]>`
    select p.startup_id as "startupId", s.name as "startupName", p.venue from pitch_slots p join startups s on s.id = p.startup_id
    where p.edition_id = ${year} and p.state = 'pitching'`;
  return {
    edition: year,
    rubric: rubric ? { id: rubric.id, version: rubric.version, parameters: rubric.parameters, commentsAllowed: rubric.commentsAllowed } : null,
    currentPitch: live ? { ...live, assigned: rows.some((r) => r.startupId === live.startupId) } : null,
    startups: rows.map((r) => ({
      startupId: r.startupId, name: r.name, city: r.city, state: r.state,
      slot: r.slotState ? { startsAt: r.startsAt?.toISOString() ?? null, venue: r.venue, state: r.slotState } : null,
      // FR-JRY-15 / TBD-20: only the caller's own evaluation; nobody else's scores ever reach a juror.
      evaluation: r.evState
        ? { state: r.evState, scores: r.scores ?? {}, comments: r.comments, totalScore: r.totalScore === null ? null : Number(r.totalScore),
            submittedAt: r.submittedAt?.toISOString() ?? null, rubricVersion: r.rubricVersion! }
        : null,
    })),
  };
}

/**
 * FR-JRY-03/-04, AT-16: a juror may open the authorised profile of an assigned startup, or of the startup Management
 * has set as currently pitching. Anything else looks exactly like a missing startup. Never contact details or AI data.
 */
export async function juryStartupProfile(db: Db, p: Principal, year: number, startupId: string): Promise<JuryStartupProfile> {
  await assertJuror(db, p, year);
  const [access] = await db<{ assigned: boolean; live: boolean }[]>`
    select exists (select 1 from jury_assignments where edition_id = ${year} and jury_user_id = ${p.account!.id} and startup_id = ${startupId}) as assigned,
           exists (select 1 from pitch_slots where edition_id = ${year} and startup_id = ${startupId} and state = 'pitching') as live`;
  if (!access!.assigned && !access!.live) throw notFound("Startup");
  const [s] = await db<{ id: string; name: string; description: string | null; website: string | null; city: string | null; state: string | null; origin: "predefined" | "applicant" }[]>`
    select id, name, description, website, city, state, origin from startups where id = ${startupId}`;
  if (!s) throw notFound("Startup");
  const founders = await db<{ fullName: string; position: "leader" | "member" }[]>`
    select u.full_name as "fullName", m.position from startup_memberships m join user_accounts u on u.id = m.user_id
    where m.startup_id = ${startupId} order by (m.position <> 'leader'), u.full_name`;
  // The application answers of this edition, for a startup that applied and was not withdrawn (selected teams).
  const [app] = await db<{ answers: Record<string, unknown>; form: unknown }[]>`
    select a.form_answers as answers, e.application_form as form from applications a join event_editions e on e.id = a.edition_id
    where a.startup_id = ${startupId} and a.edition_id = ${year} and a.status <> 'withdrawn'`;
  const answers: { question: string; answer: string }[] = [];
  if (app) {
    const form = ApplicationForm.parse(app.form);
    for (const q of form.questions) {
      const v = app.answers[q.key];
      if (typeof v === "string" && v.trim()) answers.push({ question: q.label, answer: v });
    }
  }
  return { ...s, founders: [...founders], answers, assigned: access!.assigned };
}

/**
 * FR-JRY-05…07, -12, -13 (AT-17): the juror saves a draft or submits, for their own assignment only, against the active
 * (approved) rubric. Out-of-range or unknown scores are rejected; submission needs every parameter and locks the
 * evaluation; the rubric version is recorded.
 */
export async function saveEvaluation(sql: Sql, p: Principal, year: number, startupId: string,
  input: { scores: Record<string, number>; comments?: string }, submit: boolean): Promise<JuryHome> {
  await assertJuror(sql, p, year);
  await sql.begin(async (tx) => {
    const [a] = await tx<{ id: string }[]>`
      select id from jury_assignments where edition_id = ${year} and jury_user_id = ${p.account!.id} and startup_id = ${startupId} for update`;
    if (!a) throw notFound("Startup");   // not assigned: indistinguishable from a missing startup
    const rubric = await activeRubric(tx, year);
    if (!rubric) throw new AppError(409, "no_rubric", "Scoring is not open yet", "Management has not approved the scoring parameters yet.");
    const [e] = await tx<{ id: string; state: string }[]>`select id, state from evaluations where jury_assignment_id = ${a.id} for update`;
    if (e?.state === "submitted") {
      throw new AppError(409, "evaluation_submitted", "Already submitted", "Your evaluation is submitted and locked. Ask Management to reopen it if it needs a change.");
    }
    const issues = checkJuryScores(rubric.parameters, input.scores, { complete: submit });
    const comments = input.comments?.trim() || null;
    if (comments && !rubric.commentsAllowed) issues.push({ path: "comments", message: "Comments are not permitted for this rubric" });
    if (issues.length) throw new AppError(400, "validation_failed", "Some fields are invalid", undefined, { errors: issues });
    const state = submit ? "submitted" : e?.state === "reopened" ? "reopened" : "draft";
    const total = submit ? juryTotal(rubric.parameters, input.scores) : null;
    let id = e?.id;
    if (!e) {
      const [row] = await tx<{ id: string }[]>`
        insert into evaluations (jury_assignment_id, rubric_id, state, scores, comments, submitted_at, total_score)
        values (${a.id}, ${rubric.id}, ${state}, ${tx.json(input.scores as never)}, ${comments}, ${submit ? tx`now()` : null}, ${total})
        returning id`;
      id = row!.id;
    } else {
      await tx`update evaluations set rubric_id = ${rubric.id}, state = ${state}, scores = ${tx.json(input.scores as never)}, comments = ${comments},
               submitted_at = ${submit ? tx`now()` : tx`submitted_at`}, total_score = ${submit ? total : tx`total_score`}
               where id = ${e.id}`;
    }
    await audit(tx, { actorUserId: p.account!.id, action: submit ? "jury.evaluation_submitted" : "jury.evaluation_saved", entityType: "evaluation",
      entityId: id!, editionId: year, data: { startupId, rubricVersion: rubric.version, scores: input.scores, totalScore: total, hasComments: !!comments } });
  });
  return juryHome(sql, p, year);
}
