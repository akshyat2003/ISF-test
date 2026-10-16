"use client";
import Link from "next/link";
import { signOut, useSessionEmail } from "@/lib/session";

export function Account() {
  const email = useSessionEmail();
  if (email === undefined) return null;
  if (!email) return <Link href="/signin">Sign in</Link>;
  return (
    <span className="small muted">
      {email} · <a href="#" onClick={(e) => { e.preventDefault(); void signOut(); }}>Sign out</a>
    </span>
  );
}
