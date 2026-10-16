// Volunteer assignment (PRD §9, FR-VOL-*, DC-04…07; decisions TBD-22, -23, -48, -49 in docs/DECISIONS.md).
// Each volunteer gets exactly one target, one startup OR one jury member, never both and never two; each target at
// most one volunteer. The database enforces this (0002 constraints and unique indexes, 0010 triggers); every mutation
// here also locks the edition row so concurrent generate / approve / assign / reassign requests run one at a time.
// A shortage is reported as unassigned targets, never hidden by doubling up. Reassignments close the old row and
// create a new one (history is never overwritten) with who, when and why.
import type { MyVolunteer, MyVolunteerAssignment, VolunteerAssignmentItem, VolunteerOverview, VolunteerRun, VolunteerTarget, VolunteerTargetRef } from "@sj/contracts";
import { isUniqueViolation, ruleViolation, type Db, type Sql } from "../../db/client.js";
import { audit } from "../../platform/audit.js";
import { AppError, notFound } from "../../platform/errors.js";
import type { Principal } from "../../platform/principal.js";
import { getEdition } from "../editions/service.js";
import { enqueue, TEMPLATES, type VolunteerMessageKind } from "../notifications/outbox.js";
import { notifyInApp } from "../notifications/service.js";
import { newSeed, pairUp, type Target } from "./shuffle.js";

// ---------------------------------------------------------------- pools (TBD-22: no priority, random)
type Person = { id: string; name: string };

async function freeVolunteers(db: Db, year: number): Promise<Person[]> {
  return db<Person[]>`
    select u.id, u.full_name as name from user_accounts u
    where sj_person_in_edition(u.id, 'volunteer', ${year}::smallint)
      and not exists (select 1 from volunteer_assignments va where va.edition_id = ${year} and va.volunteer_user_id = u.id and va.state <> 'closed')
    order by u.id`;
}

/** TBD-22 target pool: every startup taking part in the edition and every jury member, without an open volunteer. */
async function freeTargets(db: Db, year: number): Promise<VolunteerTarget[]> {
  const startups = await db<{ id: string; name: string }[]>`
    select s.id, s.name from startups s
    where sj_startup_in_edition(s.id, ${year}::smallint)
      and not exists (select 1 from volunteer_assignments va where va.edition_id = ${year} and va.target_startup_id = s.id and va.state <> 'closed')
    order by s.id`;
  const jurors = await db<{ id: string; name: string }[]>`
    select u.id, u.full_name as name from user_accounts u
    where sj_person_in_edition(u.id, 'jury_member', ${year}::smallint)
      and not exists (select 1 from volunteer_assignments va where va.edition_id = ${year} and va.target_jury_user_id = u.id and va.state <> 'closed')
    order by u.id`;
  return [...startups.map((s) => ({ type: "startup" as const, ...s })), ...jurors.map((j) => ({ type: "jury" as const, ...j }))];
}

/** One mutation at a time per edition: generation, approval, manual assignment, reassignment and closing. */
async function lockEdition(tx: Db, year: number) {
  const [e] = await tx`select id from event_editions where id = ${year} for update`;
  if (!e) throw new AppError(404, "edition_not_found", "Not found", `There is no ${year} edition`);
}

// ---------------------------------------------------------------- reading assignments
type Row = {
  id: string; edition: number; state: "draft" | "active" | "closed"; volunteerId: string; volunteerName: string;
  startupId: string | null; startupName: string | null; juryId: string | null; juryName: string | null; runId: string | null;
  createdBy: string; createdAt: Date; reason: string | null; activatedAt: Date | null; closedAt: Date | null; closedBy: string | null;
  closeReason: string | null; replacesId: string | null;
};

