import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AFTER_DEADLINE, createTestApp, registration, type TestApp } from "./helpers.js";

let t: TestApp;
const MANAGER = "manager@jathara.test";
const ADMIN = "admin@jathara.test";
const BOTH = "both@example.com";    // applies for 2026 and 2027
const ONE = "one@example.com";      // applies for 2026 only
const EXTRA = "extra@example.com";
let bothApp26: string, bothApp27: string, oneApp26: string, extraApp26: string, lateApp26: string;

beforeAll(async () => {
  t = await createTestApp();
  await t.staff(MANAGER, ["management"]);
  await t.staff(ADMIN, ["admin"]);
  const a = await t.call("POST", "/v1/me/registrations", { as: BOTH, body: registration({ name: "Both Years Co", yearOption: "both" }) });
  [bothApp26, bothApp27] = a.json.applications.map((x: { id: string }) => x.id);
  oneApp26 = (await t.call("POST", "/v1/me/registrations", { as: ONE, body: registration({ name: "One Year Co" }) })).json.applications[0].id;
  extraApp26 = (await t.call("POST", "/v1/me/registrations", { as: EXTRA, body: registration({ name: "Extra Co" }) })).json.applications[0].id;
  lateApp26 = (await t.call("POST", "/v1/me/registrations", { as: "late-limit@example.com", body: registration({ name: "Late Limit Co" }) })).json.applications[0].id;
  // TBD-42: decisions are made after registration closes, so the whole cohort is reviewed together.
  t.setNow(AFTER_DEADLINE);
});
afterAll(async () => { await t.close(); });

const LIST = "/v1/manage/editions/2026/applications";

describe("AT-02 / AT-13 authorisation", () => {
  it("rejects anonymous callers and applicants", async () => {
    expect((await t.call("GET", LIST)).status).toBe(401);
    const r = await t.call("GET", LIST, { as: ONE });
    expect(r.status).toBe(403);
    expect((await t.call("PUT", `/v1/manage/applications/${oneApp26}/decision`, { as: ONE, body: { outcome: "selected" } })).status).toBe(403);
  });

  it("an Admin without an explicit management grant cannot review or decide (FR-IAM-06)", async () => {
    expect((await t.call("GET", LIST, { as: ADMIN })).status).toBe(403);
    expect((await t.call("PUT", `/v1/manage/applications/${oneApp26}/decision`, { as: ADMIN, body: { outcome: "selected" } })).status).toBe(403);
    expect((await t.call("POST", "/v1/manage/editions/2026/decisions/release", { as: ADMIN, body: {} })).status).toBe(403);
  });

  it("applicants only ever see their own applications", async () => {
    const r = await t.call("GET", "/v1/me/applications", { as: ONE });
    expect(r.json.applications.map((a: { id: string }) => a.id)).toEqual([oneApp26]);
  });

  it("Management sees the edition's applications with leader details and the other edition", async () => {
    const r = await t.call("GET", LIST, { as: MANAGER });
    expect(r.status).toBe(200);
    expect(r.json.items).toHaveLength(4);
    const both = r.json.items.find((i: { id: string }) => i.id === bothApp26);
    expect(both.leader.mobile).toBe("+919876543210");
    expect(both.otherEditions).toEqual([{ edition: 2027, status: "submitted" }]);
    expect(r.json.counts).toEqual({ submitted: 4 });
  });

  it("rejects unknown editions and malformed ids cleanly", async () => {
    expect((await t.call("GET", "/v1/manage/editions/2030/applications", { as: MANAGER })).json.code).toBe("edition_not_found");
    expect((await t.call("GET", "/v1/manage/applications/not-a-uuid", { as: MANAGER })).status).toBe(400);
  });
});

describe("staff MFA (FR-IAM-11)", () => {
  it("requires an aal2 session for management when REQUIRE_STAFF_MFA is on", async () => {
    const m = await createTestApp({ requireStaffMfa: true });
    try {
      await m.staff("mfa@jathara.test", ["management"]);
      const without = await m.call("GET", LIST, { as: "mfa@jathara.test", aal: "aal1" });
      expect(without.status).toBe(403);
      expect(without.json.code).toBe("mfa_required");
      expect((await m.call("GET", LIST, { as: "mfa@jathara.test", aal: "aal2" })).status).toBe(200);
    } finally {
      await m.close();
    }
  });
});

