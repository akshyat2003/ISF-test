"use client";
import Link from "next/link";
import { signOut, useSessionIdentity } from "@/lib/session";

export function AccountLink() {
  const email = useSessionIdentity();
  if (email === undefined) return null;
  if (!email) {
    return (
      <span style={{ display: "inline-flex", gap: 12, alignItems: "center" }}>
        <Link href="/signup" style={{ fontWeight: 600, color: "var(--accent)" }}>Sign up</Link>
        <Link href="/signin">Sign in</Link>
      </span>
    );
  }
  return (
    <span className="small muted">
      {email} ·{" "}
      <a href="#" onClick={(e) => { e.preventDefault(); void signOut(); }}>Sign out</a>
    </span>
  );
}