const SELECT = (db: Db) => db`
  select va.id, va.edition_id as edition, va.state, va.volunteer_user_id as "volunteerId", vu.full_name as "volunteerName",
         va.target_startup_id as "startupId", s.name as "startupName", va.target_jury_user_id as "juryId", ju.full_name as "juryName",
         va.run_id as "runId", cu.full_name as "createdBy", va.created_at as "createdAt", va.reason, va.activated_at as "activatedAt",
         va.closed_at as "closedAt", xu.full_name as "closedBy", va.close_reason as "closeReason", va.replaces_id as "replacesId"
  from volunteer_assignments va
  join user_accounts vu on vu.id = va.volunteer_user_id
  join user_accounts cu on cu.id = va.created_by
  left join startups s on s.id = va.target_startup_id
  left join user_accounts ju on ju.id = va.target_jury_user_id
  left join user_accounts xu on xu.id = va.closed_by`;

async function hydrate(db: Db, rows: Row[]): Promise<VolunteerAssignmentItem[]> {
  const ids = rows.map((r) => r.id);
  const notes = ids.length
    ? await db<{ key: string; channel: string; status: string; sentAt: Date | null }[]>`
        select idempotency_key as key, channel, status, sent_at as "sentAt" from notifications
        where idempotency_key like any (${db.array(ids.map((i) => `vol:${i}:%`))}::text[]) order by created_at`
    : [];
  return rows.map((r) => ({
    id: r.id, edition: r.edition, state: r.state,
    volunteer: { id: r.volunteerId, name: r.volunteerName },
    target: r.startupId ? { type: "startup", id: r.startupId, name: r.startupName! } : { type: "jury", id: r.juryId!, name: r.juryName! },
    runId: r.runId, createdBy: r.createdBy, createdAt: r.createdAt.toISOString(), reason: r.reason,
    activatedAt: r.activatedAt?.toISOString() ?? null, closedAt: r.closedAt?.toISOString() ?? null, closedBy: r.closedBy,
    closeReason: r.closeReason, replacesId: r.replacesId,
    notifications: notes.filter((n) => n.key.startsWith(`vol:${r.id}:`)).map((n) => ({
      recipient: n.key.split(":")[2]!.includes("volunteer") ? "volunteer" as const : "target" as const,
      channel: n.channel, status: n.status, sentAt: n.sentAt?.toISOString() ?? null,
    })),
  }));
}

type RunRow = {
  id: string; edition: number; state: "draft" | "approved" | "discarded"; seed: string; startedBy: string; createdAt: Date; reviewedBy: string | null;
  reviewedAt: Date | null; volunteerCount: number; targetCount: number; unassignedTargets: VolunteerTargetRef[]; unassignedVolunteers: string[];
};
const RUN_SELECT = (db: Db) => db`
  select r.id, r.edition_id as edition, r.state, r.seed, su.full_name as "startedBy", r.created_at as "createdAt", vu.full_name as "reviewedBy",
         r.reviewed_at as "reviewedAt", r.volunteer_count as "volunteerCount", r.target_count as "targetCount",
         r.unassigned_targets as "unassignedTargets", r.unassigned_volunteers as "unassignedVolunteers"
  from assignment_runs r join user_accounts su on su.id = r.started_by left join user_accounts vu on vu.id = r.reviewed_by`;

async function names(db: Db, refs: VolunteerTargetRef[], people: string[]) {
  const startupIds = refs.filter((r) => r.type === "startup").map((r) => r.id);
  const userIds = [...refs.filter((r) => r.type === "jury").map((r) => r.id), ...people];
  const s = startupIds.length ? await db<{ id: string; name: string }[]>`select id, name from startups where id in ${db(startupIds)}` : [];
  const u = userIds.length ? await db<{ id: string; name: string }[]>`select id, full_name as name from user_accounts where id in ${db(userIds)}` : [];
  const sn = new Map(s.map((x) => [x.id, x.name]));
  const un = new Map(u.map((x) => [x.id, x.name]));
  return {
    targets: refs.map((r) => ({ ...r, name: (r.type === "startup" ? sn.get(r.id) : un.get(r.id)) ?? "?" })),
    people: people.map((id) => ({ id, name: un.get(id) ?? "?" })),
  };
}

