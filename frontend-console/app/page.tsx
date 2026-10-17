"use client";
import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { can, useMe } from "@/lib/me";

/** Sends each person to the first section their roles allow. */
export default function Home() {
  const { me, email, error } = useMe();
  const router = useRouter();
  useEffect(() => {
    if (!me) return;
    if (me.mfaRequired) {
      router.replace("/mfa");
      return;
    }
    router.replace("/dashboard");
  }, [me, router]);
  if (email === undefined) return null;
  if (!email) return <p>Please <Link href="/login">log in</Link>.</p>;
  if (error) return <p className="notice notice-error" role="alert">{error}</p>;
  if (!me) return <p className="muted">Loading…</p>;
  if (me.account?.status === "pending_activation") {
    return <p className="notice notice-warn">Your account is waiting for activation. Use the activation code you received from the event team on the website’s activation page.</p>;
  }
  if (me.mfaRequired) return <p className="muted">Opening multi-factor verification…</p>;
  if (!can(me, "application.read_all") && !can(me, "user.read") && !can(me, "import.manage") && !can(me, "support.handle")) {
    return <p className="notice notice-warn">Your account has no console permissions. Ask an administrator if you need access.</p>;
  }
  return <p className="muted">Opening…</p>;
}
