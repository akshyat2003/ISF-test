"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMe } from "@/lib/me";

/** Sends each person to their respective dashboard, or redirects directly to login. */
export default function Home() {
  const { me, email, error } = useMe();
  const router = useRouter();

  useEffect(() => {
    if (email === null) {
      router.replace("/login");
      return;
    }
    if (!me) return;
    if (me.mfaRequired) {
      router.replace("/mfa");
      return;
    }
    // Customer support role (without admin/management) routes to Support Desk
    if (me.roles.includes("customer_support") && !me.roles.includes("admin") && !me.roles.includes("management")) {
      router.replace("/support");
      return;
    }
    // Jury member routes to Jury evaluations
    if (me.roles.includes("jury_member") && !me.roles.includes("admin")) {
      router.replace("/jury");
      return;
    }
    // Volunteer routes to Volunteer desk
    if (me.roles.includes("volunteer") && !me.roles.includes("admin")) {
      router.replace("/volunteers");
      return;
    }
    // Admin & Management route to the unified Dashboard
    router.replace("/dashboard");
  }, [me, email, router]);

  if (email === undefined || email === null) return null;
  if (error) return <p className="notice notice-error" role="alert">{error}</p>;
  if (!me) return <p className="muted">Loading dashboard…</p>;
  if (me.account?.status === "pending_activation") {
    return (
      <p className="notice notice-warn">
        Your account is waiting for activation. Use the activation code you received from the event team on the website’s activation page.
      </p>
    );
  }
  return <p className="muted">Opening dashboard…</p>;
}