async function toRun(db: Db, r: RunRow): Promise<VolunteerRun> {
  const pairs = await hydrate(db, await db<Row[]>`${SELECT(db)} where va.run_id = ${r.id} order by vu.full_name`);
  const n = await names(db, r.unassignedTargets, r.unassignedVolunteers);
  return {
    id: r.id, edition: r.edition, state: r.state, seed: r.seed, startedBy: r.startedBy, createdAt: r.createdAt.toISOString(),
    reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt?.toISOString() ?? null, volunteerCount: r.volunteerCount, targetCount: r.targetCount,
    pairs, unassignedTargets: n.targets, surplusVolunteers: n.people,
  };
}

export async function getRun(db: Db, id: string): Promise<VolunteerRun> {
  const [r] = await db<RunRow[]>`${RUN_SELECT(db)} where r.id = ${id}`;
  if (!r) throw notFound("Assignment run");
  return toRun(db, r);
}

export async function volunteerOverview(db: Db, year: number): Promise<VolunteerOverview> {
  await getEdition(db, year);
  const runs = await db<(RunRow & { pairs: number })[]>`
    select r.id, r.state, r.created_at as "createdAt", su.full_name as "startedBy", vu.full_name as "reviewedBy",
           r.unassigned_targets as "unassignedTargets", r.unassigned_volunteers as "unassignedVolunteers",
           (select count(*)::int from volunteer_assignments va where va.run_id = r.id) as pairs
    from assignment_runs r join user_accounts su on su.id = r.started_by left join user_accounts vu on vu.id = r.reviewed_by
    where r.edition_id = ${year} order by r.created_at desc`;
  const draft = runs.find((r) => r.state === "draft");
  const [draftRun] = draft ? await db<RunRow[]>`${RUN_SELECT(db)} where r.id = ${draft.id}` : [];
  const active = await db<Row[]>`${SELECT(db)} where va.edition_id = ${year} and va.state = 'active' order by vu.full_name`;
  // History: assignments that were in force and are now closed (discarded drafts never were; their run keeps them).
  const history = await db<Row[]>`${SELECT(db)} where va.edition_id = ${year} and va.state = 'closed' and va.activated_at is not null
    order by va.closed_at desc`;
  return {
    edition: year,
    draftRun: draftRun ? await toRun(db, draftRun) : null,
    runs: runs.map((r) => ({
      id: r.id, state: r.state, createdAt: r.createdAt.toISOString(), startedBy: r.startedBy, reviewedBy: r.reviewedBy, pairs: r.pairs,
      unassignedTargets: r.unassignedTargets.length, surplusVolunteers: r.unassignedVolunteers.length,
    })),
    active: await hydrate(db, active),
    unassignedTargets: await freeTargets(db, year),
    freeVolunteers: await freeVolunteers(db, year),
    history: await hydrate(db, history),
  };
}

