"use client";
import { parseSignInMethods } from "@sj/contracts";
import { createSession } from "@sj/web-session";

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

export const { api, authMode, signInMethods, startSignIn, verifyCode, signOut, useSessionIdentity, storeSessionToken } = createSession({
  apiUrl: resolveApiUrl(),
  authMode: process.env.NEXT_PUBLIC_AUTH_MODE === "supabase" && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "supabase" : "dev",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  storageKey: "sj.web.session",
  signInMethods: parseSignInMethods(process.env.NEXT_PUBLIC_SIGNIN_METHODS),
});
