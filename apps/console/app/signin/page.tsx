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
      setError((err as Error).message || "Sign-in failed");
    }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 420 }}>
      <h1>Staff sign-in</h1>
      {authMode === "dev" && (
        <p className="notice notice-warn small">
          Development sign-in. Seeded accounts: <code>manager@dev.local</code> (Management),{" "}
          <code>admin@dev.local</code> (Admin without management grant).
        </p>
      )}
      {stage === "email" ? (
        <label>Work email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      ) : (
        <label>One-time code<input type="text" inputMode="numeric" required value={code} onChange={(e) => setCode(e.target.value)} /></label>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div><button className="btn btn-primary">{stage === "email" ? "Continue" : "Verify"}</button></div>
    </form>
  );
}

export default function SignIn() {
  return <Suspense><Form /></Suspense>;
}
