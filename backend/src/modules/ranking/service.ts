// AI ranking, Management side (PRD §7, FR-RNK-*; TBD-01, TBD-42). Management defines and approves versioned criteria
// sets, starts ranking runs and reviews the results. The AI only recommends: nothing here writes a decision.
import type {
  ApplicationAi, Criterion, CriteriaSet, CriteriaSetCreate, InternalStatus, RankingResultItem, RankingRunDetail,
  RankingRunSummary,
} from "@sj/contracts";
import { CriteriaList } from "@sj/contracts";
import { isUniqueViolation, type Db, type Sql } from "../../db/client.js";
import { audit } from "../../platform/audit.js";
import { AppError, notFound } from "../../platform/errors.js";
import type { Principal } from "../../platform/principal.js";
import { getEdition, registrationOpen } from "../editions/service.js";
import { PROMPT_VERSION } from "./model.js";

// ---------------------------------------------------------------- criteria sets
type SetRow = {
  id: string; edition: number; version: number; criteria: unknown; note: string | null; createdBy: string | null; createdAt: Date;
  approvedBy: string | null; approvedAt: Date | null; usedByRuns: number;
};

const SET_SELECT = (db: Db) => db`
  select c.id, c.edition_id as edition, c.version, c.criteria, c.note, cu.full_name as "createdBy", c.created_at as "createdAt",
         au.full_name as "approvedBy", c.approved_at as "approvedAt",
         (select count(*)::int from ranking_runs r where r.criteria_set_id = c.id) as "usedByRuns"
  from criteria_sets c
  left join user_accounts cu on cu.id = c.created_by
  left join user_accounts au on au.id = c.approved_by`;

const toSet = (r: SetRow): CriteriaSet => ({
  id: r.id, edition: r.edition, version: r.version, criteria: CriteriaList.parse(r.criteria), note: r.note,
  createdBy: r.createdBy, createdAt: r.createdAt.toISOString(), approvedBy: r.approvedBy,
  approvedAt: r.approvedAt?.toISOString() ?? null, usedByRuns: r.usedByRuns,
});

export async function listCriteriaSets(db: Db, year: number): Promise<CriteriaSet[]> {
  await getEdition(db, year);
  const rows = await db<SetRow[]>`${SET_SELECT(db)} where c.edition_id = ${year} order by c.version desc`;
  return rows.map(toSet);
}

async function getCriteriaSet(db: Db, id: string): Promise<CriteriaSet> {
  const [row] = await db<SetRow[]>`${SET_SELECT(db)} where c.id = ${id}`;
  if (!row) throw notFound("Criteria set");
  return toSet(row);
}

