"use client";
import { createSession } from "@sj/web-session";

// Staff sign in with their work email. Staff roles require MFA (aal2) when REQUIRE_STAFF_MFA=true, which is
// mandatory in production (FR-IAM-11); see app/mfa.
const resolveApiUrl = () => {
  if (typeof window !== "undefined") {
    const envUrl = process.env.NEXT_PUBLIC_API_URL;
    if (envUrl && envUrl.startsWith("http")) {
      return envUrl;
    }
    // Always use same-origin relative URL so requests hit the Next.js /v1 route
    // (or its API_PROXY_TARGET if configured) and credentials stay aligned.
    return "";
  }
  return "";
};

export const { api, authMode, startSignIn, verifyCode, signOut, useSessionIdentity, storeSessionToken, mfa } = createSession({
  apiUrl: resolveApiUrl(),
  authMode: process.env.NEXT_PUBLIC_AUTH_MODE === "supabase" && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "supabase" : "dev",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  storageKey: "sj.console.session",
  signInMethods: ["email"],
});
/** @deprecated alias kept for existing pages */
export const useSessionEmail = useSessionIdentity;
