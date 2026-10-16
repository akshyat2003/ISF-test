// Production policy: staff MFA is mandatory in production (FR-IAM-11) and signals the step-up to clients.
// Sign-in by mobile number (dev tokens) for phone OTP support (TBD-12: email, mobile or both).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createTestApp, registration, type TestApp } from "./helpers.js";

const base = { DATABASE_URL: "postgres://x@localhost/x", DEV_AUTH_SECRET: "d".repeat(40) };
const prodSupabase = { ...base, NODE_ENV: "production", AUTH_MODE: "supabase", SUPABASE_URL: "https://p.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "s".repeat(40) };

const ready = {
  ...prodSupabase, CORS_ORIGINS: "https://startupjathara.example,https://console.startupjathara.example", LAUNCH_APPROVED: "true",
  RANKING_PROVIDER: "vertex", RANKING_VERTEX_PROJECT: "isf-prod", RANKING_VERTEX_MODEL: "model-under-evaluation",
  STORAGE_PROVIDER: "supabase",
  HELPDESK_PROVIDER: "vertex", HELPDESK_VERTEX_PROJECT: "isf-prod", HELPDESK_VERTEX_MODEL: "model-under-evaluation",
};
const APPROVED = { privacyNoticeVersion: "2026-11-01" };

describe("production launch gate and staff MFA policy (fail closed)", () => {
  it("starts in production only when every launch check is satisfied, with MFA on by default", () => {
    const c = loadConfig(ready as never, APPROVED);
    expect(c.requireStaffMfa).toBe(true);
    expect(c.nodeEnv).toBe("production");
  });
  it("refuses to start while the privacy notice is still the draft", () => {
    expect(() => loadConfig(ready as never)).toThrow(/privacy notice is still a draft \(draft-/);
  });
  it("refuses without the explicit launch sign-off", () => {
    expect(() => loadConfig({ ...ready, LAUNCH_APPROVED: undefined } as never, APPROVED)).toThrow(/LAUNCH_APPROVED=true is not set/);
  });
  it("refuses REQUIRE_STAFF_MFA=false in production", () => {
    expect(() => loadConfig({ ...ready, REQUIRE_STAFF_MFA: "false" } as never, APPROVED)).toThrow(/REQUIRE_STAFF_MFA=false is not allowed/);
  });
  it("refuses development sign-in and non-https or localhost origins in production", () => {
    expect(() => loadConfig({ ...ready, AUTH_MODE: "dev" } as never, APPROVED)).toThrow(/AUTH_MODE must be supabase/);
    expect(() => loadConfig({ ...ready, CORS_ORIGINS: "http://localhost:3000" } as never, APPROVED)).toThrow(/CORS_ORIGINS must list only/);
  });
  it("treats an empty LAUNCH_APPROVED or REQUIRE_STAFF_MFA (as in .env.example) as unset, never as approval or opt-out", () => {
    expect(() => loadConfig({ ...ready, LAUNCH_APPROVED: "" } as never, APPROVED)).toThrow(/LAUNCH_APPROVED=true is not set/);
    expect(loadConfig({ ...ready, REQUIRE_STAFF_MFA: "" } as never, APPROVED).requireStaffMfa).toBe(true);
    expect(loadConfig({ ...base, REQUIRE_STAFF_MFA: "", LAUNCH_APPROVED: "" } as never).requireStaffMfa).toBe(false);
  });
  it("lists every unmet item at once", () => {
    let msg = "";
    try { loadConfig({ ...base, NODE_ENV: "production" } as never); } catch (e) { msg = (e as Error).message; }
    expect(msg.match(/^- /gm)?.length).toBe(7);   // auth mode, CORS, draft privacy notice, stub ranking, database storage, Help Desk stub, launch sign-off
  });
  it("refuses the development ranking stub, log-only message providers and a pinned clock in production (Phase 5)", () => {
    expect(() => loadConfig({ ...ready, RANKING_PROVIDER: "stub" } as never, APPROVED)).toThrow(/RANKING_PROVIDER must be vertex/);
    expect(() => loadConfig({ ...ready, NOTIFY_EMAIL_PROVIDER: "log" } as never, APPROVED)).toThrow(/=log is for development only/);
    expect(() => loadConfig({ ...ready, NOTIFY_SMS_PROVIDER: "log" } as never, APPROVED)).toThrow(/=log is for development only/);
    expect(() => loadConfig({ ...ready, DEV_NOW: "2026-11-06T10:00:00+05:30" } as never, APPROVED)).toThrow(/DEV_NOW must not be set/);
  });
  it("refuses a Help Desk without a real model in production, and needs the Vertex settings when chosen (Phase 8)", () => {
    expect(() => loadConfig({ ...ready, HELPDESK_PROVIDER: "stub" } as never, APPROVED)).toThrow(/HELPDESK_PROVIDER must be vertex/);
    expect(() => loadConfig({ ...ready, HELPDESK_PROVIDER: "none" } as never, APPROVED)).toThrow(/HELPDESK_PROVIDER must be vertex/);
    expect(() => loadConfig({ ...ready, HELPDESK_PROVIDER: undefined } as never, APPROVED)).toThrow(/HELPDESK_PROVIDER must be vertex/);
    expect(() => loadConfig({ ...base, HELPDESK_PROVIDER: "vertex" } as never)).toThrow(/HELPDESK_VERTEX_PROJECT and HELPDESK_VERTEX_MODEL are required/);
    const c = loadConfig({ ...ready, HELPDESK_VERTEX_SERVICE_ACCOUNT: "helpdesk@isf-prod.iam.gserviceaccount.com" } as never, APPROVED);
    expect(c.helpdesk).toMatchObject({ provider: "vertex", vertex: { serviceAccount: "helpdesk@isf-prod.iam.gserviceaccount.com" } });
    // Separate from ranking (FR-HD-20): different settings, never shared.
    expect(c.helpdesk.vertex).not.toBe(c.ranking.vertex);
  });
  it("refuses the development document storage and log-only push in production (Phase 7)", () => {
    expect(() => loadConfig({ ...ready, STORAGE_PROVIDER: "database" } as never, APPROVED)).toThrow(/STORAGE_PROVIDER must be supabase/);
    expect(() => loadConfig({ ...ready, STORAGE_PROVIDER: undefined } as never, APPROVED)).toThrow(/STORAGE_PROVIDER must be supabase/);
    expect(() => loadConfig({ ...ready, PUSH_PROVIDER: "log" } as never, APPROVED)).toThrow(/PUSH_PROVIDER=log is for development only/);
    expect(loadConfig({ ...ready, PUSH_PROVIDER: "expo" } as never, APPROVED).push.provider).toBe("expo");
    expect(() => loadConfig({ ...base, STORAGE_PROVIDER: "supabase" } as never)).toThrow(/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when STORAGE_PROVIDER/);
  });
  it("allows DEV_NOW only for development sign-in, and requires provider settings when a provider is chosen", () => {
    expect(loadConfig({ ...base, DEV_NOW: "2026-11-06T10:00:00+05:30" } as never).devNow?.toISOString()).toBe("2026-11-06T04:30:00.000Z");
    expect(() => loadConfig({ ...base, AUTH_MODE: "supabase", SUPABASE_URL: "https://p.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "s".repeat(40),
      DEV_NOW: "2026-11-06T10:00:00+05:30" } as never)).toThrow(/DEV_NOW is allowed only/);
    expect(() => loadConfig({ ...base, RANKING_PROVIDER: "vertex" } as never)).toThrow(/RANKING_VERTEX_PROJECT and RANKING_VERTEX_MODEL are required/);
    expect(() => loadConfig({ ...base, NOTIFY_EMAIL_PROVIDER: "smtp" } as never)).toThrow(/SMTP_HOST and NOTIFY_EMAIL_FROM are required/);
    expect(() => loadConfig({ ...base, NOTIFY_SMS_PROVIDER: "msg91" } as never)).toThrow(/MSG91_AUTH_KEY is required/);
  });
  it("leaves MFA off by default in development, switchable for testing", () => {
    expect(loadConfig({ ...base } as never).requireStaffMfa).toBe(false);
    expect(loadConfig({ ...base, REQUIRE_STAFF_MFA: "true" } as never).requireStaffMfa).toBe(true);
  });
});

describe("MFA step-up signal (GET /v1/me) with REQUIRE_STAFF_MFA=true", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ requireStaffMfa: true });
    await t.staff("mgr@jathara.test", ["management"]);
    await t.staff("adm@jathara.test", ["admin"]);
    await t.staff("vol@jathara.test", ["volunteer"]);
  });
  afterAll(async () => { await t.close(); });

  for (const email of ["mgr@jathara.test", "adm@jathara.test"]) {
    it(`${email}: aal1 withholds every staff permission and asks for MFA; aal2 restores them`, async () => {
      const weak = (await t.call("GET", "/v1/me", { as: email })).json;
      expect(weak.mfaRequired).toBe(true);
      expect(weak.permissions).toEqual(["application.read_own", "application.withdraw_own", "emergency.report", "helpdesk.use", "notification.read_own", "push.register_own", "registration.submit", "support.request_own"]);
      const strong = (await t.call("GET", "/v1/me", { as: email, aal: "aal2" })).json;
      expect(strong.mfaRequired).toBe(false);
      expect(strong.permissions.length).toBeGreaterThan(3);
    });
  }

  it("every privileged endpoint answers mfa_required without aal2", async () => {
    for (const [as, method, url] of [
      ["mgr@jathara.test", "GET", "/v1/manage/editions/2026/applications"],
      ["mgr@jathara.test", "POST", "/v1/manage/editions/2026/decisions/release"],
      ["adm@jathara.test", "GET", "/v1/admin/users"],
      ["adm@jathara.test", "GET", "/v1/admin/imports"],
    ] as const) {
      const r = await t.call(method, url, { as, body: method === "POST" ? {} : undefined });
      expect({ url, code: r.json.code }).toEqual({ url, code: "mfa_required" });
    }
  });

  it("participants are never asked for MFA", async () => {
    expect((await t.call("GET", "/v1/me", { as: "vol@jathara.test" })).json.mfaRequired).toBe(false);
    expect((await t.call("POST", "/v1/me/registrations", { as: "applicant@example.com", body: registration() })).status).toBe(201);
  });
});

describe("development sign-in by mobile number", () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });

  it("issues a phone-verified token; the person can register with that number only", async () => {
    const r = await t.call("POST", "/v1/dev/session", { body: { phone: "98765 00011" } });
    expect(r.status).toBe(200);
    const token = r.json.token;
    const me = await t.call("GET", "/v1/me", { token });
    expect(me.json.account).toBeNull();
    const reg = await t.call("POST", "/v1/me/registrations", { token, body: registration({ name: "Phone Only Co", mobile: "91234 56789" }) });
    expect(reg.status).toBe(201);
    const [u] = await t.sql`select email, mobile_e164 from user_accounts where auth_subject = 'dev|+919876500011'`;
    expect(u).toEqual({ email: null, mobile_e164: "+919876500011" });   // the verified number, not the typed one
  });

  it("requires exactly one valid identifier", async () => {
    expect((await t.call("POST", "/v1/dev/session", { body: { email: "a@b.in", phone: "9876500011" } })).status).toBe(400);
    expect((await t.call("POST", "/v1/dev/session", { body: {} })).status).toBe(400);
    expect((await t.call("POST", "/v1/dev/session", { body: { phone: "12345" } })).status).toBe(400);
  });
});
