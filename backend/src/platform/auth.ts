// Token verification and identity verification.
//
// 1. A TokenVerifier checks the access token's signature and returns its claims. Those claims say WHO the
//    session belongs to (sub) and how strongly they authenticated (aal) — nothing else is trusted.
// 2. An IdentityResolver answers "which email / phone has this identity PROVEN control of?" from an
//    authoritative source. It is consulted only when we need it: linking a pre-created account or creating a
//    new one. In Supabase mode that source is the Auth Admin API record (email_confirmed_at / phone_confirmed_at);
//    token claims such as user_metadata (user-editable) or amr (the "otp" method is shared by email and SMS)
//    are never treated as proof of verification.
//
// Everything about what a person may do lives in our own tables (role_grants, edition_access).
import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { normaliseMobile } from "@sj/contracts";
import { AppError, unauthorized } from "./errors.js";

export type Claims = {
  sub: string;
  /** Email/phone as asserted by the token. NOT proof of control; see IdentityResolver. */
  email: string | null;
  phone: string | null;
  /** Authenticator assurance level: aal2 means the user completed MFA. */
  aal: "aal1" | "aal2";
  /** Verification assertions carried by our own self-signed dev tokens only. Always false for external IdPs. */
  devAssertions: { emailVerified: boolean; phoneVerified: boolean };
};

/** Identifiers the identity has proven control of. Null when unproven or unknown (fail closed). */
export type VerifiedIdentity = { email: string | null; phone: string | null };

export interface TokenVerifier {
  verify(token: string): Promise<Claims>;
}

export interface IdentityResolver {
  /** Must throw (never guess) when the authoritative source cannot be reached. */
  resolve(claims: Claims): Promise<VerifiedIdentity>;
}

const DEV_ISSUER = "sj-dev";
const NO_ASSERTIONS = { emailVerified: false, phoneVerified: false };

// ---------------------------------------------------------------- development (local and tests only)

/** Refused in production by loadConfig(). */
export function devVerifier(secret: string): TokenVerifier {
  const key = new TextEncoder().encode(secret);
  return {
    async verify(token) {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, key, { issuer: DEV_ISSUER, algorithms: ["HS256"], requiredClaims: ["sub", "exp"] }));
      } catch {
        throw unauthorized("Invalid or expired token");
      }
      return toClaims(payload, { emailVerified: payload.email_verified === true, phoneVerified: payload.phone_verified === true });
    },
  };
}

/** Dev tokens are signed with our own secret, so their verification assertions are trustworthy in dev/test. */
export const devIdentityResolver: IdentityResolver = {
  async resolve(c) {
    return { email: c.devAssertions.emailVerified ? c.email : null, phone: c.devAssertions.phoneVerified ? c.phone : null };
  },
};

export async function issueDevToken(
  secret: string,
  email: string | null,
  opts: { aal?: "aal1" | "aal2"; ttl?: string; phone?: string; emailVerified?: boolean; phoneVerified?: boolean; sub?: string } = {},
) {
  const subject = opts.sub ?? `dev|${(email ?? opts.phone ?? "").toLowerCase()}`;
  return new SignJWT({
    ...(email ? { email, email_verified: opts.emailVerified ?? true } : {}),
    ...(opts.phone ? { phone: opts.phone, phone_verified: opts.phoneVerified ?? true } : {}),
    aal: opts.aal ?? "aal1",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(subject)
    .setIssuer(DEV_ISSUER)
    .setIssuedAt()
    .setExpirationTime(opts.ttl ?? "8h")
    .sign(new TextEncoder().encode(secret));
}

// ---------------------------------------------------------------- Supabase Auth

/** Verifies Supabase access tokens against the project's published signing keys (JWKS). */
export function jwksVerifier(opts: { jwks: JWTVerifyGetKey; issuer: string; audience: string }): TokenVerifier {
  return {
    async verify(token) {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, opts.jwks, {
          issuer: opts.issuer,
          audience: opts.audience,
          algorithms: ["ES256", "RS256"],          // asymmetric only; never accept HS256/none for external tokens
          requiredClaims: ["sub", "exp"],
        }));
      } catch {
        throw unauthorized("Invalid or expired token");
      }
      if (payload.is_anonymous === true) throw unauthorized("Anonymous sessions are not accepted");
      if (payload.role !== undefined && payload.role !== "authenticated") throw unauthorized("Unsupported token role");
      // Deliberately ignores user_metadata.email_verified and amr: neither proves control of an email address.
      return toClaims(payload, NO_ASSERTIONS);
    },
  };
}

