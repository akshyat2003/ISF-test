// Phase 3 — who-am-I, secure single-use activation, and account/role administration (FR-IAM-05, -06, -08…10).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BEFORE_DEADLINE, createTestApp, type TestApp } from "./helpers.js";

const ADMIN = "admin@jathara.test";
const ADMIN2 = "admin2@jathara.test";
const MANAGER = "manager@jathara.test";

/** An imported, not-yet-linked participant awaiting activation. */
async function imported(t: TestApp, email: string, role = "volunteer") {
  const [u] = await t.sql<{ id: string }[]>`
    insert into user_accounts (email, full_name, status) values (${email}, ${email}, 'pending_activation') returning id`;
  await t.sql`insert into role_grants (user_id, role, edition_id) values (${u!.id}, ${role}, 2026)`;
  await t.sql`insert into edition_access (user_id, edition_id, source) values (${u!.id}, 2026, 'predefined')`;
  return u!.id;
}

describe("GET /v1/me", () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); await t.staff(MANAGER, ["management"]); });
  afterAll(async () => { await t.close(); });

  it("describes a signed-in person without an account", async () => {
    const r = await t.call("GET", "/v1/me", { as: "new@example.com" });
    expect(r.json).toEqual({ account: null, roles: [], editionAccess: [],
      permissions: ["application.read_own", "application.withdraw_own", "emergency.report", "helpdesk.use", "notification.read_own", "push.register_own", "registration.submit", "support.request_own"], mfaRequired: false });
  });

  it("describes staff with their roles and permissions", async () => {
    const r = await t.call("GET", "/v1/me", { as: MANAGER });
    expect(r.json.account).toMatchObject({ email: MANAGER, status: "active" });
    expect(r.json.roles).toEqual(["management"]);
    expect(r.json.permissions).toContain("decision.release");
  });

  it("shows a pending account its status only: no roles, no access, no permissions beyond any signed-in user", async () => {
    await imported(t, "pending@vol.test");
    const r = await t.call("GET", "/v1/me", { as: "pending@vol.test" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ account: { email: "pending@vol.test", status: "pending_activation" }, roles: [], editionAccess: [] });
    expect((await t.call("GET", "/v1/editions/2026/me", { as: "pending@vol.test" })).json.code).toBe("account_not_active");
  });

  it("requires a token", async () => {
    expect((await t.call("GET", "/v1/me")).status).toBe(401);
  });
});