/** A new draft version (FR-RNK-07). Approved versions are never edited, so earlier runs keep their criteria (AT-12). */
export async function createCriteriaSet(sql: Sql, p: Principal, year: number, input: CriteriaSetCreate & { criteria: Criterion[] }): Promise<CriteriaSet> {
  await getEdition(sql, year);
  const id = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`criteria:${year}`}, 0))`;
    const [n] = await tx<{ v: number }[]>`select coalesce(max(version), 0) + 1 as v from criteria_sets where edition_id = ${year}`;
    const [row] = await tx<{ id: string }[]>`
      insert into criteria_sets (edition_id, version, criteria, note, created_by)
      values (${year}, ${n!.v}, ${tx.json(input.criteria as never)}, ${input.note ?? null}, ${p.account!.id}) returning id`;
    await audit(tx, { actorUserId: p.account!.id, action: "criteria.created", entityType: "criteria_set", entityId: row!.id,
      editionId: year, data: { version: n!.v, weights: Object.fromEntries(input.criteria.map((c) => [c.key, c.weight])) } });
    return row!.id;
  });
  return getCriteriaSet(sql, id);
}

export async function approveCriteriaSet(sql: Sql, p: Principal, id: string): Promise<CriteriaSet> {
  await sql.begin(async (tx) => {
    const [c] = await tx<{ edition: number; version: number; approvedAt: Date | null }[]>`
      select edition_id as edition, version, approved_at as "approvedAt" from criteria_sets where id = ${id} for update`;
    if (!c) throw notFound("Criteria set");
    if (c.approvedAt) throw new AppError(409, "criteria_approved", "Already approved", "This criteria set is already approved.");
    await tx`update criteria_sets set approved_by = ${p.account!.id}, approved_at = now() where id = ${id}`;
    await audit(tx, { actorUserId: p.account!.id, action: "criteria.approved", entityType: "criteria_set", entityId: id,
      editionId: c.edition, data: { version: c.version } });
  });
  return getCriteriaSet(sql, id);
}

// ---------------------------------------------------------------- ranking runs
type RunRow = {
  id: string; edition: number; criteriaSetId: string; criteriaVersion: number; modelRef: string; promptVersion: string;
  status: RankingRunSummary["status"]; startedBy: string; startedAt: Date; finishedAt: Date | null; cutLine: number | null;
  error: string | null; total: number; scored: number; flagged: number; pending: number; criteria: unknown;
};

const RUN_SELECT = (db: Db) => db`
  select r.id, r.edition_id as edition, r.criteria_set_id as "criteriaSetId", c.version as "criteriaVersion", c.criteria,
         r.model_ref as "modelRef", r.prompt_version as "promptVersion", r.status, u.full_name as "startedBy",
         r.started_at as "startedAt", r.finished_at as "finishedAt", r.cut_line as "cutLine", r.error,
         (select count(*)::int from ranking_results x where x.run_id = r.id) as total,
         (select count(*)::int from ranking_results x where x.run_id = r.id and x.state = 'scored') as scored,
         (select count(*)::int from ranking_results x where x.run_id = r.id and x.state = 'flagged') as flagged,
         (select count(*)::int from ranking_results x where x.run_id = r.id and x.state = 'pending') as pending
  from ranking_runs r join criteria_sets c on c.id = r.criteria_set_id join user_accounts u on u.id = r.started_by`;

const toSummary = (r: RunRow): RankingRunSummary => ({
  id: r.id, edition: r.edition, criteriaSetId: r.criteriaSetId, criteriaVersion: r.criteriaVersion, modelRef: r.modelRef,
  promptVersion: r.promptVersion, status: r.status, startedBy: r.startedBy, startedAt: r.startedAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null, cutLine: r.cutLine, error: r.error,
  counts: { total: r.total, scored: r.scored, flagged: r.flagged, pending: r.pending },
});

export async function listRuns(db: Db, year: number): Promise<RankingRunSummary[]> {
  await getEdition(db, year);
  return (await db<RunRow[]>`${RUN_SELECT(db)} where r.edition_id = ${year} order by r.seq desc`).map(toSummary);
}

type ResultRow = {
  applicationId: string; startupName: string; applicationStatus: InternalStatus; state: RankingResultItem["state"];
  rank: number | null; totalScore: string | null; criterionScores: { key: string; score: number; explanation: string }[];
  explanation: string | null; flags: string[];
};

function toResult(r: ResultRow, criteria: Criterion[]): RankingResultItem {
  return {
    applicationId: r.applicationId, startupName: r.startupName, applicationStatus: r.applicationStatus, state: r.state,
    rank: r.rank, totalScore: r.totalScore === null ? null : Number(r.totalScore), summary: r.explanation, flags: r.flags,
    scores: scoresWithLabels(criteria, r.criterionScores),
  };
}

function scoresWithLabels(criteria: Criterion[], scores: { key: string; score: number; explanation: string }[] | null) {
  // Unscored results keep the column default ('{}'), so anything that is not an array means "no scores".
  return (Array.isArray(scores) ? scores : []).map((s) => {
    const c = criteria.find((x) => x.key === s.key);
    return { key: s.key, label: c?.label ?? s.key, score: s.score, min: c?.min ?? 0, max: c?.max ?? 0, explanation: s.explanation };
  });
}

export async function getRun(db: Db, id: string): Promise<RankingRunDetail> {
  const [run] = await db<RunRow[]>`${RUN_SELECT(db)} where r.id = ${id}`;
  if (!run) throw notFound("Ranking run");
  const criteria = CriteriaList.parse(run.criteria);
  const edition = await getEdition(db, run.edition);
  const rows = await db<ResultRow[]>`
    select x.application_id as "applicationId", s.name as "startupName", a.status as "applicationStatus", x.state, x.rank,
           x.total_score::text as "totalScore", x.criterion_scores as "criterionScores", x.explanation, x.flags
    from ranking_results x join applications a on a.id = x.application_id join startups s on s.id = a.startup_id
    where x.run_id = ${id}
    order by (x.rank is null), x.rank, x.state desc, a.submitted_at`;
  return { ...toSummary(run), criteria, selectionLimit: edition.selectionLimit, results: rows.map((r) => toResult(r, criteria)) };
}

/**
 * Starts a ranking run over the edition's whole cohort (FR-RNK-08). Only after registration for that edition has
 * closed (TBD-42: no partial cohorts), only with an approved criteria set (FR-RNK-01), one active run at a time.
 * The cohort is snapshotted now as pending results; the worker scores them under its own restricted identity.
 */
export async function startRun(sql: Sql, p: Principal, year: number, criteriaSetId: string, modelRef: string, now: Date): Promise<RankingRunSummary> {
  const edition = await getEdition(sql, year);
  if (registrationOpen(edition, now)) {
    throw new AppError(409, "registration_open", "Registration is still open",
      `Applications for ${year} can be ranked only after registration closes, so the whole cohort is ranked together (TBD-42).`);
  }
  const id = await sql.begin(async (tx) => {
    const [set] = await tx<{ edition: number; approvedAt: Date | null; version: number }[]>`
      select edition_id as edition, approved_at as "approvedAt", version from criteria_sets where id = ${criteriaSetId}`;
    if (!set || set.edition !== year) throw notFound("Criteria set");
    if (!set.approvedAt) {
      throw new AppError(409, "criteria_not_approved", "Criteria not approved",
        "A Management user must approve this criteria set before it can be used for ranking (TBD-01).");
    }
    const cohort = await tx<{ id: string }[]>`
      select id from applications where edition_id = ${year} and status <> 'withdrawn' order by submitted_at`;
    if (!cohort.length) throw new AppError(409, "empty_cohort", "Nothing to rank", `There are no ${year} applications to rank.`);
    let run: { id: string };
    try {
      const rows = await tx<{ id: string }[]>`
        insert into ranking_runs (edition_id, criteria_set_id, model_ref, prompt_version, status, started_by, started_at)
        values (${year}, ${criteriaSetId}, ${modelRef}, ${PROMPT_VERSION}, 'queued', ${p.account!.id}, ${now})
        returning id`;
      run = rows[0]!;
    } catch (err) {
      if (isUniqueViolation(err, "ranking_one_active_run")) {
        throw new AppError(409, "run_in_progress", "A ranking run is already in progress", `Wait for the current ${year} run to finish.`);
      }
      throw err;
    }
    const ids = cohort.map((c) => c.id);
    await tx`insert into ranking_results (run_id, application_id) select ${run.id}, unnest(${tx.array(ids)}::uuid[])`;
    await tx`update applications set status = 'under_ai_evaluation'
             where id in ${tx(ids)} and status in ('submitted', 'ranked', 'flagged_manual_review')`;
    await audit(tx, { actorUserId: p.account!.id, action: "ranking.run_started", entityType: "ranking_run", entityId: run.id,
      editionId: year, data: { criteriaSetId, criteriaVersion: set.version, modelRef, promptVersion: PROMPT_VERSION, cohort: ids.length } });
    return run.id;
  });
  const [row] = await sql<RunRow[]>`${RUN_SELECT(sql)} where r.id = ${id}`;
  return toSummary(row!);
}

/** TBD-18: Management's cut line for override detection when the edition has no selection limit. */
export async function setCutLine(sql: Sql, p: Principal, id: string, cutLine: number | null): Promise<RankingRunDetail> {
  await sql.begin(async (tx) => {
    const [r] = await tx<{ edition: number; status: string }[]>`select edition_id as edition, status from ranking_runs where id = ${id} for update`;
    if (!r) throw notFound("Ranking run");
    if (r.status !== "completed") throw new AppError(409, "run_not_completed", "Run not completed", "Set a cut line on a completed run.");
    await tx`update ranking_runs set cut_line = ${cutLine} where id = ${id}`;
    await audit(tx, { actorUserId: p.account!.id, action: "ranking.cut_line_set", entityType: "ranking_run", entityId: id,
      editionId: r.edition, data: { cutLine } });
  });
  return getRun(sql, id);
}

// ---------------------------------------------------------------- the ranking view of applications (Management only)
type AiRow = {
  applicationId: string; runId: string; criteriaVersion: number; criteria: unknown; state: ApplicationAi["state"]; rank: number | null;
  totalScore: string | null; criterionScores: { key: string; score: number; explanation: string }[] | null; explanation: string | null;
  flags: string[]; cutLine: number | null; selectionLimit: number | null;
};

/** The latest COMPLETED run's result for each application (earlier runs remain viewable on their own, FR-RNK-11). */
export async function latestAi(db: Db, applicationIds: string[]): Promise<Map<string, ApplicationAi>> {
  const out = new Map<string, ApplicationAi>();
  if (!applicationIds.length) return out;
  const rows = await db<AiRow[]>`
    select distinct on (x.application_id)
           x.application_id as "applicationId", r.id as "runId", c.version as "criteriaVersion", c.criteria, x.state, x.rank,
           x.total_score::text as "totalScore", x.criterion_scores as "criterionScores", x.explanation, x.flags,
           r.cut_line as "cutLine", e.selection_limit as "selectionLimit"
    from ranking_results x
    join ranking_runs r on r.id = x.run_id and r.status = 'completed'
    join criteria_sets c on c.id = r.criteria_set_id
    join event_editions e on e.id = r.edition_id
    where x.application_id in ${db(applicationIds)}
    order by x.application_id, r.seq desc`;
  for (const r of rows) {
    out.set(r.applicationId, {
      runId: r.runId, criteriaVersion: r.criteriaVersion, state: r.state, rank: r.rank,
      totalScore: r.totalScore === null ? null : Number(r.totalScore),
      cutLine: r.selectionLimit ?? r.cutLine, summary: r.explanation, flags: r.flags,
      scores: scoresWithLabels(CriteriaList.parse(r.criteria), r.criterionScores),
    });
  }
  return out;
}
