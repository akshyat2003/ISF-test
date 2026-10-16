import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { devVerifier, issueDevToken, jwksVerifier } from "../src/platform/auth.js";
import { createTestApp, SECRET, type TestApp } from "./helpers.js";

describe("dev verifier", () => {
  it("accepts its own tokens and rejects tampered or foreign ones", async () => {
    const v = devVerifier(SECRET);
    const good = await issueDevToken(SECRET, "Person@Example.com", { aal: "aal2" });
    await expect(v.verify(good)).resolves.toEqual({
      sub: "dev|person@example.com", email: "person@example.com", phone: null, aal: "aal2",
      devAssertions: { emailVerified: true, phoneVerified: false },
    });
    await expect(v.verify(good.slice(0, -2) + "xx")).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(v.verify(await issueDevToken("another-secret-that-is-32-characters!!", "a@b.c"))).rejects.toMatchObject({ status: 401 });
  });
});

describe("JWKS verifier (Supabase Auth shape) trusts only signature, subject and aal", () => {
  const issuer = "https://project.supabase.co/auth/v1";
  let sign: (claims: Record<string, unknown>, o?: { aud?: string; exp?: boolean }) => Promise<string>;
  let verifier: ReturnType<typeof jwksVerifier>;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256" };
    verifier = jwksVerifier({ jwks: createLocalJWKSet({ keys: [jwk] }), issuer, audience: "authenticated" });
    sign = (claims, o = {}) => {
      let j = new SignJWT(claims).setProtectedHeader({ alg: "ES256", kid: "k1" }).setIssuer(issuer)
        .setAudience(o.aud ?? "authenticated").setSubject("4b7e-uuid").setIssuedAt();
      if (o.exp !== false) j = j.setExpirationTime("1h");
      return j.sign(privateKey);
    };
  });

  it("never treats user_metadata.email_verified or an OTP amr as proof of email control", async () => {
    const token = await sign({ email: "Lead@Startup.in", aal: "aal1", role: "authenticated",
      user_metadata: { email_verified: true }, amr: [{ method: "otp", timestamp: 1 }] });
    await expect(verifier.verify(token)).resolves.toEqual({
      sub: "4b7e-uuid", email: "lead@startup.in", phone: null, aal: "aal1",
      devAssertions: { emailVerified: false, phoneVerified: false },
    });
  });

  it("normalises Supabase phone claims (stored without +)", async () => {
    expect((await verifier.verify(await sign({ phone: "919876543210" }))).phone).toBe("+919876543210");
  });

  it("rejects anonymous sessions, wrong audiences, other roles, tokens without exp and symmetric tokens", async () => {
    await expect(verifier.verify(await sign({ is_anonymous: true }))).rejects.toMatchObject({ status: 401 });
    await expect(verifier.verify(await sign({}, { aud: "service_role" }))).rejects.toMatchObject({ status: 401 });
    await expect(verifier.verify(await sign({ role: "service_role" }))).rejects.toMatchObject({ status: 401 });
    await expect(verifier.verify(await sign({}, { exp: false }))).rejects.toMatchObject({ status: 401 });
    const hs = await new SignJWT({}).setProtectedHeader({ alg: "HS256", kid: "k1" }).setIssuer(issuer).setAudience("authenticated")
      .setSubject("x").setExpirationTime("1h").sign(new TextEncoder().encode("a-shared-secret-of-thirty-two-chars!!"));
    await expect(verifier.verify(hs)).rejects.toMatchObject({ status: 401 });
  });
});

describe("account deactivation and routing", () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });

  it("blocks deactivated accounts", async () => {
    await t.sql`insert into user_accounts (auth_subject, email, full_name, status) values ('dev|gone@jathara.test', 'gone@jathara.test', 'Gone', 'deactivated')`;
    const r = await t.call("GET", "/v1/me/applications", { as: "gone@jathara.test" });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("account_deactivated");
  });

  it("returns problem+json for unknown routes", async () => {
    const r = await t.call("GET", "/v1/nope");
    expect(r.status).toBe(404);
    expect(r.json.code).toBe("route_not_found");
  });
});

describe("CORS for the website and console", () => {
  it("allows the configured origins to send PUT and DELETE with a bearer token, and nobody else", async () => {
    const c = await createTestApp({ corsOrigins: ["http://localhost:3001"] });
    try {
      const pre = (origin: string, method: string) => c.app.inject({
        method: "OPTIONS", url: "/v1/manage/applications/00000000-0000-4000-8000-000000000000/decision",
        headers: { origin, "access-control-request-method": method, "access-control-request-headers": "authorization,content-type" },
      });
      for (const m of ["PUT", "DELETE"]) {
        const r = await pre("http://localhost:3001", m);
        expect(r.statusCode).toBe(204);
        expect(r.headers["access-control-allow-origin"]).toBe("http://localhost:3001");
        expect(String(r.headers["access-control-allow-methods"])).toContain(m);
      }
      expect((await pre("https://evil.example", "PUT")).headers["access-control-allow-origin"]).toBeUndefined();
    } finally {
      await c.close();
    }
  });
});
