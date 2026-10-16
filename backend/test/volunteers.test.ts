// Phase 6: volunteer assignment (PRD §9, FR-VOL-*, AT-19…AT-23, DC-04…07; TBD-22, -23, -47, -48, -49).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pairUp, seededShuffle, type Target } from "../src/modules/volunteers/shuffle.js";
import { createTestApp, type TestApp } from "./helpers.js";

describe("seeded shuffle and pairing (FR-VOL-04, -11)", () => {
  const seed = "a".repeat(64);
  it("is a permutation, reproducible from the seed, and different for another seed", () => {
    const items = Array.from({ length: 50 }, (_, i) => `p${i}`);
    const x = seededShuffle(items, seed, "volunteers");
    expect([...x].sort()).toEqual([...items].sort());
    expect(seededShuffle(items, seed, "volunteers")).toEqual(x);
    expect(seededShuffle(items, "b".repeat(64), "volunteers")).not.toEqual(x);
    expect(seededShuffle(items, seed, "targets")).not.toEqual(x);
  });

  it("every position is reachable (no fixed bias) over many seeds", () => {
    const firsts = new Set<string>();
    for (let i = 0; i < 400; i += 1) firsts.add(seededShuffle(["a", "b", "c", "d"], `seed-${i}`, "x")[0]!);
    expect(firsts.size).toBe(4);
  });

  it("shortage: pairs one-to-one and lists the remaining targets; never doubles up", () => {
    const targets: Target[] = Array.from({ length: 5 }, (_, i) => ({ type: "startup", id: `s${i}` }));
    const r = pairUp(["v1", "v2", "v3"], targets, seed);
    expect(r.pairs).toHaveLength(3);
    expect(new Set(r.pairs.map((p) => p.volunteer)).size).toBe(3);
    expect(new Set(r.pairs.map((p) => p.target.id)).size).toBe(3);
    expect(r.unassignedTargets).toHaveLength(2);
    expect(r.surplusVolunteers).toEqual([]);
    expect(new Set([...r.pairs.map((p) => p.target.id), ...r.unassignedTargets.map((t) => t.id)]).size).toBe(5);
  });

  it("surplus: extra volunteers are listed, not given a second target", () => {
    const r = pairUp(["v1", "v2", "v3"], [{ type: "startup", id: "s1" }], seed);
    expect(r.pairs).toHaveLength(1);
    expect(r.surplusVolunteers).toHaveLength(2);
  });

  it("nobody is paired with themselves (a volunteer who is also a jury target)", () => {
    for (let i = 0; i < 200; i += 1) {
      const r = pairUp(["u1", "u2"], [{ type: "jury", id: "u1" }, { type: "jury", id: "u2" }], `s${i}`);
      expect(r.pairs.every((p) => p.target.id !== p.volunteer)).toBe(true);
      expect(r.pairs).toHaveLength(2);
    }
    // Only possible pairing is with oneself: both are left unpaired and listed.
    const solo = pairUp(["u1"], [{ type: "jury", id: "u1" }], seed);
    expect(solo).toEqual({ pairs: [], unassignedTargets: [{ type: "jury", id: "u1" }], surplusVolunteers: ["u1"] });
  });
});

let t: TestApp;
const MANAGER = "manager@vol.test", MANAGER2 = "manager2@vol.test", ADMIN = "admin@vol.test";
const V = ["v1@vol.test", "v2@vol.test", "v3@vol.test"];
const J = ["j1@vol.test", "j2@vol.test"];
const V27 = "v27@vol.test";
const ids: Record<string, string> = {};
const startups: { id: string; leaderId: string; leader: string }[] = [];

