"use client";
import Link from "next/link";
import { can, useMe } from "@/lib/me";
import { Account } from "./account";

export function Nav() {
  const { me, email } = useMe();
  const isAdmin =
    (email && ["akshatrajpati@gmail.com", "arushkumar450@gmail.com", "sarangeeamartya@gmail.com"].includes(email.toLowerCase())) ||
    me?.roles.includes("admin") ||
    me?.roles.includes("management");

  return (
    <nav className="nav" aria-label="Console">
      {(me || email) && <Link href="/dashboard">Dashboard</Link>}
      {(isAdmin || can(me, "application.read_all")) && <Link href="/applications">Applications</Link>}
      {(isAdmin || can(me, "ranking.read")) && <Link href="/ranking">AI ranking</Link>}
      {(isAdmin || can(me, "jury.manage")) && <Link href="/jury">Jury</Link>}
      {(isAdmin || can(me, "volunteer.read")) && <Link href="/volunteers">Volunteers</Link>}
      {(isAdmin || can(me, "support.handle") || can(me, "support.review")) && <Link href="/support">Support</Link>}
      {(isAdmin || can(me, "content.read_all")) && <Link href="/content">Event info</Link>}
      {(isAdmin || can(me, "notice.publish")) && <Link href="/notices">Notices</Link>}
      {(isAdmin || can(me, "user.read")) && <Link href="/users">Accounts</Link>}
      {(isAdmin || can(me, "import.manage")) && <Link href="/imports">Imports</Link>}
      {me?.mfaRequired && <Link href="/mfa">Verify MFA</Link>}
      <Account />
    </nav>
  );
}
