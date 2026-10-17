import Link from "next/link";
import { signOut, useSessionEmail } from "@/lib/session";

export function Account() {
  const email = useSessionEmail();
  if (!email) return null;
  return (
    <span className="small" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <Link href="/profile" style={{ fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
        👤 My Profile
      </Link>
      <span className="muted">· {email} ·</span>
      <a href="#" onClick={(e) => { e.preventDefault(); void signOut(); }}>Log out</a>
    </span>
  );
}