beforeAll(async () => {
  t = await createTestApp();
  await t.staff(MANAGER, ["management"]);
  await t.staff(MANAGER2, ["management"]);
  await t.staff(ADMIN, ["admin"]);
  for (const [i, e] of V.entries()) ids[e] = await t.participant(e, "volunteer", 2026, { name: `Volunteer ${i + 1}`, mobile: `+91900000030${i}` });
  for (const [i, e] of J.entries()) ids[e] = await t.participant(e, "jury_member", 2026, { name: `Juror ${i + 1}`, mobile: `+91900000040${i}` });
  for (const [i, n] of ["Alpha", "Beta", "Gamma"].entries()) {
    const leader = `lead${i}@vol.test`;
    const s = await t.startup(n, leader, 2026, { mobile: `+91900000050${i}` });
    startups.push({ ...s, leader });
  }
  ids[V27] = await t.participant(V27, "volunteer", 2027, { name: "Volunteer 2027" });
});
afterAll(async () => { await t.close(); });

const overview = (as = MANAGER) => t.call("GET", "/v1/manage/editions/2026/volunteers", { as });
const generate = (as = MANAGER, year = 2026) => t.call("POST", `/v1/manage/editions/${year}/volunteer-runs`, { as });
const openRows = () => t.sql<{ volunteer: string; startup: string | null; jury: string | null; state: string }[]>`
  select volunteer_user_id as volunteer, target_startup_id as startup, target_jury_user_id as jury, state
  from volunteer_assignments where edition_id = 2026 and state <> 'closed'`;

describe("permissions (TBD-47): Admin or Management generates; only Management saves and changes", () => {
  it("participants and other roles are refused on the server", async () => {
    for (const as of [V[0]!, J[0]!, startups[0]!.leader]) {
      expect((await overview(as)).status).toBe(403);
      expect((await generate(as)).status).toBe(403);
    }
    expect((await t.call("GET", "/v1/manage/editions/2026/volunteers")).status).toBe(401);
  });
});

