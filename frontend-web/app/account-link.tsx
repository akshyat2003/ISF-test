"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSessionIdentity } from "@/lib/session";

export function AccountLink() {
  const email = useSessionIdentity();
  const pathname = usePathname();

  if (email === undefined) return null;

  if (!email) {
    if (pathname === "/signin") return null;
    return <Link href="/signin">Sign In</Link>;
  }

  return (
    <span className="small muted">
      {email} ·{" "}
      <a href="#" onClick={(e) => { e.preventDefault(); void signOut(); }}>Sign out</a>
    </span>
  );
}

