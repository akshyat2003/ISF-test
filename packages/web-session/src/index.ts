// Browser sign-in shared by the website and the console.
// AUTH_MODE=dev: API-issued development tokens (local only; the API refuses this mode in production).
// AUTH_MODE=supabase: Supabase Auth one-time codes by email or SMS (channels per environment, decision TBD-12),
// plus TOTP multi-factor authentication for staff roles (FR-IAM-11).
import { useSyncExternalStore } from "react";
import { createApi } from "@sj/client";
import type { SignInIdentifier, SignInMethod } from "@sj/contracts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SessionConfig = {
  apiUrl: string;
  authMode: "dev" | "supabase";
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  /** Separate keys keep website and console sessions apart on the same browser. */
  storageKey: string;
  /** One-time-code channels this interface offers (see parseSignInMethods). */
  signInMethods?: SignInMethod[];
};

export type MfaStatus = { level: "aal1" | "aal2"; factorId: string | null };
export type MfaEnrolment = { factorId: string; qrCode: string; secret: string };

const asIdentifier = (id: string | SignInIdentifier): SignInIdentifier => (typeof id === "string" ? { email: id } : id);

export function createSession(cfg: SessionConfig) {
  let supabase: SupabaseClient | null = null;
  const sb = () => (supabase ??= createClient(cfg.supabaseUrl!, cfg.supabaseAnonKey!, { auth: { storageKey: cfg.storageKey } }));

  let cachedToken: string | null = null;
  const listeners = new Set<() => void>();
  const changed = (token: string | null) => { cachedToken = token; listeners.forEach((l) => l()); };

  async function getToken(): Promise<string | null> {
    if (typeof window === "undefined") return null;
    if (cfg.authMode === "dev") return sessionStorage.getItem(cfg.storageKey);
    const { data } = await sb().auth.getSession();
    return data.session?.access_token ?? null;
  }

  const api = createApi({ baseUrl: cfg.apiUrl, getToken });

  function storeDevToken(token: string) {
    sessionStorage.setItem(cfg.storageKey, token);
    changed(token);
  }

  /** Dev: signs in immediately. Supabase: sends a one-time code by email or SMS and returns "code_sent". */
  async function startSignIn(id: string | SignInIdentifier, opts: { mfa?: boolean } = {}): Promise<"signed_in" | "code_sent"> {
    const who = asIdentifier(id);
    if (cfg.authMode === "dev") {
      storeDevToken((await api.devSession(who, opts.mfa)).token);
      return "signed_in";
    }
    const { error } = "email" in who
      ? await sb().auth.signInWithOtp({ email: who.email, options: { shouldCreateUser: true } })
      : await sb().auth.signInWithOtp({ phone: who.phone, options: { shouldCreateUser: true } });
    if (error) throw error;
    return "code_sent";
  }

  async function verifyCode(id: string | SignInIdentifier, code: string): Promise<void> {
    const who = asIdentifier(id);
    const { data, error } = "email" in who
      ? await sb().auth.verifyOtp({ email: who.email, token: code, type: "email" })
      : await sb().auth.verifyOtp({ phone: who.phone, token: code, type: "sms" });
    if (error) throw error;
    changed(data.session?.access_token ?? null);
  }

  async function signOut(): Promise<void> {
    if (cfg.authMode === "dev") sessionStorage.removeItem(cfg.storageKey);
    else await sb().auth.signOut();
    changed(null);
  }

  function claimsOf(token: string | null): Record<string, unknown> | null {
    if (!token) return null;
    try {
      return JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    } catch {
      return null;
    }
  }

  /** What to show as "signed in as": the email, or the mobile number for phone sign-ins. */
  function identityFrom(token: string | null): string | null {
    const c = claimsOf(token);
    if (!c) return null;
    if (typeof c.email === "string" && c.email) return c.email;
    if (typeof c.phone === "string" && c.phone) return c.phone.startsWith("+") ? c.phone : `+${c.phone}`;
    return null;
  }

  /** Signed-in identity (email or mobile); null when signed out; undefined during server rendering. */
  function useSessionIdentity(): string | null | undefined {
    return useSyncExternalStore(
      (cb) => {
        listeners.add(cb);
        if (cachedToken === null) void getToken().then((t) => t !== cachedToken && changed(t));
        return () => listeners.delete(cb);
      },
      () => identityFrom(cachedToken ?? (cfg.authMode === "dev" ? sessionStorage.getItem(cfg.storageKey) : null)),
      () => undefined,
    );
  }

  // ---------------------------------------------------------------- staff MFA (FR-IAM-11)
  const mfa = {
    /** Current assurance level and the verified TOTP factor, if one is enrolled. */
    async status(): Promise<MfaStatus> {
      if (cfg.authMode === "dev") {
        const c = claimsOf(await getToken());
        return { level: c?.aal === "aal2" ? "aal2" : "aal1", factorId: "dev" };
      }
      const [{ data: aal }, { data: factors }] = await Promise.all([
        sb().auth.mfa.getAuthenticatorAssuranceLevel(),
        sb().auth.mfa.listFactors(),
      ]);
      const verified = factors?.totp.find((f) => f.status === "verified");
      return { level: aal?.currentLevel === "aal2" ? "aal2" : "aal1", factorId: verified?.id ?? null };
    },
    /** Starts TOTP enrolment: show the QR code (or secret) to add to an authenticator app, then call verify. */
    async enrol(): Promise<MfaEnrolment> {
      if (cfg.authMode === "dev") throw new Error("Development sign-in has no authenticator enrolment");
      const { data, error } = await sb().auth.mfa.enroll({ factorType: "totp", friendlyName: "Startup Jathara console" });
      if (error) throw error;
      return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
    },
    /** Verifies a 6-digit code and upgrades the session to aal2. Dev: re-issues a development aal2 token. */
    async verify(factorId: string | null, code: string): Promise<void> {
      if (!/^\d{6}$/.test(code.trim())) throw new Error("Enter the 6-digit code from your authenticator app");
      if (cfg.authMode === "dev") {
        const c = claimsOf(await getToken());
        const who: SignInIdentifier | null = typeof c?.email === "string" ? { email: c.email } : typeof c?.phone === "string" ? { phone: c.phone } : null;
        if (!who) throw new Error("Sign in first");
        storeDevToken((await api.devSession(who, true)).token);
        return;
      }
      if (!factorId) throw new Error("No authenticator is enrolled");
      const { data, error } = await sb().auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
      if (error) throw error;
      changed(data.access_token);
    },
  };

  return {
    api, authMode: cfg.authMode, signInMethods: cfg.signInMethods ?? (["email", "phone"] as SignInMethod[]),
    getToken, startSignIn, verifyCode, signOut, useSessionIdentity,
    /** @deprecated use useSessionIdentity (it also returns mobile numbers for phone sign-ins). */
    useSessionEmail: useSessionIdentity,
    mfa,
  };
}
