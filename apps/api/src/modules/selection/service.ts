// Management review and selection (PRD §7). Decisions are drafted, then released together; only release changes
// what applicants see and grants event access (FR-SEL-05, FR-SEL-09). Decisions are per application, so the
// 2026 and 2027 applications of one startup never affect each other (FR-REG-06, DC-03).
// Phase 5: decisions follow the AI ranking review (TBD-42: only after registration closes), overrides of the ranking
// need a written reason (TBD-18), released decisions change only through a two-person correction (TBD-37), and
// results also go to the applicant's verified contact by email or SMS (TBD-14).
import {
  overrideOf, type DecisionCorrection, type DecisionRequest, type InternalStatus, type ManageApplication,
  type ManageApplicationList, type OutboxStatus, type ReleaseResponse,
} from "@sj/contracts";
import type { Db, Sql } from "../../db/client.js";
import { audit } from "../../platform/audit.js";
import { AppError, notFound } from "../../platform/errors.js";
import type { Principal } from "../../platform/principal.js";
import { getEdition, registrationOpen } from "../editions/service.js";
import { enqueue, TEMPLATES } from "../notifications/outbox.js";
import { correctionMessage, notifyInApp, resultMessage } from "../notifications/service.js";
import { latestAi } from "../ranking/service.js";

type Row = {
  id: string; edition: number; status: InternalStatus; flags: string[]; submittedAt: Date; formAnswers: Record<string, unknown>; formVersion: string | null;
  withdrawnAt: Date | null;
  startupId: string; startupName: string; description: string | null; website: string | null; city: string | null; state: string | null;
  leaderId: string; leaderName: string; leaderEmail: string | null; leaderMobile: string | null;
  outcome: "selected" | "not_selected" | null; reason: string | null; decidedBy: string | null; decidedAt: Date | null; releasedAt: Date | null;
  isOverride: boolean | null; aiRank: number | null; correctedAt: Date | null;
};

const SELECT = (db: Db) => db`
  select a.id, a.edition_id as edition, a.status, a.flags, a.submitted_at as "submittedAt", a.form_answers as "formAnswers", a.form_version as "formVersion",
         a.withdrawn_at as "withdrawnAt",
         s.id as "startupId", s.name as "startupName", s.description, s.website, s.city, s.state,
         u.id as "leaderId", u.full_name as "leaderName", u.email as "leaderEmail", u.mobile_e164 as "leaderMobile",
         d.outcome, d.reason, d.decided_by as "decidedBy", d.decided_at as "decidedAt", d.released_at as "releasedAt",
         d.is_override as "isOverride", d.ai_rank_at_decision as "aiRank", d.corrected_at as "correctedAt"
  from applications a
  join startups s on s.id = a.startup_id
  join startup_memberships m on m.startup_id = s.id and m.position = 'leader'
  join user_accounts u on u.id = m.user_id
  left join selection_decisions d on d.application_id = a.id`;

async function otherEditions(db: Db, startupIds: string[]) {
  if (!startupIds.length) return new Map<string, { edition: number; status: InternalStatus }[]>();
  const rows = await db<{ startupId: string; edition: number; status: InternalStatus }[]>`
    select startup_id as "startupId", edition_id as edition, status from applications where startup_id in ${db(startupIds)}`;
  const m = new Map<string, { edition: number; status: InternalStatus }[]>();
  for (const r of rows) m.set(r.startupId, [...(m.get(r.startupId) ?? []), { edition: r.edition, status: r.status }]);
  return m;
}

const RESULT_KINDS = ["selection_result", "decision_corrected"];

async function resultNotifications(db: Db, rows: Row[]): Promise<Map<string, OutboxStatus[]>> {
  const m = new Map<string, OutboxStatus[]>();
  if (!rows.length) return m;
  const list = await db<{ userId: string; edition: number; kind: string; channel: OutboxStatus["channel"]; status: OutboxStatus["status"]; createdAt: Date; sentAt: Date | null }[]>`
    select user_id as "userId", edition_id as edition, kind, channel, status, created_at as "createdAt", sent_at as "sentAt"
    from notifications
    where kind in ${db(RESULT_KINDS)} and user_id in ${db([...new Set(rows.map((r) => r.leaderId))])}
    order by created_at, (channel <> 'in_app'), channel`;
  for (const r of rows) {
    m.set(r.id, list.filter((n) => n.userId === r.leaderId && n.edition === r.edition).map((n) => ({
      kind: n.kind, channel: n.channel, status: n.status, createdAt: n.createdAt.toISOString(), sentAt: n.sentAt?.toISOString() ?? null,
    })));
  }
  return m;
}