describe("decision drafts (FR-SEL-09)", () => {
  it("a draft is visible to Management but not to the applicant", async () => {
    const d = await t.call("PUT", `/v1/manage/applications/${oneApp26}/decision`, { as: MANAGER, body: { outcome: "selected", reason: "Strong pilot" } });
    expect(d.status).toBe(200);
    expect(d.json.status).toBe("decision_drafted");
    expect(d.json.decision).toMatchObject({ outcome: "selected", releasedAt: null });
    expect((await t.call("GET", "/v1/me/applications", { as: ONE })).json.applications[0].status).toBe("under_review");
    expect((await t.call("GET", LIST, { as: MANAGER })).json.selectedTotal).toBe(1);
  });

  it("a draft can be withdrawn, restoring the previous status", async () => {
    await t.call("PUT", `/v1/manage/applications/${extraApp26}/decision`, { as: MANAGER, body: { outcome: "selected" } });
    const w = await t.call("DELETE", `/v1/manage/applications/${extraApp26}/decision`, { as: MANAGER });
    expect(w.status).toBe(200);
    expect(w.json.status).toBe("submitted");
    expect(w.json.decision).toBeNull();
  });
});

describe("AT-14 release, AT-10 independent editions, AT-09 access", () => {
  it("releases drafts: selected gains 2026 access and a congratulation; not-selected keeps 2027 untouched", async () => {
    await t.call("PUT", `/v1/manage/applications/${bothApp26}/decision`, { as: MANAGER, body: { outcome: "not_selected" } });
    const r = await t.call("POST", "/v1/manage/editions/2026/decisions/release", { as: MANAGER, body: {} });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ released: 2, selected: 1, notSelected: 1, warnings: [] });

    // Selected applicant
    const one = await t.call("GET", "/v1/me/applications", { as: ONE });
    expect(one.json.applications[0]).toMatchObject({ status: "selected" });
    expect(one.json.applications[0].decidedAt).not.toBeNull();
    expect((await t.call("GET", "/v1/editions/2026/me", { as: ONE })).status).toBe(200);
    const n1 = (await t.call("GET", "/v1/me/notifications", { as: ONE })).json;
    expect(n1).toHaveLength(1);
    expect(n1[0].title).toContain("Congratulations");

    // Not-selected applicant: 2027 application unchanged, no 2026 access, told 2027 is unaffected
    const both = await t.call("GET", "/v1/me/applications", { as: BOTH });
    expect(both.json.applications.map((a: { edition: number; status: string }) => [a.edition, a.status]))
      .toEqual([[2026, "not_selected"], [2027, "under_review"]]);
    expect((await t.call("GET", "/v1/editions/2026/me", { as: BOTH })).status).toBe(403);
    const n2 = (await t.call("GET", "/v1/me/notifications", { as: BOTH })).json;
    expect(n2[0].body).toContain("2027 application is separate");
    const [a27] = await t.sql`select status from applications where id = ${bothApp27}`;
    expect(a27!.status).toBe("submitted");
  });

  it("TBD-14: each released result is also queued once for the applicant's verified contact, with its status visible", async () => {
    const out = await t.sql<{ channel: string; recipient: string; status: string; kind: string }[]>`
      select channel, recipient, status, kind from notifications where channel <> 'in_app' order by recipient`;
    expect(out).toEqual([
      { channel: "email", recipient: BOTH, status: "queued", kind: "selection_result" },
      { channel: "email", recipient: ONE, status: "queued", kind: "selection_result" },
    ]);
    const detail = (await t.call("GET", `/v1/manage/applications/${oneApp26}`, { as: MANAGER })).json;
    expect(detail.notifications.map((n: { channel: string; status: string }) => [n.channel, n.status]))
      .toEqual([["in_app", "sent"], ["email", "queued"]]);
  });

  it("re-releasing is harmless: nothing new is released or notified", async () => {
    const r = await t.call("POST", "/v1/manage/editions/2026/decisions/release", { as: MANAGER, body: {} });
    expect(r.json.released).toBe(0);
    const [n] = await t.sql`select count(*)::int as n from notifications`;
    expect(n!.n).toBe(4);   // two in-app + two email, unchanged
  });

  it("released decisions cannot be changed or withdrawn (TBD-37)", async () => {
    expect((await t.call("PUT", `/v1/manage/applications/${oneApp26}/decision`, { as: MANAGER, body: { outcome: "not_selected" } })).json.code).toBe("decision_released");
    expect((await t.call("DELETE", `/v1/manage/applications/${oneApp26}/decision`, { as: MANAGER })).json.code).toBe("decision_released");
  });

  it("refuses to release an explicit list that includes applications without a draft", async () => {
    const r = await t.call("POST", "/v1/manage/editions/2026/decisions/release", { as: MANAGER, body: { applicationIds: [extraApp26] } });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("not_releasable");
  });
});

