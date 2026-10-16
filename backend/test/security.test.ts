// Security regression tests (15 Oct 2026 fix): authoritative identity verification, account-linking attacks,
// phone-only identities, and server-side activation enforcement across every protected role.
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLES, type Role } from "@sj/contracts";
import { jwksVerifier, supabaseIdentityResolver, type Claims, type IdentityResolver } from "../src/platform/auth.js";
import { AppError } from "../src/platform/errors.js";
import { createTestApp, registration, type TestApp } from "./helpers.js";

const URL_ = "https://project.supabase.co";
const claims = (o: Partial<Claims> = {}): Claims => ({
  sub: "user-1", email: null, phone: null, aal: "aal1", devAssertions: { emailVerified: false, phoneVerified: false }, ...o,
});

/** Fake Supabase Admin API: returns the given record for any user id, or a status code. */
function adminApi(record: Record<string, unknown> | number, calls: { url: string; headers: Headers }[] = []) {
  return (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers) });
    if (typeof record === "number") return new Response("{}", { status: record });
    return new Response(JSON.stringify(record), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

// ---------------------------------------------------------------- authoritative identity source
describe("Supabase identity resolver uses the authoritative user record", () => {
  const resolve = (record: Record<string, unknown> | number, c: Claims) =>
    supabaseIdentityResolver({ supabaseUrl: URL_, serviceRoleKey: "service-role-key-for-tests", fetch: adminApi(record) }).resolve(c);

  it("verifies an email only when Supabase recorded its confirmation and it matches the token", async () => {
    const c = claims({ email: "lead@startup.in" });
    expect(await resolve({ id: "user-1", email: "Lead@Startup.in", email_confirmed_at: "2026-10-01T00:00:00Z" }, c)).toEqual({ email: "lead@startup.in", phone: null });
    expect(await resolve({ id: "user-1", email: "lead@startup.in", email_confirmed_at: null }, c)).toEqual({ email: null, phone: null });
    // stale/altered token: the record's confirmed email differs from what the token asserts
    expect(await resolve({ id: "user-1", email: "other@startup.in", email_confirmed_at: "2026-10-01T00:00:00Z" }, c)).toEqual({ email: null, phone: null });
  });

  it("handles phone OTP identities: confirmed phone verified, unconfirmed email ignored", async () => {
    const c = claims({ email: "victim@jathara.test", phone: "+919876543210" });
    expect(await resolve({ id: "user-1", email: "victim@jathara.test", email_confirmed_at: null, phone: "919876543210", phone_confirmed_at: "2026-10-01T00:00:00Z" }, c))
      .toEqual({ email: null, phone: "+919876543210" });
    expect(await resolve({ id: "user-1", phone: "919876543210", phone_confirmed_at: null }, c)).toEqual({ email: null, phone: null });
    expect(await resolve({ id: "user-1", phone: "919999999999", phone_confirmed_at: "2026-10-01T00:00:00Z" }, c)).toEqual({ email: null, phone: null });
  });

  it("returns nothing for mismatched ids, banned, deleted, anonymous or missing users", async () => {
    const c = claims({ email: "a@b.in" });
    const ok = { email: "a@b.in", email_confirmed_at: "2026-10-01T00:00:00Z" };
    for (const rec of [
      { ...ok, id: "someone-else" },
      { ...ok, id: "user-1", banned_until: "2999-01-01T00:00:00Z" },
      { ...ok, id: "user-1", deleted_at: "2026-10-01T00:00:00Z" },
      { ...ok, id: "user-1", is_anonymous: true },
    ]) expect(await resolve(rec, c)).toEqual({ email: null, phone: null });
    expect(await resolve(404, c)).toEqual({ email: null, phone: null });
  });

  it("fails closed (503) when the identity source errors, and calls it with the service key only server-side", async () => {
    await expect(resolve(500, claims())).rejects.toMatchObject({ status: 503, code: "identity_unavailable" });
    const failing = supabaseIdentityResolver({ supabaseUrl: URL_, serviceRoleKey: "k".repeat(24),
      fetch: (async () => { throw new TypeError("network down"); }) as typeof fetch });
    await expect(failing.resolve(claims())).rejects.toMatchObject({ code: "identity_unavailable" });
    const calls: { url: string; headers: Headers }[] = [];
    await supabaseIdentityResolver({ supabaseUrl: `${URL_}/`, serviceRoleKey: "service-role-key-for-tests", fetch: adminApi(404, calls) })
      .resolve(claims({ sub: "a/b?c" }));
    expect(calls[0]!.url).toBe(`${URL_}/auth/v1/admin/users/a%2Fb%3Fc`);
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer service-role-key-for-tests");
  });
});

// ---------------------------------------------------------------- account linking attacks
describe("account linking (pre-created staff and imported accounts)", () => {
  let t: TestApp;
  const MANAGE = "/v1/manage/editions/2026/applications";
  const preCreate = async (email: string | null, opts: { mobile?: string; status?: string; roles?: Role[]; sub?: string } = {}) => {
    const [u] = await t.sql<{ id: string }[]>`
      insert into user_accounts (auth_subject, email, mobile_e164, full_name, status)
      values (${opts.sub ?? null}, ${email}, ${opts.mobile ?? null}, 'Pre-created', 'active') returning id`;
    for (const r of opts.roles ?? []) await t.sql`insert into role_grants (user_id, role) values (${u!.id}, ${r})`;
    // Grants first: migration 0003 refuses new grants to deactivated accounts.
    if (opts.status && opts.status !== "active") await t.sql`update user_accounts set status = ${opts.status} where id = ${u!.id}`;
    return u!.id;
  };
  const subjectOf = async (id: string) => (await t.sql`select auth_subject from user_accounts where id = ${id}`)[0]!.auth_subject as string | null;
  const audits = async (action: string) => Number((await t.sql`select count(*)::int as n from audit_events where action = ${action}`)[0]!.n);

  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });

  it("does not link when the email is asserted but not verified", async () => {
    const staff = await preCreate("boss@jathara.test", { roles: ["management"] });
    const token = await t.tokenWith("boss@jathara.test", { emailVerified: false, sub: "attacker-1" });
    expect((await t.call("GET", MANAGE, { token })).status).toBe(403);
    expect((await t.call("GET", "/v1/me/applications", { token })).json).toEqual({ startup: null, applications: [] });
    expect(await subjectOf(staff)).toBeNull();
    expect(await audits("identity.linked")).toBe(0);
  });

  it("links an active pre-created account once the email is verified, granting its roles", async () => {
    const staff = await preCreate("lead@jathara.test", { roles: ["management"] });
    const token = await t.tokenWith("lead@jathara.test", { sub: "owner-1" });
    expect((await t.call("GET", MANAGE, { token })).status).toBe(200);
    expect(await subjectOf(staff)).toBe("owner-1");
  });

  it("never re-links an account that is already bound to another identity", async () => {
    const token = await t.tokenWith("lead@jathara.test", { sub: "attacker-2" });   // same verified email, different identity
    expect((await t.call("GET", MANAGE, { token })).status).toBe(403);
    const reg = await t.call("POST", "/v1/me/registrations", { token, body: registration({ name: "Squat Co" }) });
    expect(reg.status).toBe(409);
    expect(reg.json.code).toBe("email_in_use");
    expect((await t.sql`select auth_subject from user_accounts where lower(email) = 'lead@jathara.test'`)[0]!.auth_subject).toBe("owner-1");
  });

  it("never links a deactivated account", async () => {
    const gone = await preCreate("former@jathara.test", { status: "deactivated", roles: ["management"] });
    const token = await t.tokenWith("former@jathara.test", { sub: "former-new" });
    expect((await t.call("GET", MANAGE, { token })).status).toBe(403);
    expect(await subjectOf(gone)).toBeNull();
  });

  it("refuses when a verified email and a verified phone point at different accounts", async () => {
    const a = await preCreate("alpha@jathara.test", { roles: ["management"] });
    const b = await preCreate(null, { mobile: "+919000000011", roles: ["admin"] });
    const token = await t.tokenWith("alpha@jathara.test", { phone: "+919000000011", sub: "conflict-1" });
    expect((await t.call("GET", MANAGE, { token })).status).toBe(403);
    expect([await subjectOf(a), await subjectOf(b)]).toEqual([null, null]);
    expect(await audits("identity.link_refused")).toBeGreaterThanOrEqual(1);
  });

  it("links a phone-only identity to the single pre-created account with that number and no email", async () => {
    const vol = await preCreate(null, { mobile: "+919000000022", roles: ["volunteer"] });
    const token = await t.tokenWith(null, { phone: "+919000000022", sub: "phone-1" });
    const r = await t.call("GET", "/v1/me/applications", { token });
    expect(r.status).toBe(200);
    expect(await subjectOf(vol)).toBe("phone-1");
    const [a] = await t.sql`select data from audit_events where action = 'identity.linked' and entity_id = ${vol}`;
    expect(a!.data).toEqual({ via: "verified_phone" });
  });

  it("does not let a phone alone claim an account that has an email on file", async () => {
    const acct = await preCreate("withmail@jathara.test", { mobile: "+919000000033", roles: ["management"] });
    const token = await t.tokenWith(null, { phone: "+919000000033", sub: "phone-2" });
    expect((await t.call("GET", MANAGE, { token })).status).toBe(403);
    expect(await subjectOf(acct)).toBeNull();
  });

  it("refuses ambiguous phone matches (shared numbers)", async () => {
    const x = await preCreate(null, { mobile: "+919000000044" });
    const y = await preCreate(null, { mobile: "+919000000044" });
    const token = await t.tokenWith(null, { phone: "+919000000044", sub: "phone-3" });
    await t.call("GET", "/v1/me/applications", { token });
    expect([await subjectOf(x), await subjectOf(y)]).toEqual([null, null]);
    const [r] = await t.sql`select data from audit_events where action = 'identity.link_refused' and entity_id = 'phone-3'`;
    expect(r!.data).toMatchObject({ reason: "ambiguous", candidates: 2 });
  });

  it("does not link a phone that is asserted but not verified", async () => {
    const acct = await preCreate(null, { mobile: "+919000000055", roles: ["volunteer"] });
    const token = await t.tokenWith(null, { phone: "+919000000055", phoneVerified: false, sub: "phone-4" });
    await t.call("GET", "/v1/me/applications", { token });
    expect(await subjectOf(acct)).toBeNull();
  });

  it("returns 503 for unlinked identities when the identity source is down, without affecting linked accounts", async () => {
    const down: IdentityResolver = {
      async resolve() { throw new AppError(503, "identity_unavailable", "Identity service unavailable", "Try again shortly."); },
    };
    const failing = await createTestApp({ identity: down });
    try {
      await failing.staff("linked@jathara.test", ["management"]);
      expect((await failing.call("GET", MANAGE, { as: "linked@jathara.test" })).status).toBe(200);   // no lookup needed
      const r = await failing.call("GET", "/v1/me/applications", { as: "newcomer@example.com" });
      expect(r.status).toBe(503);
      expect(r.json.code).toBe("identity_unavailable");
    } finally {
      await failing.close();
    }
  });
});

