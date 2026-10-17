"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import { ROLES, type ActivationIssued, type AdminUser, type Role } from "@sj/contracts";
import { formatIst } from "@sj/client";
import { api } from "@/lib/session";
import { can, useMe } from "@/lib/me";
import { MfaPrompt } from "../../mfa-prompt";

const label = (s: string) => s.replace(/_/g, " ");

export default function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);
  const { me, email } = useMe();
  const [u, setU] = useState<AdminUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<ActivationIssued | null>(null);
  const [role, setRole] = useState<Role>("volunteer");
  const [edition, setEdition] = useState("");

  const load = useCallback(async () => {
    try { setU(await api.admin.user(id)); } catch (e) { setError((e as Error).message); }
  }, [id]);
  useEffect(() => { if (can(me, "user.read")) void load(); }, [me, load]);

  async function act(fn: () => Promise<AdminUser | void>) {
    setBusy(true); setError(null);
    try { const r = await fn(); if (r) setU(r); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  useEffect(() => {
    if (email === null) router.replace(`/login?next=/users/${id}`);
  }, [email, router, id]);

  if (email === undefined || email === null) return null;
  if (me?.mfaRequired) return <MfaPrompt />;
  if (me && !can(me, "user.read")) return <p className="notice notice-error">Your account does not have Admin permissions.</p>;
  const self = me?.account?.id === id;

  return (
    <>
      <p><Link href="/users">← Accounts</Link></p>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {u && (
        <>
          <h1>{u.fullName}</h1>
          <p>
            <span className={`status status-${u.status}`}>{label(u.status)}</span>{" "}
            <span className="muted small">
              {u.email ?? "no email"} · {u.mobile ?? "no mobile"} · sign-in {u.signInLinked ? "linked" : "not yet used"} ·
              created {formatIst(u.createdAt)}{u.activatedAt ? ` · activated ${formatIst(u.activatedAt)}` : ""}
            </span>
          </p>
          {self && <p className="notice notice-warn">This is your own account. Another administrator must change its roles or status.</p>}

          <section className="card" style={{ marginBottom: 16 }}>
            <h2>Registration Profile & Details</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginTop: 12 }}>
              <div>
                <span className="muted small" style={{ display: "block" }}>Registration Category / Track</span>
                <strong style={{ fontSize: "1.05rem", color: "var(--accent)" }}>
                  {u.category ? label(u.category) : "Not Specified / Staff"}
                </strong>
              </div>
              <div>
                <span className="muted small" style={{ display: "block" }}>Startup / Organization Name</span>
                <strong>{u.teamName ?? "—"}</strong>
              </div>
              <div>
                <span className="muted small" style={{ display: "block" }}>Sector / Domain</span>
                <strong>{u.domain ?? "—"}</strong>
              </div>
              <div>
                <span className="muted small" style={{ display: "block" }}>Primary Email</span>
                <strong>{u.email ?? "—"}</strong>
              </div>
              <div>
                <span className="muted small" style={{ display: "block" }}>Phone Number</span>
                <strong>{u.mobile ?? "—"}</strong>
              </div>
              <div>
                <span className="muted small" style={{ display: "block" }}>Alternative Phone Number</span>
                <strong>{u.altMobile ?? "—"}</strong>
              </div>
              <div>
                <span className="muted small" style={{ display: "block" }}>Location</span>
                <strong>{[u.city, u.state, u.country].filter(Boolean).join(", ") || "—"}</strong>
              </div>
              <div>
                <span className="muted small" style={{ display: "block" }}>LinkedIn Profile</span>
                {u.linkedinUrl ? (
                  <a href={u.linkedinUrl.startsWith("http") ? u.linkedinUrl : `https://${u.linkedinUrl}`} target="_blank" rel="noopener noreferrer" style={{ color: "#0284c7", fontWeight: 600 }}>
                    {u.linkedinUrl} ↗
                  </a>
                ) : (
                  <strong>—</strong>
                )}
              </div>
              {u.teamMembers && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <span className="muted small" style={{ display: "block" }}>Team Members & Details</span>
                  <div style={{ background: "#f8fafc", padding: "10px 14px", borderRadius: 6, marginTop: 4, whiteSpace: "pre-wrap" }}>
                    {u.teamMembers}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="card" style={{ marginBottom: 16 }}>
            <h2>Roles</h2>
            {u.roles.length === 0 ? <p className="muted">No roles.</p> : (
              <ul className="plain">
                {u.roles.map((r, idx) => (
                  <li key={r.grantId || `${r.role}-${idx}`}>
                    <strong>{label(r.role)}</strong>{r.edition ? ` · ${r.edition} only` : " · all editions"}{" "}
                    {r.grantedAt ? <span className="muted small">since {formatIst(r.grantedAt)}</span> : null}{" "}
                    {can(me, "role.assign") && !self && r.grantId && (
                      <button className="btn btn-sm" disabled={busy}
                        onClick={() => confirm(`Remove ${label(r.role)} from ${u.fullName}? It takes effect immediately.`) && void act(() => api.admin.revokeRole(u.id, r.grantId!))}>
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {can(me, "role.assign") && !self && (
              <form className="toolbar" onSubmit={(e) => { e.preventDefault(); void act(() => api.admin.grantRole(u.id, role, edition ? Number(edition) : null)); }}>
                <label>Role
                  <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                    {ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}
                  </select>
                </label>
                <label>Edition
                  <select value={edition} onChange={(e) => setEdition(e.target.value)}>
                    <option value="">All editions</option><option value="2026">2026</option><option value="2027">2027</option>
                  </select>
                </label>
                <button className="btn btn-sm" disabled={busy}>Grant role</button>
              </form>
            )}
            {role === "management" && <p className="muted small">Management decides startup selections. Admin holds these permissions only when explicitly granted (FR-IAM-06).</p>}
          </section>

          <section className="card" style={{ marginBottom: 16 }}>
            <h2>Event access</h2>
            <p>{u.editionAccess.map((a) => `${a.edition} (${a.source})`).join(", ") || <span className="muted">None</span>}</p>
          </section>

          <section className="card">
            <h2>Account status</h2>
            {u.status === "pending_activation" && can(me, "activation.issue") && (
              <>
                <p className="small">
                  The person activates by signing in with this account’s confirmed email or mobile, then entering a single-use activation code.
                  {u.activation ? ` A code was issued ${formatIst(u.activation.issuedAt)} and expires ${formatIst(u.activation.expiresAt)}; issuing a new one cancels it.` : ""}
                </p>
                <button className="btn btn-primary" disabled={busy}
                  onClick={() => void act(async () => { setIssued(await api.admin.issueActivation(u.id)); await load(); })}>
                  Issue activation code
                </button>
                {issued && (issued.token ? (
                  <div className="notice notice-ok" style={{ marginTop: 12 }}>
                    <p><strong>Activation code (shown once):</strong></p>
                    <p><code style={{ wordBreak: "break-all" }}>{issued.token}</code></p>
                    <p className="small">Valid until {formatIst(issued.expiresAt)}. Give it to {u.fullName} privately: automatic delivery is not configured for their contact (TBD-13). Never put it in a spreadsheet.</p>
                  </div>
                ) : (
                  <div className="notice notice-ok" style={{ marginTop: 12 }}>
                    <p>The code was sent by {issued.delivery === "email" ? "email" : "SMS"} to {u.fullName}’s {issued.delivery === "email" ? "email address" : "mobile number"} on file.
                      It is valid until {formatIst(issued.expiresAt)}. You do not see the code.</p>
                  </div>
                ))}
              </>
            )}
            {can(me, "user.manage") && !self && (
              <div className="actions">
                {u.status !== "deactivated" ? (
                  <button className="btn" disabled={busy}
                    onClick={() => confirm(`Deactivate ${u.fullName}? They lose all access on their next request.`) && void act(() => api.admin.deactivate(u.id))}>
                    Deactivate account
                  </button>
                ) : (
                  <button className="btn" disabled={busy} onClick={() => void act(() => api.admin.reactivate(u.id))}>Reactivate account</button>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