describe("AT-19 / AT-20 generation with a shortage: 3 volunteers, 5 targets", () => {
  let runId: string;

  it("an Admin may generate a draft; it pairs 3 and lists 2 unassigned targets, with the seed recorded", async () => {
    const r = await generate(ADMIN);
    expect(r.status).toBe(201);
    runId = r.json.id;
    expect(r.json).toMatchObject({ state: "draft", volunteerCount: 3, targetCount: 5 });
    expect(r.json.seed).toMatch(/^[0-9a-f]{64}$/);
    expect(r.json.pairs).toHaveLength(3);
    expect(r.json.unassignedTargets).toHaveLength(2);
    expect(r.json.surplusVolunteers).toEqual([]);
    expect(new Set(r.json.pairs.map((p: { volunteer: { id: string } }) => p.volunteer.id)).size).toBe(3);
    expect(new Set(r.json.pairs.map((p: { target: { id: string } }) => p.target.id)).size).toBe(3);
    const all = [...r.json.pairs.map((p: { target: { id: string } }) => p.target.id), ...r.json.unassignedTargets.map((x: { id: string }) => x.id)];
    expect(new Set(all).size).toBe(5);
  });

  it("the run is reproducible from the stored seed and inputs", async () => {
    const [run] = await t.sql<{ seed: string; inputs: { volunteers: string[]; targets: Target[] } }[]>`select seed, inputs from assignment_runs where id = ${runId}`;
    const again = pairUp(run!.inputs.volunteers, run!.inputs.targets, run!.seed);
    const stored = (await openRows()).map((x) => `${x.volunteer}>${x.startup ?? x.jury}`).sort();
    expect(again.pairs.map((p) => `${p.volunteer}>${p.target.id}`).sort()).toEqual(stored);
  });

  it("AT-23: a draft is invisible to volunteers and targets", async () => {
    for (const v of V) expect((await t.call("GET", "/v1/editions/2026/volunteer/assignment", { as: v })).json.assignment).toBeNull();
    for (const s of startups) expect((await t.call("GET", "/v1/editions/2026/me/volunteer", { as: s.leader })).json.volunteer).toBeNull();
    for (const j of J) expect((await t.call("GET", "/v1/editions/2026/me/volunteer", { as: j })).json.volunteer).toBeNull();
    expect((await t.sql`select count(*)::int as n from notifications where idempotency_key like 'vol:%'`)[0]!.n).toBe(0);
  });

  it("only one draft per edition", async () => {
    const r = await generate(MANAGER);
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("draft_run_exists");
  });

  it("an Admin cannot save a draft; Management saves it and both parties are told, with truthful statuses", async () => {
    expect((await t.call("POST", `/v1/manage/volunteer-runs/${runId}/approve`, { as: ADMIN })).status).toBe(403);
    const r = await t.call("POST", `/v1/manage/volunteer-runs/${runId}/approve`, { as: MANAGER });
    expect(r.status).toBe(200);
    expect(r.json.state).toBe("approved");
    expect(r.json.reviewedBy).toBe(MANAGER);
    for (const p of r.json.pairs) {
      expect(p.state).toBe("active");
      // In-app is delivered to the inbox at once; email has no provider yet, so it stays queued — never reported sent.
      const byChannel = (who: string, ch: string) => p.notifications.filter((n: { recipient: string; channel: string }) => n.recipient === who && n.channel === ch);
      expect(byChannel("volunteer", "in_app")[0]).toMatchObject({ status: "sent" });
      expect(byChannel("volunteer", "email")[0]).toMatchObject({ status: "queued", sentAt: null });
      expect(byChannel("target", "in_app")[0]).toMatchObject({ status: "sent" });
      expect(byChannel("target", "email")[0]).toMatchObject({ status: "queued", sentAt: null });
    }
    expect((await t.call("POST", `/v1/manage/volunteer-runs/${runId}/approve`, { as: MANAGER })).json.code).toBe("run_closed");
  });

  it("volunteers see their target's coordination contact (name and mobile, no email); targets see their volunteer", async () => {
    const rows = await openRows();
    const withTarget = rows.find((r) => r.startup)!;
    const vEmail = Object.keys(ids).find((k) => ids[k] === withTarget.volunteer)!;
    const mine = (await t.call("GET", "/v1/editions/2026/volunteer/assignment", { as: vEmail })).json;
    const s = startups.find((x) => x.id === withTarget.startup)!;
    expect(mine.assignment.target).toMatchObject({ type: "startup", contactName: expect.stringContaining("Leader"), mobile: expect.stringMatching(/^\+91/) });
    expect(JSON.stringify(mine)).not.toMatch(/@vol\.test/);
    const theirs = (await t.call("GET", "/v1/editions/2026/me/volunteer", { as: s.leader })).json;
    expect(theirs.volunteer).toMatchObject({ for: "startup", mobile: expect.stringMatching(/^\+91/) });
    expect(JSON.stringify(theirs)).not.toMatch(/@vol\.test/);
  });

  it("the overview lists the 2 unassigned targets explicitly and no free volunteers", async () => {
    const o = (await overview()).json;
    expect(o.active).toHaveLength(3);
    expect(o.unassignedTargets).toHaveLength(2);
    expect(o.freeVolunteers).toEqual([]);
    expect(o.runs[0]).toMatchObject({ state: "approved", pairs: 3, unassignedTargets: 2, surplusVolunteers: 0 });
  });

  it("generating again with no free volunteers assigns nobody twice: the shortage is listed", async () => {
    const r = await generate(MANAGER);
    expect(r.status).toBe(201);
    expect(r.json.pairs).toEqual([]);
    expect(r.json.unassignedTargets).toHaveLength(2);
    expect((await t.call("POST", `/v1/manage/volunteer-runs/${r.json.id}/discard`, { as: MANAGER })).json.state).toBe("discarded");
    expect(await openRows()).toHaveLength(3);
  });
});

