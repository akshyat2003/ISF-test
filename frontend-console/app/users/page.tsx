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
  const [selectedRole, setSelectedRole] = useState(role);
  const [selectedStatus, setSelectedStatus] = useState(status);
  const [data, setData] = useState<AdminUserList | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync state when URL query params change
  useEffect(() => {
    setText(q);
    setSelectedRole(role);
    setSelectedStatus(status);
  }, [q, role, status]);

  // Create credentials for Jury member, Delegate, Customer Support, Staff, etc.
  const createParam = params.get("create") === "true";
  const roleParam = params.get("role") as Role | null;
  const [showCreate, setShowCreate] = useState(true);
  const [newFullName, setNewFullName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newMobile, setNewMobile] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>(roleParam || "customer_support");
  const [newEdition, setNewEdition] = useState("2026");
  const [createResult, setCreateResult] = useState<AdminCreateCredentialResponse | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (params.get("create") === "true") setShowCreate(true);
    const r = params.get("role") as Role;
    if (r) setNewRole(r);
  }, [params]);

  const canReadUsers = !me || me.roles.includes("admin") || me.roles.includes("management") || can(me, "user.read");

  const fetchUsers = useCallback(async (filters: { q?: string; role?: string; status?: string; offset?: number }) => {
    setError(null);
    setLoadingUsers(true);
    try {
      const res = await api.admin.users({
        q: filters.q ? filters.q.trim() : undefined,
        role: (filters.role || undefined) as Role | undefined,
        status: (filters.status || undefined) as AccountStatus | undefined,
        limit: PAGE,
        offset: filters.offset ?? 0,
      });
      setData(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  const load = useCallback(async () => {
    await fetchUsers({ q, role, status, offset });
  }, [fetchUsers, q, role, status, offset]);

  useEffect(() => {
    if (canReadUsers) void load();
  }, [canReadUsers, load]);

  const applyFilter = (filterOverrides: { q?: string; role?: string; status?: string; offset?: string } = {}) => {
    const nextQ = filterOverrides.q !== undefined ? filterOverrides.q : text.trim();
    const nextRole = filterOverrides.role !== undefined ? filterOverrides.role : selectedRole;
    const nextStatus = filterOverrides.status !== undefined ? filterOverrides.status : selectedStatus;
    const nextOffset = filterOverrides.offset !== undefined ? filterOverrides.offset : "0";

    const p = new URLSearchParams();
    if (nextQ) p.set("q", nextQ);
    if (nextRole) p.set("role", nextRole);
    if (nextStatus) p.set("status", nextStatus);
    if (nextOffset && nextOffset !== "0") p.set("offset", nextOffset);

    router.push(`/users${p.size ? `?${p}` : ""}`);
    void fetchUsers({
      q: nextQ,
      role: nextRole,
      status: nextStatus,
      offset: Number(nextOffset) || 0,
    });
  };

  const go = (next: Record<string, string>) => {
    applyFilter(next);
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
        password: newPassword.trim() || undefined,
        role: newRole,
        edition: Number(newEdition) || 2026,
      });
      setCreateResult(res);
      setNewFullName("");
      setNewEmail("");
      setNewMobile("");
      setNewPassword("");
      void load();
    } catch (err) {
      setCreateError((err as Error).message || "Failed to create credentials");
    } finally {
      setCreateBusy(false);
    }
  }

  function copyCredentials() {
    if (!createResult) return;
    const origin = typeof window !== "undefined" ? window.location.origin : "https://isf-test-sb9i.vercel.app";
    const roleNames = createResult.user.roles.map((r) => r.role).join(", ");
    const isSupport = roleNames.includes("customer_support");
    const dashboardUrl = isSupport ? `${origin}/support` : `${origin}/dashboard`;
    const lines = [
      `ISF Platform Credentials`,
      `Name: ${createResult.user.fullName}`,
      `Role: ${roleNames}`,
      `Login Email: ${createResult.user.email ?? "N/A"}`,
      `Mobile: ${createResult.user.mobile ?? "N/A"}`,
      createResult.temporaryPassword ? `Password: ${createResult.temporaryPassword}` : null,
      createResult.activationToken ? `Activation Token: ${createResult.activationToken}` : null,
      `Sign-in URL: ${origin}/login`,
      `Dedicated Dashboard: ${dashboardUrl}`,
    ].filter(Boolean).join("\n");

    navigator.clipboard.writeText(lines);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  }

  useEffect(() => {
    if (email === null) router.replace("/login?next=/users");
  }, [email, router]);

  if (email === undefined || email === null) return null;
  if (me?.mfaRequired) return <MfaPrompt next="/users" />;
  if (me && !can(me, "user.read")) return <p className="notice notice-error">Your account does not have Admin permissions.</p>;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: "0 0 4px" }}>Accounts & Platform Users</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Inspect all users registered across the platform (Startups, Support, Jury, Delegates, Volunteers).
          </p>
        </div>
        {(can(me, "role.assign") || me?.roles.includes("admin")) && (
          <button className="btn btn-primary" onClick={() => { setShowCreate(!showCreate); setCreateResult(null); }}>
            {showCreate ? "Hide Credentials Form" : "+ Create Staff Credentials (Customer Support / Management)"}
          </button>
        )}
      </div>

      {showCreate && (
        <section className="card" style={{ margin: "16px 0 24px", borderColor: "var(--accent)", background: "#fafafa" }}>
          <h2 style={{ marginTop: 0 }}>Issue User & Staff Credentials</h2>
          <p className="muted small">
            Admin can directly create credentials with custom or auto-generated passwords for <strong>Customer Support</strong>, <strong>Management Team</strong>, <strong>Administrators</strong>, and other staff members.
          </p>


          <form onSubmit={handleCreateCredential} style={{ display: "grid", gap: 14 }}>
            <div className="two">
              <label>Full Name *
                <input type="text" required placeholder={newRole === "customer_support" ? "e.g. Priya Sharma (Support Lead)" : newRole === "management" ? "e.g. Ramesh Kumar (Management)" : "e.g. Staff Name"} value={newFullName} onChange={(e) => setNewFullName(e.target.value)} />
              </label>
              <label>Role to Grant *
                <select value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
                  <option value="customer_support">🎧 Customer Support (Help Desk & Tickets)</option>
                  <option value="management">👔 Management Team (Applications & Approvals)</option>
                  <option value="admin">🛡️ Administrator (Full Console Access)</option>
                  <option value="jury_member">⚖️ Jury Member (Pitch Scoring & Evaluations)</option>
                  <option value="volunteer">Volunteer (Participant Support)</option>
                  <option value="delegate">Delegate (VIP / Attendee)</option>
                </select>
              </label>
            </div>
            <div className="two">
              <label>Login Email Address *
                <input type="email" required placeholder="support.agent@isf.org" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
              </label>
              <label>Mobile Number
                <input type="tel" placeholder="+91 98765 43210" value={newMobile} onChange={(e) => setNewMobile(e.target.value)} />
              </label>
            </div>
            <div>
              <label>Password (Leave blank to auto-generate)
                <input type="text" placeholder="e.g. Support@2026 or leave blank" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </label>
            </div>
            <div>
              <button type="submit" className="btn btn-primary" disabled={createBusy} style={{ minWidth: 240, height: 42 }}>
                {createBusy ? "Creating Credentials..." : "Generate & Issue Credentials"}
              </button>
            </div>
            {createError && <p className="notice notice-error" role="alert">{createError}</p>}
          </form>

          {createResult && (
            <div className="notice notice-ok" style={{ marginTop: 16, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: 16 }}>
              <h3 style={{ margin: "0 0 8px", color: "#166534" }}>✓ {createResult.message}</h3>
              <div style={{ display: "grid", gap: 6, fontSize: "0.95rem" }}>
                <div><strong>Account Name:</strong> {createResult.user.fullName}</div>
                <div><strong>Login Email:</strong> <code>{createResult.user.email}</code></div>
                {createResult.user.mobile && <div><strong>Mobile:</strong> {createResult.user.mobile}</div>}
                <div><strong>Assigned Roles:</strong> {createResult.user.roles.map((r) => r.role).join(", ")}</div>
                {createResult.temporaryPassword && (
                  <div style={{ background: "#fef3c7", padding: "8px 12px", borderRadius: 6, margin: "6px 0", border: "1px solid #fde68a" }}>
                    <strong>Login Password:</strong> <code style={{ fontSize: "1.15rem", fontWeight: 700, color: "#b45309" }}>{createResult.temporaryPassword}</code>
                    <span className="muted small" style={{ display: "block", marginTop: 2 }}>Please share this password with the user. They can log in immediately.</span>
                  </div>
                )}
                {createResult.activationToken && (
                  <div><strong>Activation Token:</strong> <code>{createResult.activationToken}</code></div>
                )}
                {createResult.user.roles.some((r) => r.role === "customer_support") && (
                  <div style={{ color: "#1e40af", fontSize: "0.85rem", marginTop: 4 }}>
                    ℹ This user has the <strong>Customer Support</strong> role and will automatically land on the Support Help Desk dashboard upon login.
                  </div>
                )}
              </div>
              <div style={{ marginTop: 12 }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={copyCredentials}>
                  {copied ? "✓ Copied to Clipboard!" : "Copy Full Credentials"}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          applyFilter({ q: text.trim(), role: selectedRole, status: selectedStatus, offset: "0" });
        }}
      >
        <label>Search
          <input
            type="text"
            placeholder="Name, email, mobile, or team"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <label>Role
          <select
            value={selectedRole}
            onChange={(e) => {
              const r = e.target.value;
              setSelectedRole(r as Role | "");
              applyFilter({ role: r, offset: "0" });
            }}
          >
            <option value="">Any Role</option>
            <option value="customer_support">Customer Support</option>
            <option value="management">Management Team</option>
            <option value="admin">Administrator</option>
            <option value="jury_member">Jury Member</option>
            <option value="volunteer">Volunteer</option>
            <option value="delegate">Delegate</option>
            <option value="startup_team_leader">Startup Team Leader</option>
            <option value="startup_team_member">Startup Team Member</option>
          </select>
        </label>
        <label>Status
          <select
            value={selectedStatus}
            onChange={(e) => {
              const s = e.target.value;
              setSelectedStatus(s as AccountStatus | "");
              applyFilter({ status: s, offset: "0" });
            }}
          >
            <option value="">Any Status</option>
            {ACCOUNT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-sm" disabled={loadingUsers}>
          {loadingUsers ? "Filtering..." : "Filter"}
        </button>
        {(q || role || status || text) && (
          <button
            type="button"
            className="btn btn-sm"
            style={{ background: "#f1f5f9", color: "#475569" }}
            onClick={() => {
              setText("");
              setSelectedRole("");
              setSelectedStatus("");
              applyFilter({ q: "", role: "", status: "", offset: "0" });
            }}
          >
            Clear Filters
          </button>
        )}
      </form>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {!data && loadingUsers && <p className="muted">Loading accounts...</p>}
      {data && (data.items.length === 0 ? <p className="muted">No accounts match.</p> : (
        <>
          <div className="table-wrap" style={{ opacity: loadingUsers ? 0.6 : 1, transition: "opacity 0.2s" }}>
            <table>
              <thead>
                <tr>
                  <th>User & Track</th>
                  <th>Contact & Location</th>
                  <th>Startup / Team / Domain</th>
                  <th>Roles</th>
                  <th>Status</th>
                  <th>Registered (IST)</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <Link href={`/users/${u.id}`} style={{ fontWeight: 600, color: "var(--accent)" }}>
                        {u.fullName}
                      </Link>
                      {u.category && (
                        <div style={{ marginTop: 4 }}>
                          <span style={{ fontSize: "0.75rem", background: "#e0e7ff", color: "#3730a3", padding: "2px 6px", borderRadius: 4, fontWeight: 600 }}>
                            {label(u.category)}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="small">
                      <div><strong>✉</strong> {u.email ?? "—"}</div>
                      {u.mobile && <div><strong>✆</strong> {u.mobile}</div>}
                      {(u.city || u.state || u.country) && (
                        <div className="muted" style={{ fontSize: "0.75rem", marginTop: 2 }}>
                          📍 {[u.city, u.state, u.country].filter(Boolean).join(", ")}
                        </div>
                      )}
                    </td>
                    <td className="small">
                      {u.teamName ? (
                        <div>
                          <strong>{u.teamName}</strong>
                          {u.domain && <div className="muted" style={{ fontSize: "0.75rem" }}>Domain: {u.domain}</div>}
                          {u.teamMembers && <div className="muted" style={{ fontSize: "0.72rem" }}>Members: {u.teamMembers}</div>}
                        </div>
                      ) : u.domain ? (
                        <div>Domain: {u.domain}</div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                      {u.linkedinUrl && (
                        <div style={{ marginTop: 3 }}>
                          <a href={u.linkedinUrl.startsWith("http") ? u.linkedinUrl : `https://${u.linkedinUrl}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.75rem", color: "#0284c7" }}>
                            LinkedIn ↗
                          </a>
                        </div>
                      )}
                    </td>
                    <td className="small">
                      {u.roles.map((r) => (
                        <span key={r.grantId || r.role} style={{ display: "inline-block", margin: "2px 2px", padding: "2px 6px", background: "#f1f5f9", borderRadius: 4, fontSize: "0.75rem" }}>
                          {label(r.role)}{r.edition ? ` (${r.edition})` : ""}
                        </span>
                      ))}
                      {u.roles.length === 0 && <span className="muted">—</span>}
                    </td>
                    <td>
                      <span className={`status status-${u.status}`}>{label(u.status)}</span>
                    </td>
                    <td className="small">{formatIst(u.createdAt)}</td>
                    <td>
                      <Link href={`/users/${u.id}`} className="btn btn-sm">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions" style={{ marginTop: 16 }}>
            <span className="muted small">{offset + 1}–{offset + data.items.length} of {data.total} registered users</span>
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