type CorrectionRow = {
  id: string; applicationId: string; edition: number; startupName: string; fromOutcome: "selected" | "not_selected";
  toOutcome: "selected" | "not_selected"; reason: string; requestedById: string; requestedBy: string; requestedAt: Date;
  status: DecisionCorrection["status"]; reviewedBy: string | null; reviewedAt: Date | null; reviewNote: string | null;
};

const CORRECTION_SELECT = (db: Db) => db`
  select c.id, c.application_id as "applicationId", a.edition_id as edition, s.name as "startupName", c.from_outcome as "fromOutcome",
         c.to_outcome as "toOutcome", c.reason, c.requested_by as "requestedById", ru.full_name as "requestedBy",
         c.requested_at as "requestedAt", c.status, vu.full_name as "reviewedBy", c.reviewed_at as "reviewedAt", c.review_note as "reviewNote"
  from decision_corrections c
  join applications a on a.id = c.application_id
  join startups s on s.id = a.startup_id
  join user_accounts ru on ru.id = c.requested_by
  left join user_accounts vu on vu.id = c.reviewed_by`;

const toCorrection = (c: CorrectionRow): DecisionCorrection => ({
  ...c, requestedAt: c.requestedAt.toISOString(), reviewedAt: c.reviewedAt?.toISOString() ?? null,
});

async function correctionsFor(db: Db, ids: string[]): Promise<Map<string, DecisionCorrection[]>> {
  const m = new Map<string, DecisionCorrection[]>();
  if (!ids.length) return m;
  const rows = await db<CorrectionRow[]>`${CORRECTION_SELECT(db)} where c.application_id in ${db(ids)} order by c.requested_at`;
  for (const r of rows) m.set(r.applicationId, [...(m.get(r.applicationId) ?? []), toCorrection(r)]);
  return m;
}

async function hydrate(db: Db, rows: Row[]): Promise<ManageApplication[]> {
  const ids = rows.map((r) => r.id);
  const [others, ai, notes, corrections] = await Promise.all([
    otherEditions(db, [...new Set(rows.map((r) => r.startupId))]), latestAi(db, ids), resultNotifications(db, rows), correctionsFor(db, ids),
  ]);
  return rows.map((r) => ({
    id: r.id, edition: r.edition, status: r.status, flags: r.flags, submittedAt: r.submittedAt.toISOString(),
    startup: { id: r.startupId, name: r.startupName, description: r.description, website: r.website, city: r.city, state: r.state },
    leader: { id: r.leaderId, fullName: r.leaderName, email: r.leaderEmail, mobile: r.leaderMobile },
    otherEditions: (others.get(r.startupId) ?? []).filter((o) => o.edition !== r.edition),
    decision: r.outcome
      ? {
          outcome: r.outcome, reason: r.reason, decidedBy: r.decidedBy!, decidedAt: r.decidedAt!.toISOString(),
          releasedAt: r.releasedAt?.toISOString() ?? null, isOverride: r.isOverride, aiRankAtDecision: r.aiRank,
          correctedAt: r.correctedAt?.toISOString() ?? null,
        }
      : null,
    formAnswers: r.formAnswers,
    formVersion: r.formVersion,
    withdrawnAt: r.withdrawnAt?.toISOString() ?? null,
    ai: ai.get(r.id) ?? null,
    notifications: notes.get(r.id) ?? [],
    corrections: corrections.get(r.id) ?? [],
  }));
}

