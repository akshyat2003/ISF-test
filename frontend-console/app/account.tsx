"use client";
import { signOut, useSessionEmail } from "@/lib/session";

export function Account() {
  const email = useSessionEmail();
  if (!email) return null;
  return (
    <span className="small muted">
      {email} · <a href="#" onClick={(e) => { e.preventDefault(); void signOut(); }}>Log out</a>
    </span>
  );
}