// ---------------------------------------------------------------- generation and review (FR-VOL-04…07, -11, -16)
/** Generates a DRAFT run: invisible to participants until Management saves it. One draft per edition. */
export async function generateRun(sql: Sql, p: Principal, year: number): Promise<VolunteerRun> {
  await getEdition(sql, year);
  let runId: string;
  try {
    runId = await sql.begin(async (tx) => {
      await lockEdition(tx, year);
      const [draft] = await tx`select 1 from assignment_runs where edition_id = ${year} and state = 'draft'`;
      if (draft) throw new AppError(409, "draft_run_exists", "A draft is waiting for review", "Save or discard the current draft before generating another.");
      const volunteers = await freeVolunteers(tx, year);
      const targets = await freeTargets(tx, year);
      if (!volunteers.length && !targets.length) {
        throw new AppError(409, "nothing_to_assign", "Nothing to assign", `Every ${year} volunteer and target already has an assignment, or none have been imported.`);
      }
      const seed = newSeed();
      const inputs = { volunteers: volunteers.map((v) => v.id), targets: targets.map((t): Target => ({ type: t.type, id: t.id })) };
      const r = pairUp(inputs.volunteers, inputs.targets, seed);
      const [run] = await tx<{ id: string }[]>`
        insert into assignment_runs (edition_id, seed, volunteer_count, target_count, unassigned_targets, unassigned_volunteers, inputs, started_by)
        values (${year}, ${seed}, ${volunteers.length}, ${targets.length}, ${tx.json(r.unassignedTargets as never)},
                ${tx.json(r.surplusVolunteers as never)}, ${tx.json(inputs as never)}, ${p.account!.id})
        returning id`;
      for (const pair of r.pairs) {
        await tx`
          insert into volunteer_assignments (edition_id, run_id, volunteer_user_id, target_startup_id, target_jury_user_id, state, created_by)
          values (${year}, ${run!.id}, ${pair.volunteer}, ${pair.target.type === "startup" ? pair.target.id : null},
                  ${pair.target.type === "jury" ? pair.target.id : null}, 'draft', ${p.account!.id})`;
      }
      await audit(tx, { actorUserId: p.account!.id, action: "volunteer.run_generated", entityType: "assignment_run", entityId: run!.id, editionId: year,
        data: { seed, volunteers: volunteers.length, targets: targets.length, pairs: r.pairs.length,
          unassignedTargets: r.unassignedTargets.length, surplusVolunteers: r.surplusVolunteers.length } });
      return run!.id;
    });
  } catch (err) {
    if (isUniqueViolation(err, "assignment_one_draft_run")) {
      throw new AppError(409, "draft_run_exists", "A draft is waiting for review", "Save or discard the current draft before generating another.");
    }
    throw err;
  }
  return getRun(sql, runId);
}

type Party = { userId: string; email: string | null; mobile: string | null };

/** The person a target stands for: the startup's leader, or the jury member. */
async function targetParty(db: Db, t: { startupId: string | null; juryId: string | null }): Promise<Party | null> {
  const [x] = t.startupId
    ? await db<Party[]>`select u.id as "userId", u.email, u.mobile_e164 as mobile from startup_memberships m join user_accounts u on u.id = m.user_id
                        where m.startup_id = ${t.startupId} and m.position = 'leader'`
    : await db<Party[]>`select id as "userId", email, mobile_e164 as mobile from user_accounts where id = ${t.juryId}`;
  return x ?? null;
}

async function party(db: Db, userId: string): Promise<Party> {
  const [x] = await db<Party[]>`select id as "userId", email, mobile_e164 as mobile from user_accounts where id = ${userId}`;
  return x!;
}

/**
 * FR-VOL-08: in-app notice (delivered to the app inbox at once) plus one queued email/SMS to the person's contact on
 * file. Queued messages stay "queued" until a provider actually accepts them; nothing is reported as sent before that.
 * DRAFT wording, awaiting Management approval (TBD-48).
 */
async function tell(tx: Db, o: { to: Party; year: number; kind: VolunteerMessageKind; title: string; body: string; key: string; now: Date; webUrl: string }) {
  await notifyInApp(tx, { userId: o.to.userId, editionId: o.year, kind: o.kind, title: o.title, body: o.body, idempotencyKey: o.key });
  await enqueue(tx, {
    userId: o.to.userId, editionId: o.year, kind: o.kind, email: o.to.email, mobile: o.to.mobile, subject: o.title,
    emailBody: `${o.body}\n\nOpen the Startup Jathara app or ${o.webUrl} to see the details.`,
    smsBody: TEMPLATES.assignment.sms({ year: o.year, url: o.webUrl }), payload: { year: o.year, url: o.webUrl }, idempotencyKey: o.key,
  }, o.now);
}

type Live = { id: string; volunteerId: string; volunteerName: string; startupId: string | null; juryId: string | null; targetName: string };