describe("AT-21 / DC-04, -05, -06: the database keeps one volunteer, one target", () => {
  it("rejects a row with two targets, with none, a second open assignment and a second volunteer for a target", async () => {
    const [m] = await t.sql<{ id: string }[]>`select id from user_accounts where email = ${MANAGER}`;
    const rows = await openRows();
    const ins = (v: string, s: string | null, j: string | null) => t.sql`
      insert into volunteer_assignments (edition_id, volunteer_user_id, target_startup_id, target_jury_user_id, state, created_by, reason)
      values (2026, ${v}, ${s}, ${j}, 'draft', ${m!.id}, 'test')`;
    await expect(ins(ids[V[0]!]!, startups[0]!.id, ids[J[0]!]!)).rejects.toMatchObject({ code: "23514" });
    await expect(ins(ids[V[0]!]!, null, null)).rejects.toMatchObject({ code: "23514" });
    const busy = rows[0]!;
    const free = (await overview()).json.unassignedTargets[0];
    await expect(ins(busy.volunteer, free.type === "startup" ? free.id : null, free.type === "jury" ? free.id : null)).rejects.toMatchObject({ code: "23505" });
    const [extra] = await t.sql<{ id: string }[]>`select id from user_accounts where email = ${V27}`;
    await expect(ins(extra!.id, busy.startup, busy.jury)).rejects.toBeTruthy();   // not in 2026 or the target is taken
  });

  it("history is never overwritten or deleted", async () => {
    await expect(t.sql`delete from volunteer_assignments`).rejects.toMatchObject({ code: "P0001" });
    const [active] = await t.sql<{ id: string; v: string }[]>`select id, volunteer_user_id as v from volunteer_assignments where state = 'active' limit 1`;
    await expect(t.sql`update volunteer_assignments set volunteer_user_id = ${ids[V27]!} where id = ${active!.id}`).rejects.toMatchObject({ code: "P0001" });
    await expect(t.sql`update volunteer_assignments set state = 'draft' where id = ${active!.id}`).rejects.toMatchObject({ code: "P0001" });
    await expect(t.sql`update volunteer_assignments set state = 'closed', closed_at = now() where id = ${active!.id}`).rejects.toMatchObject({ code: "23514" });
  });
});

