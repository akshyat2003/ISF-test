"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CONSOLE_RETURN_PATHS, safeReturnPath } from "@sj/contracts";
import { authMode, startSignIn, verifyCode } from "@/lib/session";

function Form() {
  const router = useRouter();
  const next = safeReturnPath(useSearchParams().get("next"), CONSOLE_RETURN_PATHS, "/");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (stage === "email") {
        if ((await startSignIn(email.trim())) === "signed_in") router.push(next);
        else setStage("code");
      } else {
        await verifyCode(email.trim(), code.trim());
        router.push(next);
      }
    } catch (err) {
      setError((err as Error).message || "Log in failed");
    }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 420 }}>
      <h1>Console Log in</h1>
      <p className="muted small" style={{ marginBottom: 16 }}>
        Restricted to <strong>Administrator</strong> and <strong>Customer Support</strong> staff.
      </p>
      {authMode === "dev" && (
        <p className="notice notice-warn small">
          Development login. Seeded accounts: <code>admin@dev.local</code> (Admin),{" "}
          <code>manager@dev.local</code> (Management), <code>support@dev.local</code> (Support).
        </p>
      )}
      {stage === "email" ? (
        <label>Staff work email<input type="email" required placeholder="admin@domain.com" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      ) : (
        <label>One-time security code<input type="text" inputMode="numeric" required value={code} onChange={(e) => setCode(e.target.value)} /></label>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div><button className="btn btn-primary">{stage === "email" ? "Continue to Log in" : "Log in"}</button></div>
    </form>
  );
}

export default function Login() {
  return <Suspense><Form /></Suspense>;
}