describe("TBD-42: nothing is decided for an edition while its registration is open", () => {
  it("refuses drafts and releases for 2027, which is still open", async () => {
    const d = await t.call("PUT", `/v1/manage/applications/${bothApp27}/decision`, { as: MANAGER, body: { outcome: "selected" } });
    expect(d.status).toBe(409);
    expect(d.json.code).toBe("registration_open");
    const r = await t.call("POST", "/v1/manage/editions/2027/decisions/release", { as: MANAGER, body: {} });
    expect(r.json.code).toBe("registration_open");
    expect((await t.sql`select count(*)::int as n from selection_decisions where application_id = ${bothApp27}`)[0]!.n).toBe(0);
  });
});

describe("AT-15 configurable selection limit: releasing above it needs explicit confirmation (TBD-19)", () => {
  it("is set without code changes; a release above the limit is refused unless confirmed, and nothing is released", async () => {
    const s = await t.call("PUT", "/v1/manage/editions/2026/selection-limit", { as: MANAGER, body: { limit: 1 } });
    expect(s.json).toEqual({ edition: 2026, selectionLimit: 1 });
    await t.call("PUT", `/v1/manage/applications/${extraApp26}/decision`, { as: MANAGER, body: { outcome: "selected" } });
    const [before] = await t.sql<{ n: number }[]>`select count(*)::int as n from notifications`;

    const refused = await t.call("POST", "/v1/manage/editions/2026/decisions/release", { as: MANAGER, body: { applicationIds: [extraApp26] } });
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ code: "selection_limit_exceeded", limit: 1, selectedAfterRelease: 2 });
    const [app] = await t.sql<{ status: string }[]>`select status from applications where id = ${extraApp26}`;
    expect(app!.status).toBe("decision_drafted");
    const [after] = await t.sql<{ n: number }[]>`select count(*)::int as n from notifications`;
    expect(after!.n).toBe(before!.n);
  });

  it("a confirmed release goes ahead, warns, and is audited separately", async () => {
    const r = await t.call("POST", "/v1/manage/editions/2026/decisions/release", {
      as: MANAGER, body: { applicationIds: [extraApp26], confirmOverLimit: true },
    });
    expect(r.status).toBe(200);
    expect(r.json.released).toBe(1);
    expect(r.json.warnings[0]).toContain("above the configured limit of 1");
    const [ev] = await t.sql<{ data: { limit: number; selectedAfterRelease: number } }[]>`
      select data from audit_events where action = 'selection.limit_exceeded_confirmed'`;
    expect(ev!.data).toMatchObject({ limit: 1, selectedAfterRelease: 2 });
  });

  it("releasing only 'not selected' decisions never needs confirmation, even when already above the limit", async () => {
    const late = lateApp26;
    await t.call("PUT", `/v1/manage/applications/${late}/decision`, { as: MANAGER, body: { outcome: "not_selected" } });
    const r = await t.call("POST", "/v1/manage/editions/2026/decisions/release", { as: MANAGER, body: { applicationIds: [late] } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ released: 1, selected: 0, notSelected: 1 });
  });

  it("the console's list reports drafted plus released selections against the limit", async () => {
    const r = await t.call("GET", LIST, { as: MANAGER });
    expect(r.json.selectionLimit).toBe(1);
    expect(r.json.selectedTotal).toBe(2);
  });
});

describe("AT-34 audit trail (slice scope)", () => {
  it("records registration, account, decision, release and configuration actions", async () => {
    const rows = await t.sql<{ action: string }[]>`select distinct action from audit_events order by action`;
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining([
      "account.created", "registration.submitted", "decision.drafted", "decision.draft_withdrawn",
      "decision.released", "edition.selection_limit_set", "selection.limit_exceeded_confirmed",
    ]));
  });
});
