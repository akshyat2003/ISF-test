"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CONSOLE_RETURN_PATHS, safeReturnPath } from "@sj/contracts";
import type { MfaEnrolment } from "@sj/web-session";
import { authMode, mfa, useSessionIdentity } from "@/lib/session";

/**
 * Multi-factor step-up for staff roles (FR-IAM-11). Admin, Management and Customer Support permissions are withheld
 * by the API until the session is aal2. Supabase: TOTP authenticator app (enrol once, then verify each sign-in).
 */
function MfaStep() {
  const router = useRouter();
  // Used by router.replace and window.location.assign below: only approved console pages.
  const next = safeReturnPath(useSearchParams().get("next"), CONSOLE_RETURN_PATHS, "/");
  const who = useSessionIdentity();
  const [factorId, setFactorId] = useState<string | null | undefined>(undefined);
  const [enrolment, setEnrolment] = useState<MfaEnrolment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!who) return;
    mfa.status().then((s) => {
      if (s.level === "aal2") router.replace(next);
      else setFactorId(s.factorId);
    }, (e: Error) => setError(e.message));
  }, [who, next, router]);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  if (who === undefined) return null;
  if (!who) return <p>Please <Link href="/signin">sign in</Link>.</p>;
  if (factorId === undefined) return error ? <p className="notice notice-error">{error}</p> : <p className="muted">Checking your sign-in…</p>;

  const needsEnrolment = authMode === "supabase" && !factorId && !enrolment;
  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <h1>Verify it’s you</h1>
      <p>Your role (Admin, Management or Customer Support) requires multi-factor authentication. Signed in as <strong>{who}</strong>.</p>
      {authMode === "dev" && <p className="notice notice-warn small">Development sign-in: any 6-digit code is accepted. Production uses an authenticator app.</p>}
      {needsEnrolment ? (
        <>
          <p>Set up an authenticator app (for example Google Authenticator or Microsoft Authenticator) for this account.</p>
          <button className="btn btn-primary" disabled={busy} onClick={() => void run(async () => setEnrolment(await mfa.enrol()))}>Set up authenticator</button>
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await mfa.verify(enrolment?.factorId ?? factorId ?? null, code);
          window.location.assign(next); /* full reload: every section re-reads the upgraded permissions */ }); }}>
          {enrolment && (
            <div>
              <p>Scan this code with your authenticator app, or enter the key manually.</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={enrolment.qrCode} alt="Authenticator QR code" width={180} height={180} />
              <p className="small">Key: <code>{enrolment.secret}</code></p>
            </div>
          )}
          <label>6-digit code
            <input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </label>
          {error && <p className="field-error" role="alert">{error}</p>}
          <div><button className="btn btn-primary" disabled={busy || code.length !== 6}>{busy ? "Verifying…" : "Verify"}</button></div>
        </form>
      )}
      {error && needsEnrolment && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

export default function MfaPage() {
  return <Suspense><MfaStep /></Suspense>;
}
