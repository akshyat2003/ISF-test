// Phase 6: jury evaluation (FR-JRY-*, AT-16, AT-17, AT-18; TBD-20, -21, -43). Jury scoring stays separate from AI
// ranking and from selection decisions.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
const MANAGER = "manager@jury.test", MANAGER2 = "manager2@jury.test", ADMIN = "admin@jury.test";
const J1 = "j1@jury.test", J2 = "j2@jury.test", J27 = "j27@jury.test", NOT_JUROR = "vol@jury.test";
let j1: string, j2: string, a: { id: string; leaderId: string }, b: { id: string; leaderId: string }, c: { id: string; leaderId: string };
let d27: { id: string; leaderId: string };
let rubricV1: string;

const SCORES = { innovation: 8, feasibility: 7, scalability: 6, market_relevance: 9, impact: 10, pitch_delivery: 5 };

beforeAll(async () => {
  t = await createTestApp();
  await t.staff(MANAGER, ["management"]);
  await t.staff(MANAGER2, ["management"]);
  await t.staff(ADMIN, ["admin"]);
  j1 = await t.participant(J1, "jury_member", 2026, { name: "Juror One", mobile: "+919000000101" });
  j2 = await t.participant(J2, "jury_member", 2026, { name: "Juror Two" });
  await t.participant(J27, "jury_member", 2027, { name: "Juror 2027" });
  await t.participant(NOT_JUROR, "volunteer", 2026);
  a = await t.startup("Alpha Agro", "lead-a@jury.test", 2026, { mobile: "+919000000201" });
  b = await t.startup("Beta Bamboo", "lead-b@jury.test");
  c = await t.startup("Gamma Grain", "lead-c@jury.test");
  d27 = await t.startup("Delta 2027", "lead-d@jury.test", 2027);
});
afterAll(async () => { await t.close(); });

const overview = async (as = MANAGER) => t.call("GET", "/v1/manage/editions/2026/jury", { as });
const assign = (juryUserId: string, startupId: string, as = MANAGER) =>
  t.call("POST", "/v1/manage/editions/2026/jury-assignments", { as, body: { juryUserId, startupId } });
const save = (as: string, startupId: string, body: unknown, submit = false) =>
  t.call(submit ? "POST" : "PUT", `/v1/editions/2026/jury/startups/${startupId}/evaluation${submit ? "/submit" : ""}`, { as, body });

describe("TBD-43 scoring rubrics: versioned, approved by Management, frozen once approved", () => {
  it("ships draft v1 (draft criteria plus pitch delivery, 1–10, equal weights) unapproved", async () => {
    const o = (await overview()).json;
    const v1 = o.rubrics.find((r: { version: number }) => r.version === 1);
    rubricV1 = v1.id;
    expect(v1.approvedAt).toBeNull();
    expect(o.activeRubricId).toBeNull();
    expect(v1.parameters.map((p: { key: string }) => p.key)).toEqual(Object.keys(SCORES));
    expect(v1.parameters.every((p: { min: number; max: number; weight: number }) => p.min === 1 && p.max === 10 && p.weight === 1)).toBe(true);
  });

  it("only Management configures jury scoring: an Admin, a juror and a volunteer are refused", async () => {
    for (const as of [ADMIN, J1, NOT_JUROR]) {
      expect((await overview(as)).status).toBe(403);
      expect((await t.call("POST", `/v1/manage/rubrics/${rubricV1}/approve`, { as })).status).toBe(403);
    }
  });

  it("jurors cannot score before a rubric is approved", async () => {
    await assign(j1, a.id);
    const r = await save(J1, a.id, { scores: { innovation: 5 } });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("no_rubric");
  });

  it("validates a new version: ranges, unique keys", async () => {
    const bad = await t.call("POST", "/v1/manage/editions/2026/rubrics", { as: MANAGER, body: { parameters: [
      { key: "x", label: "X", description: "d", weight: 1, min: 5, max: 5 },
    ] } });
    expect(bad.status).toBe(400);
    const dup = await t.call("POST", "/v1/manage/editions/2026/rubrics", { as: MANAGER, body: { parameters: [
      { key: "xx", label: "X", description: "d", weight: 1, min: 1, max: 5 }, { key: "xx", label: "Y", description: "d", weight: 1, min: 1, max: 5 },
    ] } });
    expect(dup.status).toBe(400);
  });

  it("approves v1; an approved rubric can no longer change, even in the database", async () => {
    const r = await t.call("POST", `/v1/manage/rubrics/${rubricV1}/approve`, { as: MANAGER });
    expect(r.status).toBe(200);
    expect(r.json.approvedBy).toBe(MANAGER);
    expect((await overview()).json.activeRubricId).toBe(rubricV1);
    expect((await t.call("POST", `/v1/manage/rubrics/${rubricV1}/approve`, { as: MANAGER })).json.code).toBe("rubric_approved");
    await expect(t.sql`update scoring_rubrics set parameters = '[]' where id = ${rubricV1}`).rejects.toMatchObject({ hint: "RUBRIC-APPROVED" });
  });
});