describe("full stack with Supabase-shaped tokens: forged verification claims cannot take over staff accounts", () => {
  it("an attacker token with user_metadata.email_verified and an OTP amr stays unlinked when Supabase has not confirmed the email", async () => {
    const issuer = `${URL_}/auth/v1`;
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256" }] });
    const record = { id: "attacker-sub", email: "director@jathara.test", email_confirmed_at: null, phone: "919811111111", phone_confirmed_at: "2026-10-01T00:00:00Z" };
    const t = await createTestApp({
      verifier: jwksVerifier({ jwks, issuer, audience: "authenticated" }),
      identity: supabaseIdentityResolver({ supabaseUrl: URL_, serviceRoleKey: "service-role-key-for-tests", fetch: adminApi(record) }),
    });
    try {
      const [staff] = await t.sql`insert into user_accounts (email, full_name) values ('director@jathara.test', 'Director') returning id`;
      await t.sql`insert into role_grants (user_id, role) values (${staff!.id}, 'management')`;
      const token = await new SignJWT({ email: "director@jathara.test", phone: "919811111111", role: "authenticated",
        user_metadata: { email_verified: true }, amr: [{ method: "otp", timestamp: 1 }] })
        .setProtectedHeader({ alg: "ES256", kid: "k1" }).setIssuer(issuer).setAudience("authenticated")
        .setSubject("attacker-sub").setIssuedAt().setExpirationTime("1h").sign(privateKey);

      const r = await t.call("GET", "/v1/manage/editions/2026/applications", { token });
      expect(r.status).toBe(403);
      expect((await t.sql`select auth_subject from user_accounts where id = ${staff!.id}`)[0]!.auth_subject).toBeNull();

      // The attacker can still register as a new applicant via their verified phone, but cannot claim the email.
      const reg = await t.call("POST", "/v1/me/registrations", { token, body: registration({ name: "Attacker Co", mobile: "9811111111" }) });
      expect(reg.status).toBe(201);
      const [u] = await t.sql`select email, mobile_e164 from user_accounts where auth_subject = 'attacker-sub'`;
      expect(u).toEqual({ email: null, mobile_e164: "+919811111111" });
    } finally {
      await t.close();
    }
  });
});

