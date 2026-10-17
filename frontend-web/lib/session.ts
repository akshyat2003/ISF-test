"use client";
import { parseSignInMethods } from "@sj/contracts";
import { createSession } from "@sj/web-session";

const resolveApiUrl = () => {
  if (typeof window !== "undefined") {
    // In production / on Vercel, always use same-origin relative URL so cookies are sent & hits live DB
    if (window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
      return "";
    }
    const envUrl = process.env.NEXT_PUBLIC_API_URL;
    if (envUrl && envUrl.startsWith("http")) {
      return envUrl;
    }
    return "http://localhost:4000";
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
