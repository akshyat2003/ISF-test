"use client";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ACCOUNT_STATUSES, ROLES, type AccountStatus, type AdminUserList, type Role } from "@sj/contracts";
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

  if (email === undefined) return null;
  if (!email) return <p>Please <Link href="/signin?next=/users">sign in</Link>.</p>;
  if (me?.mfaRequired) return <MfaPrompt next="/users" />;
  if (me && !can(me, "user.read")) return <p className="notice notice-error">Your account does not have Admin permissions.</p>;

  return (
    <>
      <h1>Accounts</h1>
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