// ---------------------------------------------------------------- registration identity rules
describe("registration requires a proven identifier and stores only proven ones", () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });

  it("rejects registration when neither email nor phone is verified, creating nothing", async () => {
    const token = await t.tokenWith("someone@example.com", { emailVerified: false, sub: "unverified-1" });
    const r = await t.call("POST", "/v1/me/registrations", { token, body: registration({ name: "Ghost Co" }) });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("identity_unverified");
    expect((await t.sql`select count(*)::int as n from user_accounts`)[0]!.n).toBe(0);
  });

  it("accepts a phone-only identity and never stores the unverified email", async () => {
    const token = await t.tokenWith("claimed@example.com", { emailVerified: false, phone: "+919822222222", sub: "phone-reg" });
    const r = await t.call("POST", "/v1/me/registrations", { token, body: registration({ name: "Phone Co", mobile: "98765 00000" }) });
    expect(r.status).toBe(201);
    const [u] = await t.sql`select email, mobile_e164, status from user_accounts where auth_subject = 'phone-reg'`;
    expect(u).toEqual({ email: null, mobile_e164: "+919822222222", status: "active" });
  });
});

// ---------------------------------------------------------------- activation enforcement
describe("activation status is enforced server-side for every protected role", () => {
  let t: TestApp;
  let appId: string;
  beforeAll(async () => {
    t = await createTestApp();
    appId = (await t.call("POST", "/v1/me/registrations", { as: "applicant@example.com", body: registration({ name: "Target Co" }) })).json.applications[0].id;
  });
  afterAll(async () => { await t.close(); });

  const endpoints = () => [
    ["GET", "/v1/me/applications", undefined],
    ["GET", "/v1/me/notifications", undefined],
    ["POST", "/v1/me/registrations", registration({ name: "Bypass Co" })],
    ["GET", "/v1/editions/2026/me", undefined],
    ["GET", "/v1/manage/editions/2026/applications", undefined],
    ["GET", `/v1/manage/applications/${appId}`, undefined],
    ["PUT", `/v1/manage/applications/${appId}/decision`, { outcome: "selected" }],
    ["DELETE", `/v1/manage/applications/${appId}/decision`, undefined],
    ["POST", "/v1/manage/editions/2026/decisions/release", {}],
    ["PUT", "/v1/manage/editions/2026/selection-limit", { limit: 5 }],
  ] as const;

  const account = async (role: Role, status: string, tag = "") => {
    const email = `${role}.${status}${tag}@jathara.test`;
    const [u] = await t.sql<{ id: string }[]>`
      insert into user_accounts (auth_subject, email, full_name, status) values (${`dev|${email}`}, ${email}, ${email}, 'active') returning id`;
    // Grants and access exist from before the status change, so a refusal proves the status check, not missing grants.
    await t.sql`insert into role_grants (user_id, role) values (${u!.id}, ${role})`;
    await t.sql`insert into edition_access (user_id, edition_id, source) values (${u!.id}, 2026, 'predefined')`;
    if (status !== "active") await t.sql`update user_accounts set status = ${status} where id = ${u!.id}`;
    return { email, id: u!.id };
  };

  for (const role of ROLES) {
    it(`${role}: pending_activation and deactivated accounts are refused on every endpoint`, async () => {
      for (const [status, code] of [["pending_activation", "account_not_active"], ["deactivated", "account_deactivated"]] as const) {
        const a = await account(role, status);
        for (const [method, url, body] of endpoints()) {
          const r = await t.call(method, url, { as: a.email, body, aal: "aal2" });
          expect({ role, status, method, url, http: r.status, code: r.json?.code }).toEqual({ role, status, method, url, http: 403, code });
        }
        // Direct API calls changed nothing: no activation, no new grants, no applications.
        const [u] = await t.sql`select status from user_accounts where id = ${a.id}`;
        expect(u!.status).toBe(status);
        expect((await t.sql`select count(*)::int as n from role_grants where user_id = ${a.id}`)[0]!.n).toBe(1);
        expect((await t.sql`select count(*)::int as n from applications where submitted_by = ${a.id}`)[0]!.n).toBe(0);
      }
    });

    it(`${role}: an active account keeps exactly its role's access`, async () => {
      const a = await account(role, "active");
      expect((await t.call("GET", "/v1/me/applications", { as: a.email })).status).toBe(200);
      expect((await t.call("GET", "/v1/editions/2026/me", { as: a.email })).status).toBe(200);
      const manage = await t.call("GET", "/v1/manage/editions/2026/applications", { as: a.email });
      expect(manage.status).toBe(role === "management" ? 200 : 403);
    });
  }

  it("a pending account is linked on verified sign-in but stays locked until activated", async () => {
    const [u] = await t.sql`insert into user_accounts (email, full_name, status) values ('imported@jathara.test', 'Imported', 'pending_activation') returning id`;
    await t.sql`insert into role_grants (user_id, role) values (${u!.id}, 'management')`;
    const r = await t.call("GET", "/v1/manage/editions/2026/applications", { as: "imported@jathara.test" });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("account_not_active");
    const [after] = await t.sql`select auth_subject, status from user_accounts where id = ${u!.id}`;
    expect(after).toEqual({ auth_subject: "dev|imported@jathara.test", status: "pending_activation" });
  });

  it("the database refuses decisions and releases by non-active managers, and grants to deactivated accounts", async () => {
    const pend = await account("management", "pending_activation", ".db");
    await expect(t.sql`insert into selection_decisions (application_id, outcome, status_before_decision, decided_by)
                       values (${appId}, 'selected', 'submitted', ${pend.id})`).rejects.toMatchObject({ code: "P0001", hint: "DC-02" });
    const live = await account("management", "active", ".db");
    await t.sql`insert into selection_decisions (application_id, outcome, status_before_decision, decided_by)
                values (${appId}, 'selected', 'submitted', ${live.id})`;
    await expect(t.sql`update selection_decisions set released_at = now(), released_by = ${pend.id} where application_id = ${appId}`)
      .rejects.toMatchObject({ hint: "DC-02" });
    await t.sql`delete from selection_decisions where application_id = ${appId}`;
    const gone = await account("volunteer", "deactivated", ".db");
    await expect(t.sql`insert into role_grants (user_id, role) values (${gone.id}, 'management')`).rejects.toMatchObject({ hint: "ACCOUNT-STATUS" });
    await expect(t.sql`insert into edition_access (user_id, edition_id, source) values (${gone.id}, 2027, 'selected')`).rejects.toMatchObject({ hint: "ACCOUNT-STATUS" });
  });
});