describe("TBD-20 jury assignments: Management assigns explicitly", () => {
  it("assigns jurors to startups of the edition; refuses non-jurors, other editions and duplicates", async () => {
    expect((await assign(j1, b.id)).status).toBe(201);
    expect((await assign(j2, a.id)).status).toBe(201);
    expect((await assign(j1, a.id)).json.code).toBe("already_assigned");
    const [vol] = await t.sql<{ id: string }[]>`select id from user_accounts where email = ${NOT_JUROR}`;
    expect((await assign(vol!.id, a.id)).json.code).toBe("not_a_juror");
    expect((await assign(j1, d27.id)).json.code).toBe("startup_not_in_edition");
    const o = (await overview()).json;
    expect(o.jurors.map((j: { fullName: string }) => j.fullName)).toEqual(["Juror One", "Juror Two"]);   // 2027 juror not listed
    expect(o.startups.map((s: { name: string }) => s.name)).toEqual(["Alpha Agro", "Beta Bamboo", "Gamma Grain"]);
    expect(o.assignments).toHaveLength(3);
  });

  it("the database refuses an ineligible assignment even without the API", async () => {
    const [m] = await t.sql<{ id: string }[]>`select id from user_accounts where email = ${MANAGER}`;
    await expect(t.sql`insert into jury_assignments (edition_id, jury_user_id, startup_id, created_by) values (2026, ${j1}, ${d27.id}, ${m!.id})`)
      .rejects.toMatchObject({ hint: "STARTUP-NOT-IN-EDITION" });
    await expect(t.sql`insert into jury_assignments (edition_id, jury_user_id, startup_id, created_by) values (2026, ${a.leaderId}, ${c.id}, ${m!.id})`)
      .rejects.toMatchObject({ hint: "JURY-NOT-ELIGIBLE" });
  });
});

describe("AT-16 jury scope: own assignments, the current pitch, nothing else", () => {
  it("a juror sees only their assigned startups and the active rubric", async () => {
    const h = await t.call("GET", "/v1/editions/2026/jury", { as: J1 });
    expect(h.status).toBe(200);
    expect(h.json.startups.map((s: { name: string }) => s.name).sort()).toEqual(["Alpha Agro", "Beta Bamboo"]);
    expect(h.json.rubric.version).toBe(1);
    expect(h.json.currentPitch).toBeNull();
  });

  it("an unassigned startup's profile is indistinguishable from a missing one", async () => {
    const r = await t.call("GET", `/v1/editions/2026/jury/startups/${c.id}`, { as: J1 });
    expect(r.status).toBe(404);
    expect((await t.call("GET", "/v1/editions/2026/jury/startups/00000000-0000-4000-8000-000000000000", { as: J1 })).status).toBe(404);
  });

  it("the authorised profile has founders and answers but no contact details and no AI data", async () => {
    const r = await t.call("GET", `/v1/editions/2026/jury/startups/${a.id}`, { as: J1 });
    expect(r.status).toBe(200);
    expect(r.json.founders).toEqual([{ fullName: "Alpha Agro Leader", position: "leader" }]);
    const text = JSON.stringify(r.json);
    expect(text).not.toMatch(/@jury\.test|\+9190000|email|mobile|rank|ai_|criterion|explanation/i);
  });

  it("the startup Management sets as currently pitching can be opened by every juror of the edition (FR-JRY-03)", async () => {
    const slot = await t.call("POST", "/v1/manage/editions/2026/pitch-slots", { as: MANAGER,
      body: { startupId: c.id, startsAt: "2026-12-18T10:00:00+05:30", venue: "Main hall" } });
    expect(slot.status).toBe(201);
    const slotId = slot.json.slots.find((s: { startupId: string }) => s.startupId === c.id).id;
    await t.call("POST", `/v1/manage/pitch-slots/${slotId}/start`, { as: MANAGER });
    const h = (await t.call("GET", "/v1/editions/2026/jury", { as: J1 })).json;
    expect(h.currentPitch).toMatchObject({ startupName: "Gamma Grain", venue: "Main hall", assigned: false });
    const p = await t.call("GET", `/v1/editions/2026/jury/startups/${c.id}`, { as: J1 });
    expect(p.status).toBe(200);
    expect(p.json.assigned).toBe(false);
    // ...but scoring stays limited to the juror's own assignments.
    expect((await save(J1, c.id, { scores: SCORES })).status).toBe(404);
    await t.call("POST", `/v1/manage/pitch-slots/${slotId}/finish`, { as: MANAGER });
    expect((await t.call("GET", `/v1/editions/2026/jury/startups/${c.id}`, { as: J1 })).status).toBe(404);
  });

  it("jurors cannot reach Management, AI ranking or another edition", async () => {
    expect((await t.call("GET", "/v1/manage/editions/2026/applications", { as: J1 })).status).toBe(403);
    expect((await t.call("GET", "/v1/manage/editions/2026/ranking-runs", { as: J1 })).status).toBe(403);
    expect((await t.call("GET", "/v1/manage/editions/2026/evaluations", { as: J1 })).status).toBe(403);
    expect((await t.call("GET", "/v1/editions/2027/jury", { as: J1 })).json.code).toBe("no_edition_access");
    expect((await t.call("GET", "/v1/editions/2026/jury", { as: J27 })).json.code).toBe("no_edition_access");
    expect((await t.call("GET", "/v1/editions/2026/jury", { as: NOT_JUROR })).status).toBe(403);
  });
});

