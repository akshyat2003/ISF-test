"use client";
import Link from "next/link";
import { can, useMe } from "@/lib/me";
import { Account } from "./account";

export function Nav() {
  const { me } = useMe();
  return (
    <nav className="nav" aria-label="Console">
      {can(me, "application.read_all") && <Link href="/applications">Applications</Link>}
      {can(me, "ranking.read") && <Link href="/ranking">AI ranking</Link>}
      {can(me, "jury.manage") && <Link href="/jury">Jury</Link>}
      {can(me, "volunteer.read") && <Link href="/volunteers">Volunteers</Link>}
      {(can(me, "support.handle") || can(me, "support.review")) && <Link href="/support">Support</Link>}
      {can(me, "content.read_all") && <Link href="/content">Event info</Link>}
      {can(me, "notice.publish") && <Link href="/notices">Notices</Link>}
      {can(me, "user.read") && <Link href="/users">Accounts</Link>}
      {can(me, "import.manage") && <Link href="/imports">Imports</Link>}
      {me?.mfaRequired && <Link href="/mfa">Verify MFA</Link>}
      <Account />
    </nav>
  );
}
