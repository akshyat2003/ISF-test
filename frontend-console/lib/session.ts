"use client";
import { createSession } from "@sj/web-session";

// Staff sign in with their work email. Staff roles require MFA (aal2) when REQUIRE_STAFF_MFA=true, which is
// mandatory in production (FR-IAM-11); see app/mfa.
export const { api, authMode, startSignIn, verifyCode, signOut, useSessionIdentity, mfa } = createSession({
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  authMode: process.env.NEXT_PUBLIC_AUTH_MODE === "supabase" ? "supabase" : "dev",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  storageKey: "sj.console.session",
  signInMethods: ["email"],
});
/** @deprecated alias kept for existing pages */
export const useSessionEmail = useSessionIdentity;
