// TBD-37: released decisions change only through a two-person correction; applicants may withdraw before the event.
// AT-13 ("changing a released decision requires an authorised, audited action"), FR-SEL-11, RQ §6 (years independent).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AFTER_DEADLINE, createTestApp, registration, type TestApp } from "./helpers.js";

let t: TestApp;
const M1 = "m1@jathara.test";
const M2 = "m2@jathara.test";
const ADMIN = "admin@jathara.test";
const SEL = "sel@example.com";       // 2026 + 2027, selected for 2026
const NOT = "not@example.com";       // 2026, not selected
const DRAFT = "draft@example.com";   // 2026, decision drafted only
let sel26: string, sel27: string, not26: string, draft26: string;

beforeAll(async () => {
  t = await createTestApp();
  await t.staff(M1, ["management"]);
  await t.staff(M2, ["management"]);
  await t.staff(ADMIN, ["admin"]);
  [sel26, sel27] = (await t.call("POST", "/v1/me/registrations", { as: SEL, body: registration({ name: "Sel Co", yearOption: "both" }) }))
    .json.applications.map((a: { id: string }) => a.id);
  not26 = (await t.call("POST", "/v1/me/registrations", { as: NOT, body: registration({ name: "Not Co" }) })).json.applications[0].id;
  draft26 = (await t.call("POST", "/v1/me/registrations", { as: DRAFT, body: registration({ name: "Draft Co" }) })).json.applications[0].id;
  t.setNow(AFTER_DEADLINE);
  await t.call("PUT", `/v1/manage/applications/${sel26}/decision`, { as: M1, body: { outcome: "selected" } });
  await t.call("PUT", `/v1/manage/applications/${not26}/decision`, { as: M1, body: { outcome: "not_selected" } });
  expect((await t.call("POST", "/v1/manage/editions/2026/decisions/release", { as: M1, body: {} })).json.released).toBe(2);
  await t.call("PUT", `/v1/manage/applications/${draft26}/decision`, { as: M1, body: { outcome: "selected" } });
});
afterAll(async () => { await t.close(); });

const request = (as: string, id: string, body: object) => t.call("POST", `/v1/manage/applications/${id}/corrections`, { as, body });
const pendingOf = async (id: string) =>
  (await t.call("GET", `/v1/manage/applications/${id}`, { as: M1 })).json.corrections.find((c: { status: string }) => c.status === "pending");

