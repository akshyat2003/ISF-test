"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError } from "@sj/client";
import type { MeResponse } from "@sj/contracts";
import { api, useSessionIdentity } from "@/lib/session";

/**
 * Account activation for imported participants (FR-IAM-08/10): sign in with the email or mobile the organisers
 * hold for you, then enter the single-use code. The code may also arrive in the link's #fragment (never sent to servers).
 */
export default function ActivatePage() {
  const email = useSessionIdentity();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // The code may arrive in the link's #fragment. Keep it in this tab only (never in a URL sent to a server).
    const fromLink = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (fromLink) { sessionStorage.setItem("sj.activation", fromLink); history.replaceState(null, "", "/activate"); }
    const kept = sessionStorage.getItem("sj.activation");
    if (kept) setCode(kept);
  }, []);
  useEffect(() => { if (email) api.me().then(setMe, (e: Error) => setError(e.message)); }, [email]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      setMe(await api.activate(code.trim()));
      sessionStorage.removeItem("sj.activation");
    } catch (err) {
      setError(err instanceof ApiError ? (err.problem.detail ?? err.message) : (err as Error).message);
    } finally { setBusy(false); }
  }

  if (email === undefined) return null;
  return (
    <div className="card" style={{ maxWidth: 600 }}>
      <h1>Activate your account</h1>
      {!email ? (
        <>
          <p>If the event team registered you (as a startup, jury member, volunteer or delegate), sign in with the email or mobile number they hold for you, then enter your activation code.</p>
          <Link className="btn btn-primary" href="/signin?next=/activate">Sign in</Link>
        </>
      ) : !me ? (
        error ? <p className="notice notice-error">{error}</p> : <p className="muted">Checking your account…</p>
      ) : me.account?.status === "active" ? (
        <>
          <p className="notice notice-ok">Your account is active.</p>
          <p>Roles: {me.roles.map((r) => r.replace(/_/g, " ")).join(", ") || "none yet"}{me.editionAccess.length ? ` · event access: ${me.editionAccess.join(", ")}` : ""}.</p>
          <p className="muted">Use the Startup Jathara mobile app for event information. <Link href="/status">Application status</Link></p>
        </>
      ) : me.account?.status === "pending_activation" ? (
        <form onSubmit={submit}>
          <p>Signed in as <strong>{email}</strong>. Enter the activation code you received from the event team.</p>
          <label>Activation code
            <input type="text" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required minLength={20} />
          </label>
          {error && <p className="notice notice-error" role="alert">{error}</p>}
          <div><button className="btn btn-primary" disabled={busy || code.trim().length < 20}>{busy ? "Activating…" : "Activate"}</button></div>
        </form>
      ) : me.account?.status === "deactivated" ? (
        <p className="notice notice-error">This account has been deactivated. Contact the event team.</p>
      ) : (
        <p className="notice notice-warn">
          No account awaiting activation is linked to <strong>{email}</strong>. Sign in with the email or mobile number the event team holds for you,
          or ask them to check your details.
        </p>
      )}
    </div>
  );
}
