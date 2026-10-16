"use client";
import Link from "next/link";
import { signOut, useSessionIdentity } from "@/lib/session";

export function AccountLink() {
  const email = useSessionIdentity();
  if (email === undefined) return null;
  if (!email) return <Link href="/signin">Sign in</Link>;
  return (
    <span className="small muted">
      {email} ·{" "}
      <a href="#" onClick={(e) => { e.preventDefault(); void signOut(); }}>Sign out</a>
    </span>
  );
}