async function announce(tx: Db, a: Live, year: number, now: Date, webUrl: string) {
  const volunteer = await party(tx, a.volunteerId);
  await tell(tx, { to: volunteer, year, kind: "volunteer_assigned", now, webUrl, key: `vol:${a.id}:volunteer`,
    title: `Your Startup Jathara ${year} volunteer assignment`,
    body: `You are the volunteer for ${a.startupId ? `the startup ${a.targetName}` : `the jury member ${a.targetName}`} at Startup Jathara ${year}.` });
  const target = await targetParty(tx, a);
  if (target) {
    await tell(tx, { to: target, year, kind: "volunteer_for_you", now, webUrl, key: `vol:${a.id}:target`,
      title: `Your volunteer for Startup Jathara ${year}`,
      body: `${a.volunteerName} is ${a.startupId ? `your startup's` : "your"} volunteer for Startup Jathara ${year}.` });
  }
}

async function announceEnd(tx: Db, a: Live, year: number, now: Date, webUrl: string, o: { volunteer: boolean; target: boolean }) {
  if (o.volunteer) {
    await tell(tx, { to: await party(tx, a.volunteerId), year, kind: "volunteer_assignment_ended", now, webUrl, key: `vol:${a.id}:closed-volunteer`,
      title: `Your Startup Jathara ${year} volunteer assignment has changed`,
      body: `You are no longer the volunteer for ${a.targetName}. Check the app for your current assignment, if any.` });
  }
  const target = o.target ? await targetParty(tx, a) : null;
  if (target) {
    await tell(tx, { to: target, year, kind: "volunteer_removed", now, webUrl, key: `vol:${a.id}:closed-target`,
      title: `Your Startup Jathara ${year} volunteer has changed`,
      body: `${a.volunteerName} is no longer ${a.startupId ? "your startup's" : "your"} volunteer. Check the app for your current volunteer, if any.` });
  }
}

const LIVE = (db: Db) => db`
  select va.id, va.volunteer_user_id as "volunteerId", vu.full_name as "volunteerName", va.target_startup_id as "startupId",
         va.target_jury_user_id as "juryId", coalesce(s.name, ju.full_name) as "targetName"
  from volunteer_assignments va join user_accounts vu on vu.id = va.volunteer_user_id
  left join startups s on s.id = va.target_startup_id left join user_accounts ju on ju.id = va.target_jury_user_id`;

function ruleConflict(err: unknown): never {
  const hint = ruleViolation(err);
  if (hint) {
    throw new AppError(409, "assignment_not_valid", "An assignment is no longer valid",
      `A volunteer or target no longer takes part in the event, or the assignment breaks a rule (${hint}). Nothing was changed.`);
  }
  if (isUniqueViolation(err)) {
    throw new AppError(409, "already_assigned", "Already assigned", "That volunteer or target already has an assignment. Nothing was changed.");
  }
  throw err;
}

/** FR-VOL-07/-08: Management saves the reviewed draft; only now do participants see it, and both parties are told. */
export async function approveRun(sql: Sql, p: Principal, id: string, opts: { now: Date; webUrl: string }): Promise<VolunteerRun> {
  try {
    await sql.begin(async (tx) => {
      const [r] = await tx<{ edition: number; state: string }[]>`select edition_id as edition, state from assignment_runs where id = ${id}`;
      if (!r) throw notFound("Assignment run");
      await lockEdition(tx, r.edition);
      const [cur] = await tx<{ state: string }[]>`select state from assignment_runs where id = ${id} for update`;
      if (cur!.state !== "draft") throw new AppError(409, "run_closed", "Run already reviewed", `This run is ${cur!.state}.`);
      const activated = await tx<{ id: string }[]>`
        update volunteer_assignments set state = 'active', activated_at = now(), activated_by = ${p.account!.id}
        where run_id = ${id} and state = 'draft' returning id`;
      await tx`update assignment_runs set state = 'approved', reviewed_by = ${p.account!.id}, reviewed_at = now() where id = ${id}`;
      const live = activated.length ? await tx<Live[]>`${LIVE(tx)} where va.id in ${tx(activated.map((a) => a.id))}` : [];
      for (const a of live) await announce(tx, a, r.edition, opts.now, opts.webUrl);
      await audit(tx, { actorUserId: p.account!.id, action: "volunteer.run_approved", entityType: "assignment_run", entityId: id, editionId: r.edition,
        data: { activated: activated.length } });
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    ruleConflict(err);
  }
  return getRun(sql, id);
}

export async function discardRun(sql: Sql, p: Principal, id: string): Promise<VolunteerRun> {
  await sql.begin(async (tx) => {
    const [r] = await tx<{ edition: number }[]>`select edition_id as edition from assignment_runs where id = ${id}`;
    if (!r) throw notFound("Assignment run");
    await lockEdition(tx, r.edition);
    const [cur] = await tx<{ state: string }[]>`select state from assignment_runs where id = ${id} for update`;
    if (cur!.state !== "draft") throw new AppError(409, "run_closed", "Run already reviewed", `This run is ${cur!.state}.`);
    await tx`update volunteer_assignments set state = 'closed', closed_at = now(), closed_by = ${p.account!.id}, close_reason = 'Draft discarded'
             where run_id = ${id} and state = 'draft'`;
    await tx`update assignment_runs set state = 'discarded', reviewed_by = ${p.account!.id}, reviewed_at = now() where id = ${id}`;
    await audit(tx, { actorUserId: p.account!.id, action: "volunteer.run_discarded", entityType: "assignment_run", entityId: id, editionId: r.edition });
  });
  return getRun(sql, id);
}

// ---------------------------------------------------------------- manual changes (FR-VOL-09; TBD-23)
async function checkVolunteerFree(tx: Db, year: number, volunteerId: string) {
  const [v] = await tx<{ eligible: boolean; busy: boolean }[]>`
    select sj_person_in_edition(${volunteerId}, 'volunteer', ${year}::smallint) as eligible,
           exists (select 1 from volunteer_assignments where edition_id = ${year} and volunteer_user_id = ${volunteerId} and state <> 'closed') as busy`;
  if (!v!.eligible) throw new AppError(409, "not_a_volunteer", "Not a volunteer", `This person is not a volunteer of the ${year} event.`);
  if (v!.busy) throw new AppError(409, "volunteer_busy", "Volunteer already assigned", "A volunteer has exactly one assignment. Reassign or close the current one first.");
}

async function checkTargetFree(tx: Db, year: number, t: VolunteerTargetRef) {
  const [x] = t.type === "startup"
    ? await tx<{ eligible: boolean; busy: boolean }[]>`
        select sj_startup_in_edition(${t.id}, ${year}::smallint) as eligible,
               exists (select 1 from volunteer_assignments where edition_id = ${year} and target_startup_id = ${t.id} and state <> 'closed') as busy`
    : await tx<{ eligible: boolean; busy: boolean }[]>`
        select sj_person_in_edition(${t.id}, 'jury_member', ${year}::smallint) as eligible,
               exists (select 1 from volunteer_assignments where edition_id = ${year} and target_jury_user_id = ${t.id} and state <> 'closed') as busy`;
  if (!x!.eligible) throw new AppError(409, "target_not_in_edition", "Not a target of this event", `That ${t.type === "startup" ? "startup" : "jury member"} does not take part in the ${year} event.`);
  if (x!.busy) throw new AppError(409, "target_busy", "Target already has a volunteer", "Each startup and jury member has at most one volunteer.");
}

async function insertActive(tx: Db, p: Principal, year: number, volunteerId: string, t: VolunteerTargetRef, reason: string, replacesId: string | null) {
  const [row] = await tx<{ id: string }[]>`
    insert into volunteer_assignments (edition_id, volunteer_user_id, target_startup_id, target_jury_user_id, state, created_by, reason,
                                       replaces_id, activated_at, activated_by)
    values (${year}, ${volunteerId}, ${t.type === "startup" ? t.id : null}, ${t.type === "jury" ? t.id : null}, 'active', ${p.account!.id},
            ${reason}, ${replacesId}, now(), ${p.account!.id})
    returning id`;
  return row!.id;
}

/** TBD-23: fill an unassigned target by hand (for example after a shortage or when a volunteer became unavailable). */
export async function assignManually(sql: Sql, p: Principal, year: number, input: { volunteerUserId: string; target: VolunteerTargetRef; reason: string },
  opts: { now: Date; webUrl: string }): Promise<VolunteerAssignmentItem> {
  await getEdition(sql, year);
  let id: string;
  try {
    id = await sql.begin(async (tx) => {
      await lockEdition(tx, year);
      await checkVolunteerFree(tx, year, input.volunteerUserId);
      await checkTargetFree(tx, year, input.target);
      const newId = await insertActive(tx, p, year, input.volunteerUserId, input.target, input.reason, null);
      const [live] = await tx<Live[]>`${LIVE(tx)} where va.id = ${newId}`;
      await announce(tx, live!, year, opts.now, opts.webUrl);
      await audit(tx, { actorUserId: p.account!.id, action: "volunteer.assigned_manually", entityType: "volunteer_assignment", entityId: newId,
        editionId: year, data: { volunteerUserId: input.volunteerUserId, target: input.target, reason: input.reason } });
      return newId;
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    ruleConflict(err);
  }
  return getAssignment(sql, id);
}

async function lockActive(tx: Db, id: string) {
  const [a] = await tx<{ edition: number }[]>`select edition_id as edition from volunteer_assignments where id = ${id}`;
  if (!a) throw notFound("Assignment");
  await lockEdition(tx, a.edition);
  const [cur] = await tx<{ state: string }[]>`select state from volunteer_assignments where id = ${id} for update`;
  if (cur!.state !== "active") throw new AppError(409, "not_active", "Not an active assignment", `This assignment is ${cur!.state}.`);
  const [live] = await tx<Live[]>`${LIVE(tx)} where va.id = ${id}`;
  return { ...live!, edition: a.edition };
}

/**
 * FR-VOL-09 / AT-22: the old assignment is closed (who, when, why) and a new one is created that points back to it.
 * Change the volunteer, the target, or both; the new volunteer and target must be free.
 */
export async function reassign(sql: Sql, p: Principal, id: string, input: { reason: string; volunteerUserId?: string; target?: VolunteerTargetRef },
  opts: { now: Date; webUrl: string }): Promise<VolunteerAssignmentItem> {
  let newId: string;
  try {
    newId = await sql.begin(async (tx) => {
      const old = await lockActive(tx, id);
      const year = old.edition;
      const oldTarget: VolunteerTargetRef = old.startupId ? { type: "startup", id: old.startupId } : { type: "jury", id: old.juryId! };
      const volunteerId = input.volunteerUserId ?? old.volunteerId;
      const target = input.target ?? oldTarget;
      const volunteerChanged = volunteerId !== old.volunteerId;
      const targetChanged = target.type !== oldTarget.type || target.id !== oldTarget.id;
      if (!volunteerChanged && !targetChanged) throw new AppError(400, "nothing_changes", "Nothing changes", "Choose a different volunteer or target.");
      await tx`update volunteer_assignments set state = 'closed', closed_at = now(), closed_by = ${p.account!.id}, close_reason = ${input.reason}
               where id = ${id}`;
      if (volunteerChanged) await checkVolunteerFree(tx, year, volunteerId);
      if (targetChanged) await checkTargetFree(tx, year, target);
      const created = await insertActive(tx, p, year, volunteerId, target, input.reason, id);
      const [live] = await tx<Live[]>`${LIVE(tx)} where va.id = ${created}`;
      await announceEnd(tx, old, year, opts.now, opts.webUrl, { volunteer: volunteerChanged, target: targetChanged });
      await announce(tx, live!, year, opts.now, opts.webUrl);
      await audit(tx, { actorUserId: p.account!.id, action: "volunteer.reassigned", entityType: "volunteer_assignment", entityId: created, editionId: year,
        data: { reason: input.reason, previous: { assignmentId: id, volunteerUserId: old.volunteerId, target: oldTarget },
          next: { assignmentId: created, volunteerUserId: volunteerId, target } } });
      return created;
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    ruleConflict(err);
  }
  return getAssignment(sql, newId);
}

/** TBD-23: end an assignment (for example a volunteer who became unavailable); the target is listed as unassigned. */
export async function closeAssignment(sql: Sql, p: Principal, id: string, reason: string, opts: { now: Date; webUrl: string }) {
  await sql.begin(async (tx) => {
    const old = await lockActive(tx, id);
    await tx`update volunteer_assignments set state = 'closed', closed_at = now(), closed_by = ${p.account!.id}, close_reason = ${reason} where id = ${id}`;
    await announceEnd(tx, old, old.edition, opts.now, opts.webUrl, { volunteer: true, target: true });
    await audit(tx, { actorUserId: p.account!.id, action: "volunteer.assignment_closed", entityType: "volunteer_assignment", entityId: id,
      editionId: old.edition, data: { reason, volunteerUserId: old.volunteerId, target: old.startupId ? { type: "startup", id: old.startupId } : { type: "jury", id: old.juryId } } });
  });
  return getAssignment(sql, id);
}

export async function getAssignment(db: Db, id: string): Promise<VolunteerAssignmentItem> {
  const rows = await db<Row[]>`${SELECT(db)} where va.id = ${id}`;
  if (!rows.length) throw notFound("Assignment");
  return (await hydrate(db, rows))[0]!;
}

// ---------------------------------------------------------------- participants (FR-VOL-12; TBD-49)
/**
 * The volunteer's own ACTIVE assignment (drafts are invisible, AT-23) with the target's coordination contact: the
 * leader's or juror's name and mobile number. Email is not shown (TBD-49: name and mobile only, awaiting approval).
 */
export async function myAssignment(db: Db, p: Principal, year: number): Promise<MyVolunteerAssignment> {
  const [a] = await db<{ type: "startup" | "jury"; name: string; contactName: string; mobile: string | null; since: Date }[]>`
    select case when va.target_startup_id is not null then 'startup' else 'jury' end as type,
           coalesce(s.name, ju.full_name) as name, coalesce(lu.full_name, ju.full_name) as "contactName",
           coalesce(lu.mobile_e164, ju.mobile_e164) as mobile, va.activated_at as since
    from volunteer_assignments va
    left join startups s on s.id = va.target_startup_id
    left join startup_memberships m on m.startup_id = s.id and m.position = 'leader'
    left join user_accounts lu on lu.id = m.user_id
    left join user_accounts ju on ju.id = va.target_jury_user_id
    where va.edition_id = ${year} and va.volunteer_user_id = ${p.account!.id} and va.state = 'active'`;
  return { edition: year, assignment: a ? { target: { type: a.type, name: a.name, contactName: a.contactName, mobile: a.mobile }, since: a.since.toISOString() } : null };
}

/** The volunteer assigned to the caller's startup (as its leader) or to the caller as a jury member. Active only. */
export async function myVolunteer(db: Db, p: Principal, year: number): Promise<MyVolunteer> {
  const [v] = await db<{ name: string; mobile: string | null; for: "startup" | "jury" }[]>`
    select vu.full_name as name, vu.mobile_e164 as mobile,
           case when va.target_startup_id is not null then 'startup' else 'jury' end as "for"
    from volunteer_assignments va join user_accounts vu on vu.id = va.volunteer_user_id
    where va.edition_id = ${year} and va.state = 'active' and (
      va.target_jury_user_id = ${p.account!.id}
      or va.target_startup_id in (select startup_id from startup_memberships where user_id = ${p.account!.id} and position = 'leader'))
    order by (va.target_startup_id is null) limit 1`;
  return { edition: year, volunteer: v ?? null };
}
