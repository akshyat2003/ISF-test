"use client";
import { Suspense, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { normaliseMobile, safeReturnPath, WEB_RETURN_PATHS, type SignInIdentifier, type SignInMethod } from "@sj/contracts";
import { authMode, signInMethods, startSignIn, verifyCode } from "@/lib/session";

const LABEL: Record<SignInMethod, string> = { email: "Sign in with email", phone: "Sign in with mobile number" };

function SignInForm() {
  const router = useRouter();
  // Only approved internal pages: a crafted link must not redirect a freshly signed-in user elsewhere.
  const next = safeReturnPath(useSearchParams().get("next"), WEB_RETURN_PATHS, "/status");
  const [method, setMethod] = useState<SignInMethod>(signInMethods[0] ?? "email");
  const [value, setValue] = useState("");
  const [who, setWho] = useState<SignInIdentifier | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (!who) {
        let id: SignInIdentifier;
        if (method === "phone") {
          const phone = normaliseMobile(value);
          if (!phone) throw new Error("Enter a valid mobile number, e.g. 98765 43210");
          id = { phone };
        } else id = { email: value.trim() };
        const r = await startSignIn(id);
        if (r === "signed_in") router.push(next);
        else setWho(id);
      } else {
        await verifyCode(who, code.trim());
        router.push(next);
      }
    } catch (err) {
      setError((err as Error).message || "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 420 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <Image src="/logos/udbhav.png" alt="Udbhav" width={48} height={48} style={{ borderRadius: 8, objectFit: "contain" }} />
        <div>
          <h1 style={{ margin: 0, fontSize: "1.6rem" }}>Sign in to Udbhav</h1>
          <p className="small muted" style={{ margin: 0 }}>Startup Jathara @ Dandakaranya</p>
        </div>
      </div>
      <p className="muted small">
        {!who
          ? "Sign in with a one-time code. Use the email or mobile number you registered with, or the one the event team holds for you."
          : `Enter the code we sent to ${"email" in who ? who.email : who.phone}.`}
      </p>
      {authMode === "dev" && <p className="notice notice-warn small">Development sign-in: no code is sent. Never enabled in production.</p>}
      {!who ? (
        <>
          {signInMethods.length > 1 && (
            <div className="choices" role="radiogroup" aria-label="Sign in with">
              {signInMethods.map((m) => (
                <label className="choice" key={m}>
                  <input type="radio" name="method" checked={method === m} onChange={() => { setMethod(m); setValue(""); }} />
                  <span>{LABEL[m]}</span>
                </label>
              ))}
            </div>
          )}
          {method === "email" ? (
            <label>Email<input type="email" required autoComplete="email" value={value} onChange={(e) => setValue(e.target.value)} /></label>
          ) : (
            <label>Mobile number<span className="hint">Indian numbers can be entered as 10 digits; others with +country code.</span>
              <input type="tel" required autoComplete="tel" value={value} onChange={(e) => setValue(e.target.value)} /></label>
          )}
        </>
      ) : (
        <label>One-time code<input type="text" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} /></label>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div><button className="btn btn-primary" disabled={busy} style={{ width: "100%" }}>{!who ? "Continue" : "Verify and sign in"}</button></div>

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--line)", textAlign: "center" }}>
        <p className="small muted" style={{ margin: "0 0 8px" }}>
          Don't have an account yet?
        </p>
        <Link href="/signup" className="btn btn-sm" style={{ width: "100%", justifyContent: "center" }}>
          Sign up as Leader, Member, Volunteer, or Management
        </Link>
      </div>
    </form>
  );
}

export default function SignInPage() {
  return <Suspense><SignInForm /></Suspense>;
}