export async function listApplications(db: Db, year: number, filter: { status?: InternalStatus }): Promise<ManageApplicationList> {
  const edition = await getEdition(db, year);
  const rows = await db<Row[]>`${SELECT(db)} where a.edition_id = ${year}
    ${filter.status ? db`and a.status = ${filter.status}` : db``} order by a.submitted_at`;
  const counts = await db<{ status: string; n: number }[]>`
    select status, count(*)::int as n from applications where edition_id = ${year} group by status`;
  const [sel] = await db<{ n: number }[]>`
    select count(*)::int as n from selection_decisions d join applications a on a.id = d.application_id
    where a.edition_id = ${year} and d.outcome = 'selected' and a.status <> 'withdrawn'`;
  const items = await hydrate(db, rows);
  // Ranked applications first, in rank order, so the review follows the AI ranking (FR-SEL-01); then the rest.
  items.sort((x, y) => (x.ai?.rank ?? Number.MAX_SAFE_INTEGER) - (y.ai?.rank ?? Number.MAX_SAFE_INTEGER));
  return {
    edition: year,
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    selectionLimit: edition.selectionLimit,
    selectedTotal: sel?.n ?? 0,
    items,
  };
}

export async function getApplication(db: Db, id: string): Promise<ManageApplication> {
  const [row] = await db<Row[]>`${SELECT(db)} where a.id = ${id}`;
  if (!row) throw notFound("Application");
  return (await hydrate(db, [row]))[0]!;
}

/** TBD-42: nothing is ranked or decided for an edition while its registration is still open. */
async function assertRegistrationClosed(db: Db, year: number, now: Date) {
  const edition = await getEdition(db, year);
  if (registrationOpen(edition, now)) {
    throw new AppError(409, "registration_open", "Registration is still open",
      `Decisions for ${year} can be made only after registration closes, so the whole cohort is reviewed together (TBD-42).`);
  }
  return edition;
}

export async function draftDecision(sql: Sql, p: Principal, id: string, input: DecisionRequest, now: Date): Promise<ManageApplication> {
  await sql.begin(async (tx) => {
    const [app] = await tx<{ status: InternalStatus; edition: number; releasedAt: Date | null }[]>`
      select a.status, a.edition_id as edition, d.released_at as "releasedAt"
      from applications a left join selection_decisions d on d.application_id = a.id
      where a.id = ${id} for update of a`;
    if (!app) throw notFound("Application");
    if (app.releasedAt) throw new AppError(409, "decision_released", "Decision already released",
      "Released decisions cannot be edited. Request a correction instead; it needs a second Management approver (TBD-37).");
    if (app.status === "withdrawn") throw new AppError(409, "application_withdrawn", "Application withdrawn", "The applicant has withdrawn this application.");
    const edition = await assertRegistrationClosed(tx, app.edition, now);

    // FR-SEL-08 / TBD-18: the AI rank at decision time and whether the decision overrides it.
    const [ai] = await tx<{ rank: number | null; cutLine: number | null }[]>`
      select r.rank, run.cut_line as "cutLine" from ranking_results r join ranking_runs run on run.id = r.run_id
      where r.application_id = ${id} and run.status = 'completed' order by run.seq desc limit 1`;
    const rank = ai?.rank ?? null;
    const cutLine = edition.selectionLimit ?? ai?.cutLine ?? null;
    const isOverride = overrideOf(input.outcome, rank, cutLine);
    if (isOverride && !input.reason?.trim()) {
      throw new AppError(422, "override_reason_required", "Give a reason for this override",
        `The AI ranked this application ${rank} with a cut line of ${cutLine}. ${input.outcome === "selected" ? "Selecting" : "Not selecting"} it overrides the ranking, which needs a written reason (TBD-18).`,
        { rank, cutLine });
    }
    await tx`
      insert into selection_decisions (application_id, outcome, status_before_decision, decided_by, ai_rank_at_decision, is_override, cut_line_at_decision, reason)
      values (${id}, ${input.outcome}, ${app.status}, ${p.account!.id}, ${rank}, ${isOverride}, ${cutLine}, ${input.reason?.trim() || null})
      on conflict (application_id) do update
        set outcome = excluded.outcome, decided_by = excluded.decided_by, decided_at = now(), ai_rank_at_decision = excluded.ai_rank_at_decision,
            is_override = excluded.is_override, cut_line_at_decision = excluded.cut_line_at_decision, reason = excluded.reason`;
    await tx`update applications set status = 'decision_drafted' where id = ${id}`;
    await audit(tx, { actorUserId: p.account!.id, action: "decision.drafted", entityType: "application", entityId: id,
      editionId: app.edition, data: { outcome: input.outcome, reason: input.reason?.trim() || null, aiRank: rank, cutLine, isOverride } });
  });
  return getApplication(sql, id);
}

