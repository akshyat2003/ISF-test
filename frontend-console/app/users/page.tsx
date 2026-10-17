"use client";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ACCOUNT_STATUSES, ROLES, type AccountStatus, type AdminCreateCredentialResponse, type AdminUserList, type Role } from "@sj/contracts";
import { formatIst } from "@sj/client";
import { api } from "@/lib/session";
import { can, useMe } from "@/lib/me";
import { MfaPrompt } from "../mfa-prompt";

const label = (s: string) => s.replace(/_/g, " ");
const PAGE = 50;

function Users() {
  const { me, email } = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const role = (params.get("role") ?? "") as Role | "";
  const status = (params.get("status") ?? "") as AccountStatus | "";
  const offset = Number(params.get("offset") ?? 0);
  const [text, setText] = useState(q);
  const [data, setData] = useState<AdminUserList | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Create credentials for Jury member, Delegate, or other roles
  const [showCreate, setShowCreate] = useState(false);
  const [newFullName, setNewFullName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newMobile, setNewMobile] = useState("");
  const [newRole, setNewRole] = useState<Role>("jury_member");
  const [newEdition, setNewEdition] = useState("2026");
  const [createResult, setCreateResult] = useState<AdminCreateCredentialResponse | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try { setData(await api.admin.users({ q: q || undefined, role: role || undefined, status: status || undefined, limit: PAGE, offset })); }
    catch (e) { setError((e as Error).message); }
  }, [q, role, status, offset]);
  useEffect(() => { if (can(me, "user.read")) void load(); }, [me, load]);

  const go = (next: Record<string, string>) => {
    const p = new URLSearchParams({ q, role, status, ...next });
    for (const [k, v] of [...p.entries()]) if (!v || (k === "offset" && v === "0")) p.delete(k);
    router.push(`/users${p.size ? `?${p}` : ""}`);
  };

  async function handleCreateCredential(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreateResult(null);
    setCreateBusy(true);
    setCopied(false);
    try {
      const res = await api.admin.createCredential({
        fullName: newFullName.trim(),
        email: newEmail.trim() || undefined,
        mobile: newMobile.trim() || undefined,
        role: newRole,
        edition: Number(newEdition) || 2026,
      });
      setCreateResult(res);
      setNewFullName("");
      setNewEmail("");
      setNewMobile("");
      void load();
    } catch (err) {
      setCreateError((err as Error).message || "Failed to create credentials");
    } finally {
      setCreateBusy(false);
    }
  }

  function copyCredentials() {
    if (!createResult) return;
    const text = `Udbhav - Startup Jathara Credentials\nName: ${createResult.user.fullName}\nRole: ${createResult.user.roles.map((r) => r.role).join(", ")}\nEmail: ${createResult.user.email ?? "N/A"}\nMobile: ${createResult.user.mobile ?? "N/A"}\nActivation Code: ${createResult.activationToken ?? "Direct Access via Email Sign-in"}\nSign-in URL: ${typeof window !== "undefined" ? window.location.origin.replace("4001", "3000") : "https://startupjathara.org"}/signin`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  }

  if (email === undefined) return null;
  if (!email) return <p>Please <Link href="/signin?next=/users">sign in</Link>.</p>;
  if (me?.mfaRequired) return <MfaPrompt next="/users" />;
  if (me && !can(me, "user.read")) return <p className="notice notice-error">Your account does not have Admin permissions.</p>;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <h1>Accounts & Credentials</h1>
        {can(me, "role.assign") && (
          <button className="btn btn-primary" onClick={() => { setShowCreate(!showCreate); setCreateResult(null); }}>
            {showCreate ? "Close Form" : "+ Create Credentials (Jury / Delegate / Staff)"}
          </button>
        )}
      </div>

      {showCreate && (
        <section className="card" style={{ margin: "16px 0 24px", borderColor: "var(--accent)" }}>
          <h2 style={{ marginTop: 0 }}>Create Participant / Staff Credentials</h2>
          <p className="muted small">
            Admin can directly issue credentials for <strong>Jury Members</strong>, <strong>Delegates</strong>, and other event participants.
          </p>
          <form onSubmit={handleCreateCredential} style={{ display: "grid", gap: 14 }}>
            <div className="two">
              <label>Full Name *
                <input type="text" required placeholder="e.g. Dr. Priya Sharma" value={newFullName} onChange={(e) => setNewFullName(e.target.value)} />
              </label>
              <label>Role to Grant *
                <select value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
                  <option value="jury_member">Jury Member (Evaluations & Pitch Scoring)</option>
                  <option value="delegate">Delegate (VIP / Attendee)</option>
                  <option value="customer_support">Customer Support (Help Desk)</option>
                  <option value="volunteer">Volunteer (Participant Support)</option>
                  <option value="management">Management Team (Evaluations & Approvals)</option>
                  <option value="admin">Administrator (Full Console Access)</option>
                  <option value="startup_team_leader">Startup Team Leader</option>
                  <option value="startup_team_member">Startup Team Member</option>
                </select>
              </label>
            </div>
            <div className="two">
              <label>Email Address
                <input type="email" placeholder="jury.member@example.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
              </label>
              <label>Mobile Number
                <input type="tel" placeholder="+91 98765 43210" value={newMobile} onChange={(e) => setNewMobile(e.target.value)} />
              </label>
            </div>
            <div className="two">
              <label>Event Edition
                <select value={newEdition} onChange={(e) => setNewEdition(e.target.value)}>
                  <option value="2026">Startup Jathara 2026</option>
                  <option value="2027">Startup Jathara 2027</option>
                </select>
              </label>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button type="submit" className="btn btn-primary" disabled={createBusy} style={{ width: "100%", height: 42 }}>
                  {createBusy ? "Creating Credentials..." : "Generate & Issue Credentials"}
                </button>
              </div>
            </div>
            {createError && <p className="notice notice-error" role="alert">{createError}</p>}
          </form>

          {createResult && (
            <div className="notice notice-ok" style={{ marginTop: 16 }}>
              <h3 style={{ margin: "0 0 6px" }}>{createResult.message}</h3>
              <p style={{ margin: "0 0 6px" }}>
                <strong>Account:</strong> {createResult.user.fullName} ({createResult.user.email ?? createResult.user.mobile})
              </p>
              <p style={{ margin: "0 0 6px" }}>
                <strong>Role:</strong> {createResult.user.roles.map((r) => r.role).join(", ")}
              </p>
              {createResult.activationToken ? (
                <p style={{ margin: "0 0 10px" }}>
                  <strong>Activation Token / Credential:</strong> <code>{createResult.activationToken}</code>
                </p>
              ) : (
                <p style={{ margin: "0 0 10px" }} className="muted small">
                  An activation code has been automated to their email/mobile. They can sign in directly using their email or mobile.
                </p>
              )}
              <button type="button" className="btn btn-sm" onClick={copyCredentials}>
                {copied ? "✓ Credentials Copied!" : "Copy Credentials Text"}
              </button>
            </div>
          )}
        </section>
      )}

      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); go({ q: text.trim(), offset: "0" }); }}>
        <label>Search
          <input type="text" placeholder="Name, email or mobile" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <label>Role
          <select value={role} onChange={(e) => go({ role: e.target.value, offset: "0" })}>
            <option value="">Any</option>
            {ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}
          </select>
        </label>
        <label>Status
          <select value={status} onChange={(e) => go({ status: e.target.value, offset: "0" })}>
            <option value="">Any</option>
            {ACCOUNT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </label>
        <button className="btn btn-sm">Search</button>
      </form>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {data && (data.items.length === 0 ? <p className="muted">No accounts match.</p> : (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Contact</th><th>Roles</th><th>Status</th><th>Created (IST)</th></tr></thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id}>
                    <td><Link href={`/users/${u.id}`}><strong>{u.fullName}</strong></Link></td>
                    <td className="small">{u.email ?? "—"}<br />{u.mobile ?? ""}</td>
                    <td className="small">{u.roles.map((r) => `${label(r.role)}${r.edition ? ` (${r.edition})` : ""}`).join(", ") || "—"}</td>
                    <td><span className={`status status-${u.status}`}>{label(u.status)}</span></td>
                    <td className="small">{formatIst(u.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions">
            <span className="muted small">{offset + 1}–{offset + data.items.length} of {data.total}</span>
            <button className="btn btn-sm" disabled={offset === 0} onClick={() => go({ offset: String(Math.max(0, offset - PAGE)) })}>Previous</button>
            <button className="btn btn-sm" disabled={offset + PAGE >= data.total} onClick={() => go({ offset: String(offset + PAGE) })}>Next</button>
          </div>
        </>
      ))}
    </>
  );
}

export default function Page() {
  return <Suspense><Users /></Suspense>;
}