describe("AT-17 jury scoring", () => {
  it("rejects out-of-range, non-integer and unknown scores, field by field", async () => {
    const r = await save(J1, a.id, { scores: { innovation: 11, feasibility: 0, impact: 7.5, charisma: 9 } });
    expect(r.status).toBe(400);
    expect(r.json.errors.map((e: { path: string }) => e.path).sort()).toEqual(["scores.charisma", "scores.feasibility", "scores.impact", "scores.innovation"]);
    expect((await t.sql`select count(*)::int as n from evaluations`)[0]!.n).toBe(0);
  });

  it("saves a partial draft; submission needs every parameter", async () => {
    const d = await save(J1, a.id, { scores: { innovation: 8 }, comments: "Strong field pilot." });
    expect(d.status).toBe(200);
    const mine = d.json.startups.find((s: { startupId: string }) => s.startupId === a.id);
    expect(mine.evaluation).toMatchObject({ state: "draft", scores: { innovation: 8 }, comments: "Strong field pilot.", rubricVersion: 1, totalScore: null });
    const s = await save(J1, a.id, { scores: { innovation: 8 } }, true);
    expect(s.status).toBe(400);
    expect(s.json.errors).toHaveLength(5);
  });

  it("submits with the rubric version recorded and a server-computed total, then locks", async () => {
    const s = await save(J1, a.id, { scores: SCORES, comments: "Strong field pilot." }, true);
    expect(s.status).toBe(200);
    const mine = s.json.startups.find((x: { startupId: string }) => x.startupId === a.id).evaluation;
    // (7+6+5+8+9+4) / (6 × 9) × 100 = 39 / 54 × 100
    expect(mine).toMatchObject({ state: "submitted", rubricVersion: 1, totalScore: 72.22 });
    const again = await save(J1, a.id, { scores: { ...SCORES, impact: 1 } });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe("evaluation_submitted");
    await expect(t.sql`update evaluations set scores = '{}'::jsonb where state = 'submitted'`).rejects.toMatchObject({ hint: "DC-10" });
    await expect(t.sql`delete from evaluations`).rejects.toMatchObject({ hint: "DC-10" });
  });

  it("FR-JRY-15: a juror sees only their own scores", async () => {
    await save(J2, a.id, { scores: { ...SCORES, innovation: 2 } }, true);
    const j1home = JSON.stringify((await t.call("GET", "/v1/editions/2026/jury", { as: J1 })).json);
    expect(j1home).not.toContain('"innovation":2');
    const j2a = (await t.call("GET", "/v1/editions/2026/jury", { as: J2 })).json.startups.find((s: { startupId: string }) => s.startupId === a.id);
    expect(j2a.evaluation.scores.innovation).toBe(2);
    expect(j2a.evaluation.comments).toBeNull();
  });

  it("two simultaneous submissions of one assignment: exactly one wins, the other is told it is locked", async () => {
    const [x, y] = await Promise.all([save(J1, b.id, { scores: SCORES }, true), save(J1, b.id, { scores: { ...SCORES, impact: 1 } }, true)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const [e] = await t.sql<{ n: number }[]>`
      select count(*)::int as n from evaluations e join jury_assignments j on j.id = e.jury_assignment_id where j.startup_id = ${b.id}`;
    expect(e!.n).toBe(1);
  });

  it("Management reopens with a reason (audited with the previous submission); the juror resubmits", async () => {
    const review = (await t.call("GET", "/v1/manage/editions/2026/evaluations", { as: MANAGER })).json;
    const ev = review.evaluations.find((e: { juryName: string; startupName: string }) => e.juryName === "Juror One" && e.startupName === "Alpha Agro");
    expect((await t.call("POST", `/v1/manage/evaluations/${ev.id}/reopen`, { as: MANAGER, body: {} })).status).toBe(400);
    expect((await t.call("POST", `/v1/manage/evaluations/${ev.id}/reopen`, { as: J1, body: { reason: "x" } })).status).toBe(403);
    const r = await t.call("POST", `/v1/manage/evaluations/${ev.id}/reopen`, { as: MANAGER, body: { reason: "Juror asked to correct a typo." } });
    expect(r.json).toMatchObject({ state: "reopened", reopenReason: "Juror asked to correct a typo." });
    const [audit] = await t.sql<{ data: { previous: { totalScore: string } } }[]>`select data from audit_events where action = 'jury.evaluation_reopened'`;
    expect(audit!.data.previous.totalScore).toBe("72.22");
    const again = await save(J1, a.id, { scores: { ...SCORES, impact: 9 }, comments: "Corrected." }, true);
    expect(again.json.startups.find((x: { startupId: string }) => x.startupId === a.id).evaluation.state).toBe("submitted");
    expect((await t.call("POST", `/v1/manage/evaluations/${ev.id}/reopen`, { as: MANAGER, body: { reason: "again" } })).status).toBe(200);
    await save(J1, a.id, { scores: SCORES, comments: "Final." }, true);
  });

  it("the database allows a reopen only by an active Management account", async () => {
    const [e] = await t.sql<{ id: string }[]>`select e.id from evaluations e join jury_assignments j on j.id = e.jury_assignment_id
      where j.jury_user_id = ${j2} and e.state = 'submitted'`;
    await expect(t.sql`update evaluations set state = 'reopened', reopened_by = ${j1}, reopened_at = now(), reopen_reason = 'x' where id = ${e!.id}`)
      .rejects.toMatchObject({ hint: "DC-10" });
  });

  it("comments are refused when the rubric does not permit them", async () => {
    const v2 = await t.call("POST", "/v1/manage/editions/2026/rubrics", { as: MANAGER, body: { commentsAllowed: false, parameters: [
      { key: "overall", label: "Overall", description: "Overall impression", weight: 1, min: 1, max: 5 },
    ] } });
    expect(v2.status).toBe(201);
    await t.call("POST", `/v1/manage/rubrics/${v2.json.id}/approve`, { as: MANAGER });
    const r = await save(J2, b.id === b.id ? c.id : c.id, { scores: { overall: 3 }, comments: "no" });
    expect(r.status).toBe(404);   // J2 is not assigned to Gamma: still nothing to see
    await assign(j2, c.id);
    const refused = await save(J2, c.id, { scores: { overall: 3 }, comments: "Nice." }, true);
    expect(refused.json.errors).toEqual([{ path: "comments", message: "Comments are not permitted for this rubric" }]);
    const ok = await save(J2, c.id, { scores: { overall: 4 } }, true);
    expect(ok.json.startups.find((s: { startupId: string }) => s.startupId === c.id).evaluation).toMatchObject({ rubricVersion: 2, totalScore: 75 });
  });

  it("an assignment with an evaluation cannot be removed; one without can", async () => {
    const o = (await overview()).json;
    const withEval = o.assignments.find((x: { evaluation: unknown }) => x.evaluation);
    expect((await t.call("DELETE", `/v1/manage/jury-assignments/${withEval.id}`, { as: MANAGER })).json.code).toBe("evaluation_exists");
    const add = await assign(j1, c.id);
    const fresh = add.json.assignments.find((x: { juryUserId: string; startupId: string }) => x.juryUserId === j1 && x.startupId === c.id);
    expect((await t.call("DELETE", `/v1/manage/jury-assignments/${fresh.id}`, { as: MANAGER })).status).toBe(200);
  });
});

describe("FR-JRY-14 the pitch schedule and the startup currently pitching", () => {
  it("one live pitch per edition: starting another finishes the first, in the API and the database", async () => {
    const o = (await t.call("POST", "/v1/manage/editions/2026/pitch-slots", { as: MANAGER, body: { startupId: a.id, venue: "Hall B" } })).json;
    const sa = o.slots.find((s: { startupId: string }) => s.startupId === a.id).id;
    const sc = o.slots.find((s: { startupId: string }) => s.startupId === c.id).id;
    await t.call("POST", `/v1/manage/pitch-slots/${sa}/start`, { as: MANAGER });
    const after = (await t.call("POST", `/v1/manage/pitch-slots/${sc}/start`, { as: MANAGER2 })).json;
    expect(after.currentPitch.startupName).toBe("Gamma Grain");
    expect(after.slots.find((s: { id: string }) => s.id === sa).state).toBe("done");
    await expect(t.sql`update pitch_slots set state = 'pitching' where id = ${sa}`).rejects.toMatchObject({ code: "23505" });
    expect((await t.call("POST", "/v1/manage/editions/2026/pitch-slots", { as: MANAGER, body: { startupId: a.id } })).json.code).toBe("slot_exists");
    expect((await t.call("POST", `/v1/manage/pitch-slots/${sc}/start`, { as: J1 })).status).toBe(403);
    await t.call("POST", `/v1/manage/pitch-slots/${sc}/finish`, { as: MANAGER });
  });

  it("jurors see the schedule of their own startups", async () => {
    const h = (await t.call("GET", "/v1/editions/2026/jury", { as: J1 })).json;
    expect(h.startups.find((s: { startupId: string }) => s.startupId === a.id).slot).toMatchObject({ venue: "Hall B", state: "done" });
  });
});

describe("AT-18 / FR-JRY-11, -16: Management review is decision support only, separate from AI ranking and selection", () => {
  it("summarises per startup and per rubric version, without any winner", async () => {
    const r = (await t.call("GET", "/v1/manage/editions/2026/evaluations", { as: MANAGER })).json;
    const alpha = r.startups.find((s: { startupName: string }) => s.startupName === "Alpha Agro");
    expect(alpha).toMatchObject({ assigned: 2, submitted: 2 });
    expect(alpha.byRubric).toHaveLength(1);
    expect(alpha.byRubric[0].parameters.find((p: { key: string }) => p.key === "innovation").average).toBe(5);
    const gamma = r.startups.find((s: { startupName: string }) => s.startupName === "Gamma Grain");
    expect(gamma.byRubric.map((g: { version: number }) => g.version)).toEqual([2]);
    expect(JSON.stringify(r)).not.toMatch(/winner|rank/i);
    expect((await t.call("GET", "/v1/manage/editions/2026/evaluations", { as: ADMIN })).status).toBe(403);
  });

  it("jury scores do not touch applications, selection decisions or ranking, and the ranking worker cannot read them", async () => {
    const [x] = await t.sql<{ apps: number; decisions: number; results: number }[]>`
      select (select count(*)::int from applications) as apps, (select count(*)::int from selection_decisions) as decisions,
             (select count(*)::int from ranking_results) as results`;
    expect(x).toEqual({ apps: 0, decisions: 0, results: 0 });
    for (const table of ["evaluations", "scoring_rubrics", "jury_assignments", "pitch_slots"]) {
      await expect(t.sql.begin(async (tx) => {
        await tx`set local role sj_ranking_worker`;
        await tx.unsafe(`select 1 from ${table} limit 1`);
      })).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("every jury action is audited", async () => {
    const rows = await t.sql<{ action: string }[]>`select distinct action from audit_events where action like 'jury.%' order by action`;
    expect(rows.map((r) => r.action)).toEqual([
      "jury.assigned", "jury.evaluation_reopened", "jury.evaluation_saved", "jury.evaluation_submitted", "jury.pitch_finished",
      "jury.pitch_started", "jury.rubric_approved", "jury.rubric_created", "jury.slot_created", "jury.unassigned",
    ]);
  });
});