describe("TBD-37 corrections: a written reason, then a second Management approver", () => {
  it("only Management may request; a reason is required; only released decisions; the outcome must change", async () => {
    expect((await request(ADMIN, not26, { outcome: "selected", reason: "x" })).status).toBe(403);
    expect((await request(M1, not26, { outcome: "selected", reason: "  " })).status).toBe(400);
    expect((await request(M1, draft26, { outcome: "not_selected", reason: "Wrong team" })).json.code).toBe("not_released");
    expect((await request(M1, not26, { outcome: "not_selected", reason: "Same" })).json.code).toBe("same_outcome");
  });

  it("a request alone changes nothing; one pending correction per application", async () => {
    const r = await request(M1, not26, { outcome: "selected", reason: "Scores were swapped with another team in the review sheet." });
    expect(r.status).toBe(201);
    expect(r.json.status).toBe("not_selected");
    expect(r.json.corrections[0]).toMatchObject({ status: "pending", fromOutcome: "not_selected", toOutcome: "selected", requestedBy: M1 });
    expect((await t.call("GET", "/v1/me/applications", { as: NOT })).json.applications[0].status).toBe("not_selected");
    expect((await request(M2, not26, { outcome: "selected", reason: "Duplicate" })).json.code).toBe("correction_pending");
  });

  it("the requester cannot approve or reject their own correction, and the database enforces the two-person rule too", async () => {
    const c = await pendingOf(not26);
    const self = await t.call("POST", `/v1/manage/corrections/${c.id}/approve`, { as: M1, body: {} });
    expect([self.status, self.json.code]).toEqual([403, "second_person_required"]);
    expect((await t.call("POST", `/v1/manage/corrections/${c.id}/reject`, { as: M1, body: {} })).json.code).toBe("second_person_required");
    await expect(t.sql`update decision_corrections set status = 'applied', reviewed_by = requested_by, reviewed_at = now() where id = ${c.id}`)
      .rejects.toThrow(/correction_second_person/);
    // Not even the database owner can change a released outcome without an applied correction.
    await expect(t.sql`update selection_decisions set outcome = 'selected', corrected_at = now() where application_id = ${not26}`)
      .rejects.toMatchObject({ hint: "TBD-37" });
  });

  it("a second Management member approves: outcome, status and access change, the applicant is told again, both steps audited", async () => {
    const c = await pendingOf(not26);
    const r = await t.call("POST", `/v1/manage/corrections/${c.id}/approve`, { as: M2, body: { note: "Checked against the original sheet." } });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("selected");
    expect(r.json.decision).toMatchObject({ outcome: "selected" });
    expect(r.json.decision.correctedAt).not.toBeNull();
    expect(r.json.corrections[0]).toMatchObject({ status: "applied", reviewedBy: M2, reviewNote: "Checked against the original sheet." });

    const mine = (await t.call("GET", "/v1/me/applications", { as: NOT })).json.applications[0];
    expect(mine.status).toBe("selected");
    expect(mine.decidedAt).toBe(r.json.decision.correctedAt);
    expect((await t.call("GET", "/v1/editions/2026/me", { as: NOT })).status).toBe(200);
    const notes = (await t.call("GET", "/v1/me/notifications", { as: NOT })).json;
    expect(notes[0]).toMatchObject({ kind: "decision_corrected" });
    expect(notes[0].body).toContain("correct an earlier message");
    const out = await t.sql`select channel, status, kind from notifications where kind = 'decision_corrected' and channel = 'email'`;
    expect(out).toHaveLength(1);
    const actions = (await t.sql<{ action: string }[]>`select action from audit_events where entity_id = ${not26} order by id`).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["decision.correction_requested", "decision.correction_applied"]));
    // A closed correction cannot be reopened or deleted.
    await expect(t.sql`update decision_corrections set status = 'pending', reviewed_at = null, reviewed_by = null where id = ${c.id}`)
      .rejects.toMatchObject({ hint: "TBD-37" });
    await expect(t.sql`delete from decision_corrections where id = ${c.id}`).rejects.toMatchObject({ hint: "TBD-37" });
  });

  it("correcting to 'not selected' removes that edition's access but leaves the other year untouched", async () => {
    expect((await t.call("GET", "/v1/editions/2026/me", { as: SEL })).status).toBe(200);
    await request(M2, sel26, { outcome: "not_selected", reason: "Eligibility check failed after release." });
    const c = await pendingOf(sel26);
    await t.call("POST", `/v1/manage/corrections/${c.id}/approve`, { as: M1, body: {} });
    expect((await t.call("GET", "/v1/editions/2026/me", { as: SEL })).status).toBe(403);
    const [a27] = await t.sql`select status from applications where id = ${sel27}`;
    expect(a27!.status).toBe("submitted");
    const notes = (await t.call("GET", "/v1/me/notifications", { as: SEL })).json;
    expect(notes[0].body).toContain("2027 application is separate");
  });

  it("a reviewer can reject with a note; only the requester can cancel", async () => {
    await request(M1, sel26, { outcome: "selected", reason: "Reconsider" });
    const c1 = await pendingOf(sel26);
    expect((await t.call("POST", `/v1/manage/corrections/${c1.id}/cancel`, { as: M2 })).json.code).toBe("not_requester");
    const rej = await t.call("POST", `/v1/manage/corrections/${c1.id}/reject`, { as: M2, body: { note: "No new evidence." } });
    expect(rej.json.corrections.at(-1)).toMatchObject({ status: "rejected", reviewedBy: M2, reviewNote: "No new evidence." });
    expect(rej.json.status).toBe("not_selected");
    await request(M1, sel26, { outcome: "selected", reason: "Second thoughts" });
    const c2 = await pendingOf(sel26);
    expect((await t.call("POST", `/v1/manage/corrections/${c2.id}/cancel`, { as: M1 })).json.corrections.at(-1).status).toBe("cancelled");
    expect((await t.call("POST", `/v1/manage/corrections/${c2.id}/approve`, { as: M2, body: {} })).json.code).toBe("correction_closed");
    const list = (await t.call("GET", "/v1/manage/editions/2026/corrections", { as: M1 })).json;
    expect(list.map((c: { status: string }) => c.status).sort()).toEqual(["applied", "applied", "cancelled", "rejected"]);
  });
});