describe("TBD-23 manual assignment and FR-VOL-09 / AT-22 reassignment", () => {
  let v4: string, v5: string;
  const assign = (volunteerUserId: string, target: { type: string; id: string }, reason = "Filled a gap", as = MANAGER) =>
    t.call("POST", "/v1/manage/editions/2026/volunteer-assignments", { as, body: { volunteerUserId, target, reason } });

  beforeAll(async () => {
    v4 = await t.participant("v4@vol.test", "volunteer", 2026, { name: "Volunteer 4" });
    v5 = await t.participant("v5@vol.test", "volunteer", 2026, { name: "Volunteer 5" });
  });

  it("validates input and eligibility, and refuses busy volunteers and targets", async () => {
    const free = (await overview()).json.unassignedTargets;
    expect((await t.call("POST", "/v1/manage/editions/2026/volunteer-assignments", { as: MANAGER, body: { volunteerUserId: v4, target: free[0] } })).status).toBe(400);
    expect((await assign("not-a-uuid", free[0])).status).toBe(400);
    expect((await assign(v4, { type: "startup", id: free[0].id }, "x", ADMIN)).status).toBe(403);
    expect((await assign(ids[V27]!, free[0])).json.code).toBe("not_a_volunteer");
    expect((await assign(ids[V[0]!]!, free[0])).json.code).toBe("volunteer_busy");
    const taken = (await openRows())[0]!;
    expect((await assign(v4, taken.startup ? { type: "startup", id: taken.startup } : { type: "jury", id: taken.jury! })).json.code).toBe("target_busy");
    expect((await assign(v4, { type: "jury", id: ids[V[1]!]! })).json.code).toBe("target_not_in_edition");
  });

  it("two simultaneous assignments to the same target: one wins, the other is refused, no duplicate", async () => {
    const free = (await overview()).json.unassignedTargets[0];
    const [a, b] = await Promise.all([assign(v4, free), assign(v5, free)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const n = await t.sql`select 1 from volunteer_assignments where state <> 'closed' and (target_startup_id = ${free.id} or target_jury_user_id = ${free.id})`;
    expect(n).toHaveLength(1);
  });

  it("two simultaneous assignments of the same volunteer: one wins", async () => {
    const o = (await overview()).json;
    const free = o.unassignedTargets[0];
    const vol = o.freeVolunteers[0].id;
    expect(o.unassignedTargets).toHaveLength(1);
    const v6 = await t.participant("v6@vol.test", "volunteer", 2026, { name: "Volunteer 6" });
    const j3 = await t.participant("j3@vol.test", "jury_member", 2026, { name: "Juror 3" });
    const [a, b] = await Promise.all([assign(vol, free), assign(vol, { type: "jury", id: j3 })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const mine = await t.sql`select 1 from volunteer_assignments where volunteer_user_id = ${vol} and state <> 'closed'`;
    expect(mine).toHaveLength(1);
    expect(v6).toBeTruthy();
  });

  it("reassignment needs a reason and a real change", async () => {
    const a = (await overview()).json.active[0];
    expect((await t.call("POST", `/v1/manage/volunteer-assignments/${a.id}/reassign`, { as: MANAGER, body: { volunteerUserId: v4 } })).status).toBe(400);
    const same = await t.call("POST", `/v1/manage/volunteer-assignments/${a.id}/reassign`, { as: MANAGER, body: { reason: "x", volunteerUserId: a.volunteer.id } });
    expect(same.json.code).toBe("nothing_changes");
    expect((await t.call("POST", `/v1/manage/volunteer-assignments/${a.id}/reassign`, { as: ADMIN, body: { reason: "x", volunteerUserId: v4 } })).status).toBe(403);
    expect((await t.call("POST", `/v1/manage/volunteer-assignments/${a.id}/reassign`, { as: V[0]!, body: { reason: "x", volunteerUserId: v4 } })).status).toBe(403);
  });

  it("records the previous and the new assignment, the actor, the time and the reason, and tells the people affected", async () => {
    const o = (await overview()).json;
    const old = o.active.find((x: { target: { type: string } }) => x.target.type === "startup");
    const newVol = o.freeVolunteers[0];
    const r = await t.call("POST", `/v1/manage/volunteer-assignments/${old.id}/reassign`, { as: MANAGER2,
      body: { reason: "Original volunteer is unwell", volunteerUserId: newVol.id } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ state: "active", replacesId: old.id, reason: "Original volunteer is unwell", createdBy: MANAGER2,
      volunteer: { id: newVol.id }, target: { id: old.target.id } });
    const after = (await overview()).json;
    const h = after.history.find((x: { id: string }) => x.id === old.id);
    expect(h).toMatchObject({ state: "closed", closedBy: MANAGER2, closeReason: "Original volunteer is unwell" });
    expect(Date.parse(h.closedAt)).toBeGreaterThan(0);
    // The old volunteer is told their assignment ended; the target is told who replaces them.
    expect(h.notifications.map((n: { recipient: string; channel: string }) => `${n.recipient}:${n.channel}`)).toContain("volunteer:in_app");
    expect(h.notifications.some((n: { recipient: string }) => n.recipient === "target")).toBe(true);
    const [a] = await t.sql<{ actor: string; data: { reason: string; previous: { assignmentId: string; volunteerUserId: string }; next: { volunteerUserId: string } } }[]>`
      select u.email as actor, e.data from audit_events e join user_accounts u on u.id = e.actor_user_id where e.action = 'volunteer.reassigned'`;
    expect(a).toMatchObject({ actor: MANAGER2, data: { reason: "Original volunteer is unwell",
      previous: { assignmentId: old.id, volunteerUserId: old.volunteer.id }, next: { volunteerUserId: newVol.id } } });
    // The former volunteer is now free and has no assignment.
    const oldEmail = Object.keys(ids).find((k) => ids[k] === old.volunteer.id)!;
    expect((await t.call("GET", "/v1/editions/2026/volunteer/assignment", { as: oldEmail })).json.assignment).toBeNull();
    expect((await t.call("POST", `/v1/manage/volunteer-assignments/${old.id}/reassign`, { as: MANAGER, body: { reason: "x", volunteerUserId: v4 } })).json.code)
      .toBe("not_active");
    // A closed row is terminal, even in the database.
    await expect(t.sql`update volunteer_assignments set close_reason = 'rewritten' where id = ${old.id}`).rejects.toMatchObject({ code: "P0001" });
  });

  it("moving a volunteer to a target that already has one is refused and changes nothing", async () => {
    const o = (await overview()).json;
    const [x, y] = o.active;
    const r = await t.call("POST", `/v1/manage/volunteer-assignments/${x.id}/reassign`, { as: MANAGER, body: { reason: "swap", target: { type: y.target.type, id: y.target.id } } });
    expect(r.json.code).toBe("target_busy");
    expect((await overview()).json.active.find((a: { id: string }) => a.id === x.id).state).toBe("active");
  });

  it("two simultaneous reassignments of one assignment: one wins, the other finds it no longer active", async () => {
    const o = (await overview()).json;
    const a = o.active[0];
    const f1 = { id: await t.participant("v7@vol.test", "volunteer", 2026, { name: "Volunteer 7" }) };
    const f2 = { id: await t.participant("v8@vol.test", "volunteer", 2026, { name: "Volunteer 8" }) };
    const [r1, r2] = await Promise.all([
      t.call("POST", `/v1/manage/volunteer-assignments/${a.id}/reassign`, { as: MANAGER, body: { reason: "one", volunteerUserId: f1.id } }),
      t.call("POST", `/v1/manage/volunteer-assignments/${a.id}/reassign`, { as: MANAGER2, body: { reason: "two", volunteerUserId: f2.id } }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const succ = await t.sql`select 1 from volunteer_assignments where replaces_id = ${a.id}`;
    expect(succ).toHaveLength(1);
  });

  it("closing an assignment lists the target as unassigned again", async () => {
    const o = (await overview()).json;
    const a = o.active[0];
    expect((await t.call("POST", `/v1/manage/volunteer-assignments/${a.id}/close`, { as: MANAGER, body: {} })).status).toBe(400);
    const r = await t.call("POST", `/v1/manage/volunteer-assignments/${a.id}/close`, { as: MANAGER, body: { reason: "Volunteer withdrew" } });
    expect(r.json).toMatchObject({ state: "closed", closeReason: "Volunteer withdrew", closedBy: MANAGER });
    expect((await overview()).json.unassignedTargets.map((x: { id: string }) => x.id)).toContain(a.target.id);
  });

  it("every volunteer action is audited", async () => {
    const rows = await t.sql<{ action: string }[]>`select distinct action from audit_events where action like 'volunteer.%' order by action`;
    expect(rows.map((r) => r.action)).toEqual([
      "volunteer.assigned_manually", "volunteer.assignment_closed", "volunteer.reassigned", "volunteer.run_approved",
      "volunteer.run_discarded", "volunteer.run_generated",
    ]);
  });
});

describe("concurrent generation and edition isolation", () => {
  it("two simultaneous generations: exactly one draft is created", async () => {
    const [a, b] = await Promise.all([generate(MANAGER), generate(MANAGER2)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const drafts = await t.sql`select 1 from assignment_runs where edition_id = 2026 and state = 'draft'`;
    expect(drafts).toHaveLength(1);
    const lost = a.status === 409 ? a : b;
    expect(lost.json.code).toBe("draft_run_exists");
  });

  it("a 2027 volunteer cannot see 2026 assignments; a 2026 volunteer cannot see 2027", async () => {
    expect((await t.call("GET", "/v1/editions/2026/volunteer/assignment", { as: V27 })).json.code).toBe("no_edition_access");
    expect((await t.call("GET", "/v1/editions/2027/volunteer/assignment", { as: V[0]! })).json.code).toBe("no_edition_access");
    expect((await t.call("GET", "/v1/editions/2026/volunteer/assignment", { as: startups[0]!.leader })).status).toBe(403);
  });

  it("surplus volunteers in another edition are listed, not doubled up", async () => {
    await t.participant("v27b@vol.test", "volunteer", 2027);
    await t.startup("Delta", "lead-d@vol.test", 2027);
    const r = await generate(MANAGER, 2027);
    expect(r.status).toBe(201);
    expect(r.json.pairs).toHaveLength(1);
    expect(r.json.surplusVolunteers).toHaveLength(1);
    expect(r.json.unassignedTargets).toEqual([]);
  });
});