describe("activation: single-use, time-limited, bound to the account (FR-IAM-08, -10)", () => {
  let t: TestApp;
  let vol: string;
  beforeAll(async () => {
    t = await createTestApp();
    await t.staff(ADMIN, ["admin"]);
    await t.staff(MANAGER, ["management"]);
    vol = await imported(t, "vol@jathara.test");
  });
  afterAll(async () => { await t.close(); });

  const issue = (id: string, as = ADMIN) => t.call("POST", `/v1/admin/users/${id}/activation`, { as });
  const redeem = (as: string, token: string) => t.call("POST", "/v1/me/activation", { as, body: { token } });

  it("only Admin issues activation codes, only for pending accounts", async () => {
    expect((await issue(vol, MANAGER)).status).toBe(403);
    const [mgr] = await t.sql`select id from user_accounts where email = ${MANAGER}`;
    expect((await issue(mgr!.id)).json.code).toBe("not_pending");
  });

  it("stores only a hash of the code; the plaintext never reaches the database or audit log", async () => {
    const r = await issue(vol);
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ delivery: "manual", token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(new Date(r.json.expiresAt).getTime() - BEFORE_DEADLINE.getTime()).toBe(72 * 3600_000);
    const dump = JSON.stringify(await t.sql`select * from activation_tokens`) + JSON.stringify(await t.sql`select * from audit_events`);
    expect(dump).not.toContain(r.json.token);
  });

  it("a newer code revokes the older one", async () => {
    const first = (await issue(vol)).json.token;
    const second = (await issue(vol)).json.token;
    expect((await redeem("vol@jathara.test", first)).json.code).toBe("activation_invalid");
    expect((await t.sql`select count(*)::int as n from activation_tokens where user_id = ${vol} and used_at is null and revoked_at is null`)[0]!.n).toBe(1);
    expect(second).not.toBe(first);
  });

  it("refuses a code used by a different signed-in person, and audits the attempt", async () => {
    const code = (await issue(vol)).json.token;
    const r = await redeem("attacker@example.com", code);
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("activation_invalid");
    const other = await imported(t, "other@jathara.test");
    expect((await redeem("other@jathara.test", code)).json.code).toBe("activation_invalid");
    expect((await t.sql`select data from audit_events where action = 'activation.rejected' and entity_id = ${other}`)[0]!.data).toEqual({ reason: "other_account" });
    expect((await t.sql`select status from user_accounts where id = ${vol}`)[0]!.status).toBe("pending_activation");
  });

  it("refuses expired codes", async () => {
    const code = (await issue(vol)).json.token;
    t.setNow(new Date(BEFORE_DEADLINE.getTime() + 72 * 3600_000 + 1000));
    expect((await redeem("vol@jathara.test", code)).json.code).toBe("activation_invalid");
    t.setNow(BEFORE_DEADLINE);
  });

  it("activates the right person once; roles and edition access follow; the code cannot be reused", async () => {
    const code = (await issue(vol)).json.token;
    const r = await redeem("vol@jathara.test", code);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ account: { status: "active" }, roles: ["volunteer"], editionAccess: [2026] });
    expect((await t.call("GET", "/v1/editions/2026/me", { as: "vol@jathara.test" })).status).toBe(200);
    expect((await redeem("vol@jathara.test", code)).json.code).toBe("activation_invalid");
    expect((await t.sql`select count(*)::int as n from audit_events where action = 'activation.redeemed'`)[0]!.n).toBe(1);
    // Single use is enforced by the database too.
    await expect(t.sql`update activation_tokens set used_at = null where user_id = ${vol} and used_at is not null`)
      .rejects.toMatchObject({ hint: "ACTIVATION-SINGLE-USE" });
  });

  it("an unverified email cannot reach a pending account to activate it", async () => {
    const id = await imported(t, "victim@jathara.test");
    const code = (await issue(id)).json.token;
    const token = await t.tokenWith("victim@jathara.test", { emailVerified: false, sub: "attacker-sub" });
    const r = await t.call("POST", "/v1/me/activation", { token, body: { token: code } });
    expect(r.json.code).toBe("activation_invalid");
    expect((await t.sql`select status, auth_subject from user_accounts where id = ${id}`)[0]).toEqual({ status: "pending_activation", auth_subject: null });
  });
});