describe("TBD-37 withdrawal by the applicant", () => {
  it("only the leader can withdraw their own application; another user gets 'not found'", async () => {
    const r = await t.call("POST", `/v1/me/applications/${draft26}/withdraw`, { as: NOT });
    expect([r.status, r.json.code]).toEqual([404, "not_found"]);
  });

  it("withdrawing discards an unreleased draft and keeps it out of release and decisions", async () => {
    const r = await t.call("POST", `/v1/me/applications/${draft26}/withdraw`, { as: DRAFT });
    expect(r.status).toBe(200);
    expect(r.json.applications[0]).toMatchObject({ status: "withdrawn", canWithdraw: false });
    expect((await t.sql`select count(*)::int as n from selection_decisions where application_id = ${draft26}`)[0]!.n).toBe(0);
    expect((await t.call("POST", "/v1/manage/editions/2026/decisions/release", { as: M1, body: {} })).json.released).toBe(0);
    const d = await t.call("PUT", `/v1/manage/applications/${draft26}/decision`, { as: M1, body: { outcome: "selected" } });
    expect(d.json.code).toBe("application_withdrawn");
    expect((await t.call("POST", `/v1/me/applications/${draft26}/withdraw`, { as: DRAFT })).json.code).toBe("already_withdrawn");
  });

  it("a selected team that withdraws loses that edition's access; its other year is untouched", async () => {
    // NOT was corrected to selected above.
    expect((await t.call("GET", "/v1/editions/2026/me", { as: NOT })).status).toBe(200);
    await t.call("POST", `/v1/me/applications/${not26}/withdraw`, { as: NOT });
    expect((await t.call("GET", "/v1/editions/2026/me", { as: NOT })).status).toBe(403);
    const audit = await t.sql<{ data: { previousStatus: string } }[]>`
      select data from audit_events where action = 'application.withdrawn' and entity_id = ${not26}`;
    expect(audit[0]!.data.previousStatus).toBe("selected");
    const list = (await t.call("GET", "/v1/manage/editions/2026/applications", { as: M1 })).json;
    expect(list.items.find((i: { id: string }) => i.id === not26).status).toBe("withdrawn");
    expect(list.selectedTotal).toBe(0);
  });

  it("withdrawal is possible until the event starts, then refused", async () => {
    const mine = (await t.call("GET", "/v1/me/applications", { as: SEL })).json.applications;
    expect(mine.map((a: { edition: number; canWithdraw: boolean }) => [a.edition, a.canWithdraw])).toEqual([[2026, true], [2027, true]]);
    t.setNow(new Date("2026-12-18T08:00:00+05:30"));
    const late = (await t.call("GET", "/v1/me/applications", { as: SEL })).json.applications;
    expect(late.map((a: { edition: number; canWithdraw: boolean }) => [a.edition, a.canWithdraw])).toEqual([[2026, false], [2027, true]]);
    expect((await t.call("POST", `/v1/me/applications/${sel26}/withdraw`, { as: SEL })).json.code).toBe("event_started");
    const r = await t.call("POST", `/v1/me/applications/${sel27}/withdraw`, { as: SEL });
    expect(r.json.applications.map((a: { status: string }) => a.status)).toEqual(["not_selected", "withdrawn"]);
    t.setNow(AFTER_DEADLINE);
  });
});