export async function withdrawDraft(sql: Sql, p: Principal, id: string): Promise<ManageApplication> {
  await sql.begin(async (tx) => {
    const [d] = await tx<{ releasedAt: Date | null; before: InternalStatus; edition: number }[]>`
      select d.released_at as "releasedAt", d.status_before_decision as before, a.edition_id as edition
      from selection_decisions d join applications a on a.id = d.application_id where d.application_id = ${id} for update`;
    if (!d) throw new AppError(404, "no_draft", "Not found", "There is no draft decision for this application");
    if (d.releasedAt) throw new AppError(409, "decision_released", "Decision already released",
      "Released decisions cannot be withdrawn. Request a correction instead; it needs a second Management approver (TBD-37).");
    // The status from before the draft, unless a ranking run finished in the meantime: then its outcome applies.
    const [ai] = await tx<{ state: string }[]>`
      select r.state from ranking_results r join ranking_runs run on run.id = r.run_id
      where r.application_id = ${id} and run.status = 'completed' order by run.seq desc limit 1`;
    const back: InternalStatus = ai ? (ai.state === "scored" ? "ranked" : "flagged_manual_review")
      : d.before === "under_ai_evaluation" ? "submitted" : d.before;
    await tx`delete from selection_decisions where application_id = ${id}`;
    await tx`update applications set status = ${back} where id = ${id}`;
    await audit(tx, { actorUserId: p.account!.id, action: "decision.draft_withdrawn", entityType: "application", entityId: id, editionId: d.edition });
  });
  return getApplication(sql, id);
}

type Leader = { leaderId: string; email: string | null; mobile: string | null };

async function grantAccess(tx: Db, leaderId: string, year: number, by: string) {
  // FR-REG-09 / FR-SEL-05: only management-selected applicants gain access to this edition. Team members get
  // accounts only after selection, added by the Admin (TBD-16).
  await tx`
    insert into edition_access (user_id, edition_id, source, granted_by)
    select ${leaderId}, ${year}, 'selected', ${by}
    where exists (select 1 from user_accounts where id = ${leaderId} and status <> 'deactivated')
    on conflict (user_id, edition_id) do update set revoked_at = null, granted_by = excluded.granted_by, granted_at = now()
      where edition_access.source = 'selected' and edition_access.revoked_at is not null`;
}

async function revokeSelectedAccess(tx: Db, leaderId: string, year: number) {
  await tx`update edition_access set revoked_at = now()
           where user_id = ${leaderId} and edition_id = ${year} and source = 'selected' and revoked_at is null`;
}

/**
 * Releases drafted decisions: applicants see the outcome, selected leaders gain edition access, everyone is notified
 * in-app and by one message to their verified contact (TBD-14). TBD-19: a release that would take the edition above
 * its selection limit is refused unless the manager confirms it explicitly; a confirmed over-limit release is audited.
 */