export function supabaseVerifier(supabaseUrl: string): TokenVerifier {
  const base = supabaseUrl.replace(/\/$/, "");
  return jwksVerifier({
    jwks: createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`)),
    issuer: `${base}/auth/v1`,
    audience: "authenticated",
  });
}

type AdminUser = {
  id?: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  phone?: string | null;
  phone_confirmed_at?: string | null;
  banned_until?: string | null;
  deleted_at?: string | null;
  is_anonymous?: boolean;
};

/**
 * Reads the authoritative user record from the Supabase Auth Admin API (server-side, service-role key).
 * An identifier counts as verified only if Supabase recorded its confirmation AND it matches the token,
 * so a stale or altered token cannot vouch for a different address. Any failure is an error, never "verified".
 */
export function supabaseIdentityResolver(opts: { supabaseUrl: string; serviceRoleKey: string; fetch?: typeof fetch; now?: () => Date }): IdentityResolver {
  const base = opts.supabaseUrl.replace(/\/$/, "");
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? (() => new Date());
  return {
    async resolve(c) {
      let res: Response;
      try {
        res = await doFetch(`${base}/auth/v1/admin/users/${encodeURIComponent(c.sub)}`, {
          headers: { apikey: opts.serviceRoleKey, authorization: `Bearer ${opts.serviceRoleKey}` },
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        throw identityUnavailable();
      }
      if (res.status === 404) return { email: null, phone: null };
      if (!res.ok) throw identityUnavailable();
      let u: AdminUser;
      try {
        u = (await res.json()) as AdminUser;
      } catch {
        throw identityUnavailable();
      }
      if (u.id !== c.sub || u.is_anonymous || u.deleted_at) return { email: null, phone: null };
      if (u.banned_until && new Date(u.banned_until) > now()) return { email: null, phone: null };

      const recEmail = u.email ? u.email.toLowerCase() : null;
      const email = recEmail && u.email_confirmed_at && c.email === recEmail ? recEmail : null;
      const recPhone = u.phone ? normaliseMobile(u.phone.startsWith("+") ? u.phone : `+${u.phone}`) : null;
      const tokenPhone = c.phone ? normaliseMobile(c.phone.startsWith("+") ? c.phone : `+${c.phone}`) : null;
      const phone = recPhone && u.phone_confirmed_at && tokenPhone === recPhone ? recPhone : null;
      return { email, phone };
    },
  };
}

const identityUnavailable = () =>
  new AppError(503, "identity_unavailable", "Identity check unavailable", "We could not confirm your sign-in details. Please try again shortly.");

// ---------------------------------------------------------------- helpers

function toClaims(p: JWTPayload, assertions: Claims["devAssertions"]): Claims {
  if (!p.sub) throw unauthorized("Token has no subject");
  const phoneRaw = typeof p.phone === "string" && p.phone ? p.phone : null;
  return {
    sub: p.sub,
    email: typeof p.email === "string" && p.email ? p.email.toLowerCase() : null,
    phone: phoneRaw ? normaliseMobile(phoneRaw.startsWith("+") ? phoneRaw : `+${phoneRaw}`) : null,
    aal: p.aal === "aal2" ? "aal2" : "aal1",
    devAssertions: assertions,
  };
}

export function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m ? m[1]!.trim() : null;
}
