// Ranking worker (FR-RNK-02…13, AT-11, AT-40). Every database statement runs as the restricted role
// sj_ranking_worker (migration 0008): it can read the cohort and the criteria, write ranking results and move
// applications only between the AI-evaluation states. It cannot touch decisions, accounts or contact data.
// Model calls happen outside transactions; their output is validated before anything is stored.
import { ApplicationForm, CriteriaList, type Criterion } from "@sj/contracts";
import type { Db, Sql } from "../../db/client.js";
import { audit } from "../../platform/audit.js";
import {
  buildUserPrompt, ModelUnavailableError, RESPONSE_SCHEMA, SYSTEM_INSTRUCTION, validateOutput, weightedTotal,
  type RankingModel, type ValidatedOutput,
} from "./model.js";
import { prepareInput } from "./safety.js";

/** A run left "running" this long (worker crash, redeploy) is picked up again; finished results are kept. */
export const STALE_RUN_MS = 15 * 60_000;

async function asWorker<T>(sql: Sql, fn: (tx: Db) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`set local role sj_ranking_worker`;
    return fn(tx);
  }) as Promise<T>;
}

/** Claims the oldest queued (or stale) run and processes it. Returns the run id, or null when there is nothing to do. */
export async function processNextRankingRun(sql: Sql, model: RankingModel, now: () => Date = () => new Date()): Promise<string | null> {
  const staleBefore = new Date(now().getTime() - STALE_RUN_MS);
  const runId = await asWorker(sql, async (tx) => {
    const [r] = await tx<{ id: string }[]>`
      select id from ranking_runs
      where status = 'queued' or (status = 'running' and claimed_at < ${staleBefore})
      order by started_at limit 1 for update skip locked`;
    if (!r) return null;
    await tx`update ranking_runs set status = 'running', claimed_at = ${now()} where id = ${r.id}`;
    return r.id;
  });
  if (!runId) return null;
  try {
    await processRun(sql, model, runId, now);
  } catch (err) {
    await failRun(sql, runId, err as Error, now);
  }
  return runId;
}

type RunContext = { edition: number; criteria: Criterion[]; form: ApplicationForm };

async function loadRun(sql: Sql, runId: string): Promise<RunContext> {
  return asWorker(sql, async (tx) => {
    const [r] = await tx<{ edition: number; criteria: unknown; form: unknown }[]>`
      select r.edition_id as edition, c.criteria, e.application_form as form
      from ranking_runs r join criteria_sets c on c.id = r.criteria_set_id join event_editions e on e.id = r.edition_id
      where r.id = ${runId}`;
    if (!r) throw new Error(`ranking run ${runId} not found`);
    return { edition: r.edition, criteria: CriteriaList.parse(r.criteria), form: ApplicationForm.parse(r.form) };
  });
}

export async function processRun(sql: Sql, model: RankingModel, runId: string, now: () => Date = () => new Date()): Promise<void> {
  const ctx = await loadRun(sql, runId);
  const pending = await asWorker(sql, (tx) => tx<{ applicationId: string }[]>`
    select application_id as "applicationId" from ranking_results where run_id = ${runId} and state = 'pending'`);
  for (const { applicationId } of pending) await scoreOne(sql, model, runId, ctx, applicationId);
  await finalise(sql, runId, ctx, now);
}