export async function releaseDecisions(
  sql: Sql, p: Principal, year: number, ids: string[] | undefined, opts: { confirmOverLimit?: boolean; now: Date; webUrl: string },
): Promise<ReleaseResponse> {
  await assertRegistrationClosed(sql, year, opts.now);
  return sql.begin(async (tx) => {
    // Serialise releases per edition so two managers cannot both pass the limit check at the same time.
    const [locked] = await tx<{ selectionLimit: number | null }[]>`
      select selection_limit as "selectionLimit" from event_editions where id = ${year} for update`;
    const limit = locked?.selectionLimit ?? null;
    const drafts = await tx<({ id: string; outcome: "selected" | "not_selected"; startupId: string; startupName: string } & Leader)[]>`
      select a.id, d.outcome, s.id as "startupId", s.name as "startupName", m.user_id as "leaderId", u.email, u.mobile_e164 as mobile
      from selection_decisions d
      join applications a on a.id = d.application_id
      join startups s on s.id = a.startup_id
      join startup_memberships m on m.startup_id = s.id and m.position = 'leader'
      join user_accounts u on u.id = m.user_id
      where a.edition_id = ${year} and d.released_at is null and a.status <> 'withdrawn'
        ${ids ? tx`and a.id in ${tx(ids)}` : tx``}
      for update of d, a`;
    if (ids && drafts.length !== ids.length) {
      throw new AppError(409, "not_releasable", "Some applications have no unreleased draft decision",
        "Release only applications that have a draft decision in this edition.");
    }
    const [already] = await tx<{ n: number }[]>`
      select count(*)::int as n from applications where edition_id = ${year} and status = 'selected'`;
    const adding = drafts.filter((d) => d.outcome === "selected").length;
    const selectedAfter = (already?.n ?? 0) + adding;
    // Only a release that adds selections can push the edition over the limit; releasing "not selected" never needs it.
    const overLimit = limit !== null && adding > 0 && selectedAfter > limit;
    if (overLimit && !opts.confirmOverLimit) {
      throw new AppError(409, "selection_limit_exceeded", "Above the selection limit",
        `Releasing these decisions would make ${selectedAfter} startups selected for ${year}, above the configured limit of ${limit}. ` +
        "Confirm explicitly to release anyway, or change the drafts or the limit.", { limit, selectedAfterRelease: selectedAfter });
    }
    if (overLimit) {
      await audit(tx, { actorUserId: p.account!.id, action: "selection.limit_exceeded_confirmed", entityType: "event_edition",
        entityId: String(year), editionId: year, data: { limit, selectedAfterRelease: selectedAfter, released: drafts.length } });
    }
    let selected = 0;
    for (const d of drafts) {
      await tx`update selection_decisions set released_at = now(), released_by = ${p.account!.id} where application_id = ${d.id}`;
      await tx`update applications set status = ${d.outcome} where id = ${d.id}`;
      if (d.outcome === "selected") {
        selected += 1;
        await grantAccess(tx, d.leaderId, year, p.account!.id);
      }
      const [later] = await tx<{ n: number }[]>`
        select count(*)::int as n from applications where startup_id = ${d.startupId} and edition_id > ${year} and status <> 'withdrawn'`;
      const msg = resultMessage({ outcome: d.outcome, year, startupName: d.startupName, hasLaterApplication: (later?.n ?? 0) > 0 });
      await notifyInApp(tx, { userId: d.leaderId, editionId: year, ...msg, idempotencyKey: `decision-released:${d.id}` });
      const channel = await enqueue(tx, {
        userId: d.leaderId, editionId: year, kind: "selection_result", email: d.email, mobile: d.mobile, subject: msg.title,
        emailBody: `${msg.body}\n\nSign in at ${opts.webUrl}/status to see your application.`,
        smsBody: TEMPLATES.result.sms({ year, url: opts.webUrl }), payload: { year, url: opts.webUrl },
        idempotencyKey: `decision-released:${d.id}`,
      }, opts.now);
      await audit(tx, { actorUserId: p.account!.id, action: "decision.released", entityType: "application", entityId: d.id,
        editionId: year, data: { outcome: d.outcome, notification: channel ? ["in_app", channel] : ["in_app"] } });
    }
    const warnings: string[] = [];
    if (limit !== null) {
      const [n] = await tx<{ n: number }[]>`
        select count(*)::int as n from applications where edition_id = ${year} and status = 'selected'`;
      if ((n?.n ?? 0) > limit) {
        warnings.push(`${n!.n} startups are now selected for ${year}, above the configured limit of ${limit} (confirmed by you).`);
      }
    }
    return { released: drafts.length, selected, notSelected: drafts.length - selected, warnings };
  });
}

export async function setSelectionLimit(sql: Sql, p: Principal, year: number, limit: number | null) {
  await getEdition(sql, year);
  await sql.begin(async (tx) => {
    await tx`update event_editions set selection_limit = ${limit} where id = ${year}`;
    await audit(tx, { actorUserId: p.account!.id, action: "edition.selection_limit_set", entityType: "event_edition",
      entityId: String(year), editionId: year, data: { limit } });
  });
  return { edition: year, selectionLimit: limit };
}