describe("account and role administration", () => {
  let t: TestApp;
  let adminId: string;
  let mgrId: string;
  beforeAll(async () => {
    t = await createTestApp();
    adminId = await t.staff(ADMIN, ["admin"]);
    await t.staff(ADMIN2, ["admin"]);
    mgrId = await t.staff(MANAGER, ["management"]);
  });
  afterAll(async () => { await t.close(); });

  it("Admin lists and searches accounts; Management and participants cannot (FR-IAM-06)", async () => {
    expect((await t.call("GET", "/v1/admin/users", { as: MANAGER })).status).toBe(403);
    const all = await t.call("GET", "/v1/admin/users", { as: ADMIN });
    expect(all.json.total).toBe(3);
    const found = await t.call("GET", "/v1/admin/users?q=manager&role=management", { as: ADMIN });
    expect(found.json.items.map((u: { email: string }) => u.email)).toEqual([MANAGER]);
    expect(found.json.items[0]).toMatchObject({ status: "active", signInLinked: true, roles: [{ role: "management", edition: null }] });
    expect((await t.call("GET", "/v1/admin/users?q=%25", { as: ADMIN })).json.total).toBe(0);   // wildcards are literal
  });

  it("grants and revokes roles; revocation takes effect on the next request (FR-IAM-09)", async () => {
    const vol = await t.staff("vol@jathara.test", []);
    const g = await t.call("POST", `/v1/admin/users/${vol}/roles`, { as: ADMIN, body: { role: "management" } });
    expect(g.status).toBe(201);
    expect((await t.call("GET", "/v1/manage/editions/2026/applications", { as: "vol@jathara.test" })).status).toBe(200);
    expect((await t.call("POST", `/v1/admin/users/${vol}/roles`, { as: ADMIN, body: { role: "management" } })).json.code).toBe("role_already_granted");
    const grantId = g.json.roles.find((r: { role: string }) => r.role === "management").grantId;
    const r = await t.call("DELETE", `/v1/admin/users/${vol}/roles/${grantId}`, { as: ADMIN });
    expect(r.json.roles).toEqual([]);
    expect((await t.call("GET", "/v1/manage/editions/2026/applications", { as: "vol@jathara.test" })).status).toBe(403);
    expect((await t.sql`select action from audit_events where entity_id = ${vol} order by id`).map((a) => a.action)).toEqual(["role.granted", "role.revoked"]);
  });

  it("supports edition-scoped grants (FR-IAM-13)", async () => {
    const r = await t.call("POST", `/v1/admin/users/${mgrId}/roles`, { as: ADMIN, body: { role: "jury_member", edition: 2027 } });
    expect(r.json.roles).toContainEqual(expect.objectContaining({ role: "jury_member", edition: 2027 }));
    expect((await t.call("POST", `/v1/admin/users/${mgrId}/roles`, { as: ADMIN, body: { role: "delegate", edition: 2099 } })).status).toBe(404);
  });

  it("nobody can change their own roles or status", async () => {
    for (const [method, url, body] of [
      ["POST", `/v1/admin/users/${adminId}/roles`, { role: "management" }],
      ["POST", `/v1/admin/users/${adminId}/deactivate`, undefined],
    ] as const) {
      const r = await t.call(method, url, { as: ADMIN, body });
      expect(r.json.code).toBe("self_change_forbidden");
    }
    expect((await t.sql`select count(*)::int as n from role_grants where user_id = ${adminId} and role = 'management'`)[0]!.n).toBe(0);
  });

  it("deactivation locks the account on its next request and cancels pending activation codes", async () => {
    expect((await t.call("GET", "/v1/manage/editions/2026/applications", { as: MANAGER })).status).toBe(200);
    await t.call("POST", `/v1/admin/users/${mgrId}/deactivate`, { as: ADMIN2 });
    expect((await t.call("GET", "/v1/manage/editions/2026/applications", { as: MANAGER })).json.code).toBe("account_deactivated");
    const back = await t.call("POST", `/v1/admin/users/${mgrId}/reactivate`, { as: ADMIN2 });
    expect(back.json.status).toBe("active");   // was activated before
    expect((await t.call("GET", "/v1/manage/editions/2026/applications", { as: MANAGER })).status).toBe(200);

    const [p] = await t.sql<{ id: string }[]>`insert into user_accounts (email, full_name, status) values ('p@jathara.test', 'P', 'pending_activation') returning id`;
    await t.call("POST", `/v1/admin/users/${p!.id}/activation`, { as: ADMIN });
    await t.call("POST", `/v1/admin/users/${p!.id}/deactivate`, { as: ADMIN });
    expect((await t.sql`select count(*)::int as n from activation_tokens where user_id = ${p!.id} and revoked_at is null`)[0]!.n).toBe(0);
    const r = await t.call("POST", `/v1/admin/users/${p!.id}/reactivate`, { as: ADMIN });
    expect(r.json.status).toBe("pending_activation");   // never activated: no shortcut to active
    expect((await t.call("POST", `/v1/admin/users/${p!.id}/reactivate`, { as: ADMIN })).json.code).toBe("not_deactivated");
  });

  it("requires MFA for Admin actions when staff MFA is enforced (FR-IAM-11)", async () => {
    const s = await createTestApp({ requireStaffMfa: true });
    try {
      await s.staff(ADMIN, ["admin"]);
      expect((await s.call("GET", "/v1/admin/users", { as: ADMIN })).json.code).toBe("mfa_required");
      expect((await s.call("GET", "/v1/admin/users", { as: ADMIN, aal: "aal2" })).status).toBe(200);
    } finally {
      await s.close();
    }
  });
});