async function scoreOne(sql: Sql, model: RankingModel, runId: string, ctx: RunContext, applicationId: string): Promise<void> {
  const src = await asWorker(sql, async (tx) => {
    const [a] = await tx<{ formAnswers: Record<string, unknown>; description: string | null; city: string | null; state: string | null }[]>`
      select a.form_answers as "formAnswers", s.description, s.city, s.state
      from applications a join startups s on s.id = a.startup_id where a.id = ${applicationId}`;
    return a;
  });
  if (!src) return;
  const prepared = prepareInput({ ...src, questions: ctx.form.questions });
  const flags: string[] = prepared.injection ? ["possible_prompt_injection"] : [];

  // FR-RNK-13: incomplete applications go to manual review instead of being ranked low.
  if (prepared.missing.length) {
    await saveFlagged(sql, runId, applicationId, [...flags, "missing_data"], prepared.sha256, 0);
    return;
  }

  const user = buildUserPrompt(ctx.criteria, prepared.input);
  let output: ValidatedOutput | null = null;
  let unavailable = false;
  let attempts = 0;
  // One retry for invalid output or an unreachable provider, then manual review (PRD §8 processing steps).
  while (attempts < 2 && !output) {
    attempts += 1;
    try {
      output = validateOutput(ctx.criteria, await model.complete({ system: SYSTEM_INSTRUCTION, user, responseSchema: RESPONSE_SCHEMA }));
      unavailable = false;
    } catch (err) {
      if (!(err instanceof ModelUnavailableError)) throw err;
      unavailable = true;
    }
  }
  if (!output) {
    await saveFlagged(sql, runId, applicationId, [...flags, unavailable ? "ai_unavailable" : "ai_output_invalid"], prepared.sha256, attempts);
    return;
  }
  if (output.injectionSuspected && !flags.includes("possible_prompt_injection")) flags.push("possible_prompt_injection");
  const total = weightedTotal(ctx.criteria, output.scores);
  await asWorker(sql, (tx) => tx`
    update ranking_results
    set state = 'scored', total_score = ${total}, criterion_scores = ${tx.json(output!.scores as never)},
        explanation = ${output!.summary}, flags = ${tx.array(flags)}::text[], input_sha256 = ${prepared.sha256}, attempts = ${attempts}
    where run_id = ${runId} and application_id = ${applicationId}`);
}

async function saveFlagged(sql: Sql, runId: string, applicationId: string, flags: string[], sha: string, attempts: number) {
  await asWorker(sql, (tx) => tx`
    update ranking_results set state = 'flagged', flags = ${tx.array(flags)}::text[], input_sha256 = ${sha}, attempts = ${attempts}
    where run_id = ${runId} and application_id = ${applicationId}`);
}

/** Deterministic ordering outside the model: competition ranking by weighted total (ties share a rank). */
async function finalise(sql: Sql, runId: string, ctx: RunContext, now: () => Date): Promise<void> {
  await asWorker(sql, async (tx) => {
    await tx`
      update ranking_results x set rank = ranked.rank
      from (select application_id, rank() over (order by total_score desc) as rank
            from ranking_results where run_id = ${runId} and state = 'scored') ranked
      where x.run_id = ${runId} and x.application_id = ranked.application_id`;
    await tx`
      update applications a set status = case x.state when 'scored' then 'ranked' else 'flagged_manual_review' end
      from ranking_results x
      where x.run_id = ${runId} and x.application_id = a.id
        and a.status in ('submitted', 'under_ai_evaluation', 'ranked', 'flagged_manual_review')`;
    const [c] = await tx<{ scored: number; flagged: number }[]>`
      select count(*) filter (where state = 'scored')::int as scored, count(*) filter (where state = 'flagged')::int as flagged
      from ranking_results where run_id = ${runId}`;
    await tx`update ranking_runs set status = 'completed', finished_at = ${now()} where id = ${runId}`;
    await audit(tx, { actorUserId: null, actorType: "service", action: "ranking.run_completed", entityType: "ranking_run",
      entityId: runId, editionId: ctx.edition, data: { service: "ranking", scored: c!.scored, flagged: c!.flagged } });
  });
}

/** PRD §8 failure mode: the run is marked failed and every unscored application goes to manual review. */
async function failRun(sql: Sql, runId: string, err: Error, now: () => Date): Promise<void> {
  await asWorker(sql, async (tx) => {
    await tx`update ranking_results set state = 'flagged', flags = array_append(flags, 'ai_unavailable')
             where run_id = ${runId} and state = 'pending'`;
    await tx`
      update applications a set status = 'flagged_manual_review'
      from ranking_results x
      where x.run_id = ${runId} and x.application_id = a.id and a.status = 'under_ai_evaluation'`;
    await tx`update ranking_runs set status = 'failed', finished_at = ${now()}, error = ${err.message.slice(0, 1000)} where id = ${runId}`;
    const [r] = await tx<{ edition: number }[]>`select edition_id as edition from ranking_runs where id = ${runId}`;
    await audit(tx, { actorUserId: null, actorType: "service", action: "ranking.run_failed", entityType: "ranking_run",
      entityId: runId, editionId: r?.edition ?? null, data: { service: "ranking", error: err.message.slice(0, 300) } });
  });
}
