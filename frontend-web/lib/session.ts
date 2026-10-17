"use client";
import { parseSignInMethods } from "@sj/contracts";
import { createSession } from "@sj/web-session";

const resolveApiUrl = () => {
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
};

export const { api, authMode, signInMethods, startSignIn, verifyCode, signOut, useSessionIdentity } = createSession({
  apiUrl: resolveApiUrl(),
  authMode: process.env.NEXT_PUBLIC_AUTH_MODE === "supabase" && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "supabase" : "dev",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  storageKey: "sj.web.session",
  signInMethods: parseSignInMethods(process.env.NEXT_PUBLIC_SIGNIN_METHODS),
});