// ---------------------------------------------------------------- corrections (TBD-37)
export async function listCorrections(db: Db, year: number, status?: DecisionCorrection["status"]): Promise<DecisionCorrection[]> {
  await getEdition(db, year);
  const rows = await db<CorrectionRow[]>`${CORRECTION_SELECT(db)} where a.edition_id = ${year}
    ${status ? db`and c.status = ${status}` : db``} order by c.requested_at desc`;
  return rows.map(toCorrection);
}

/** Step 1 of 2: a Management member asks to change a released decision, with a written reason. */
export async function requestCorrection(sql: Sql, p: Principal, applicationId: string, input: { outcome: "selected" | "not_selected"; reason: string }) {
  await sql.begin(async (tx) => {
    const [d] = await tx<{ outcome: "selected" | "not_selected"; releasedAt: Date | null; status: InternalStatus; edition: number }[]>`
      select d.outcome, d.released_at as "releasedAt", a.status, a.edition_id as edition
      from selection_decisions d join applications a on a.id = d.application_id where d.application_id = ${applicationId}
      for update of d`;
    if (!d || !d.releasedAt) throw new AppError(409, "not_released", "No released decision", "Only a released decision can be corrected. Edit the draft instead.");
    if (d.status === "withdrawn") throw new AppError(409, "application_withdrawn", "Application withdrawn", "The applicant has withdrawn this application.");
    if (d.outcome === input.outcome) throw new AppError(409, "same_outcome", "Nothing to correct", `The released decision is already "${d.outcome.replace("_", " ")}".`);
    const [pending] = await tx`select 1 from decision_corrections where application_id = ${applicationId} and status = 'pending'`;
    if (pending) throw new AppError(409, "correction_pending", "A correction is already pending", "Approve, reject or cancel the pending correction first.");
    const [c] = await tx<{ id: string }[]>`
      insert into decision_corrections (application_id, from_outcome, to_outcome, reason, requested_by)
      values (${applicationId}, ${d.outcome}, ${input.outcome}, ${input.reason.trim()}, ${p.account!.id}) returning id`;
    await audit(tx, { actorUserId: p.account!.id, action: "decision.correction_requested", entityType: "application", entityId: applicationId,
      editionId: d.edition, data: { correctionId: c!.id, from: d.outcome, to: input.outcome, reason: input.reason.trim() } });
  });
  return getApplication(sql, applicationId);
}

async function lockPending(tx: Db, id: string) {
  const [c] = await tx<{ applicationId: string; requestedBy: string; status: string; fromOutcome: "selected" | "not_selected"; toOutcome: "selected" | "not_selected"; reason: string }[]>`
    select application_id as "applicationId", requested_by as "requestedBy", status, from_outcome as "fromOutcome", to_outcome as "toOutcome", reason
    from decision_corrections where id = ${id} for update`;
  if (!c) throw notFound("Correction");
  if (c.status !== "pending") throw new AppError(409, "correction_closed", "Correction already closed", `This correction is ${c.status}.`);
  return c;
}

