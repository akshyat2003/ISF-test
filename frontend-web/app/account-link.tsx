"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSessionIdentity } from "@/lib/session";

export function AccountLink() {
  const email = useSessionIdentity();
  const pathname = usePathname();

  if (email === undefined) return null;

  if (pathname === "/signin") return null;

  if (!email) {
    return <Link href="/signin" className="nav-signin-link">Sign In</Link>;
  }

  return (
    <span className="small" style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <Link href="/profile" style={{ fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
        👤 My Profile
      </Link>
      <span className="muted">· {email} ·</span>
      <a href="#" onClick={(e) => { e.preventDefault(); void signOut(); }}>Sign out</a>
    </span>
  );
}