/** Step 2 of 2: a DIFFERENT Management member approves; the decision changes, access follows, the applicant is told. */
export async function approveCorrection(sql: Sql, p: Principal, id: string, note: string | undefined, opts: { now: Date; webUrl: string }) {
  const applicationId = await sql.begin(async (tx) => {
    const c = await lockPending(tx, id);
    if (c.requestedBy === p.account!.id) {
      throw new AppError(403, "second_person_required", "A second person must approve",
        "A different Management member must approve a correction you requested (TBD-37).");
    }
    const [d] = await tx<({ outcome: string; edition: number; startupName: string; status: InternalStatus } & Leader)[]>`
      select d.outcome, a.edition_id as edition, s.name as "startupName", a.status, m.user_id as "leaderId", u.email, u.mobile_e164 as mobile
      from selection_decisions d join applications a on a.id = d.application_id join startups s on s.id = a.startup_id
      join startup_memberships m on m.startup_id = s.id and m.position = 'leader' join user_accounts u on u.id = m.user_id
      where d.application_id = ${c.applicationId} for update of d, a`;
    if (!d || d.outcome !== c.fromOutcome || d.status === "withdrawn") {
      throw new AppError(409, "correction_stale", "The decision has changed", "This correction no longer matches the released decision.");
    }
    await tx`
      update decision_corrections set status = 'applied', reviewed_by = ${p.account!.id}, reviewed_at = clock_timestamp(), review_note = ${note ?? null}
      where id = ${id}`;
    // corrected_at must equal the correction's review time exactly (microseconds): the DB trigger checks it.
    await tx`
      update selection_decisions d set outcome = ${c.toOutcome}, decided_by = ${c.requestedBy}, decided_at = c.reviewed_at, corrected_at = c.reviewed_at
      from decision_corrections c where c.id = ${id} and d.application_id = ${c.applicationId}`;
    await tx`update applications set status = ${c.toOutcome} where id = ${c.applicationId}`;
    if (c.toOutcome === "selected") await grantAccess(tx, d.leaderId, d.edition, p.account!.id);
    else await revokeSelectedAccess(tx, d.leaderId, d.edition);
    const [later] = await tx<{ n: number }[]>`
      select count(*)::int as n from applications a2 join applications a1 on a1.startup_id = a2.startup_id
      where a1.id = ${c.applicationId} and a2.edition_id > a1.edition_id and a2.status <> 'withdrawn'`;
    const msg = correctionMessage({ outcome: c.toOutcome, year: d.edition, startupName: d.startupName, hasLaterApplication: (later?.n ?? 0) > 0 });
    await notifyInApp(tx, { userId: d.leaderId, editionId: d.edition, ...msg, idempotencyKey: `decision-corrected:${id}` });
    const channel = await enqueue(tx, {
      userId: d.leaderId, editionId: d.edition, kind: "decision_corrected", email: d.email, mobile: d.mobile, subject: msg.title,
      emailBody: `${msg.body}\n\nSign in at ${opts.webUrl}/status to see your application.`,
      smsBody: TEMPLATES.correction.sms({ year: d.edition, url: opts.webUrl }), payload: { year: d.edition, url: opts.webUrl },
      idempotencyKey: `decision-corrected:${id}`,
    }, opts.now);
    await audit(tx, { actorUserId: p.account!.id, action: "decision.correction_applied", entityType: "application", entityId: c.applicationId,
      editionId: d.edition, data: { correctionId: id, from: c.fromOutcome, to: c.toOutcome, requestedBy: c.requestedBy, note: note ?? null,
        notification: channel ? ["in_app", channel] : ["in_app"] } });
    return c.applicationId;
  });
  return getApplication(sql, applicationId);
}

export async function rejectCorrection(sql: Sql, p: Principal, id: string, note: string | undefined) {
  const applicationId = await sql.begin(async (tx) => {
    const c = await lockPending(tx, id);
    if (c.requestedBy === p.account!.id) {
      throw new AppError(403, "second_person_required", "A second person must decide", "Cancel your own request instead of rejecting it.");
    }
    await tx`update decision_corrections set status = 'rejected', reviewed_by = ${p.account!.id}, reviewed_at = clock_timestamp(), review_note = ${note ?? null}
             where id = ${id}`;
    const [a] = await tx<{ edition: number }[]>`select edition_id as edition from applications where id = ${c.applicationId}`;
    await audit(tx, { actorUserId: p.account!.id, action: "decision.correction_rejected", entityType: "application", entityId: c.applicationId,
      editionId: a!.edition, data: { correctionId: id, note: note ?? null } });
    return c.applicationId;
  });
  return getApplication(sql, applicationId);
}

export async function cancelCorrection(sql: Sql, p: Principal, id: string) {
  const applicationId = await sql.begin(async (tx) => {
    const c = await lockPending(tx, id);
    if (c.requestedBy !== p.account!.id) {
      throw new AppError(403, "not_requester", "Only the requester can cancel", "Reject the correction instead, with a note.");
    }
    await tx`update decision_corrections set status = 'cancelled', reviewed_at = clock_timestamp() where id = ${id}`;
    const [a] = await tx<{ edition: number }[]>`select edition_id as edition from applications where id = ${c.applicationId}`;
    await audit(tx, { actorUserId: p.account!.id, action: "decision.correction_cancelled", entityType: "application", entityId: c.applicationId,
      editionId: a!.edition, data: { correctionId: id } });
    return c.applicationId;
  });
  return getApplication(sql, applicationId);
}

export { revokeSelectedAccess };
