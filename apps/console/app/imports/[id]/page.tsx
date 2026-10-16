"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { IMPORT_COLUMNS, type ImportBatchDetail, type ImportRow } from "@sj/contracts";
import { formatIst } from "@sj/client";
import { api } from "@/lib/session";
import { can, useMe } from "@/lib/me";
import { MfaPrompt } from "../../mfa-prompt";

const OUTCOME_TEXT: Record<ImportRow["outcome"], string> = {
  valid: "Ready", invalid: "Has errors", duplicate: "Duplicate", created: "Created", linked: "Linked", excluded: "Excluded",
};

export default function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me, email } = useMe();
  const [b, setB] = useState<ImportBatchDetail | null>(null);
  const [exclude, setExclude] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<"all" | "problems">("all");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setB(await api.admin.importBatch(id)); } catch (e) { setError((e as Error).message); }
  }, [id]);
  useEffect(() => { if (can(me, "import.manage")) void load(); }, [me, load]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  if (email === undefined) return null;
  if (!email) return <p>Please <Link href={`/signin?next=/imports/${id}`}>sign in</Link>.</p>;
  if (me?.mfaRequired) return <MfaPrompt />;
  if (me && !can(me, "import.manage")) return <p className="notice notice-error">Your account does not have Admin permissions.</p>;
  if (!b) return error ? <p className="notice notice-error">{error}</p> : <p className="muted">Loading…</p>;

  const open = b.state === "previewed";
  const ready = b.rows.filter((r) => r.outcome === "valid" && !exclude.has(r.rowNumber)).length;
  const rows = filter === "problems" ? b.rows.filter((r) => r.errors.length || r.warnings.length) : b.rows;
  const present = new Set(b.rows.flatMap((r) => Object.keys(r.data)));
  const cols = [...IMPORT_COLUMNS[b.category].required, ...IMPORT_COLUMNS[b.category].optional].filter((c) => present.has(c));

  return (
    <>
      <p><Link href="/imports">← Imports</Link></p>
      <h1>{b.fileName}</h1>
      <p className="muted small">
        {b.category} · edition {b.edition} · uploaded {formatIst(b.uploadedAt)}
        {b.committedAt ? ` · committed ${formatIst(b.committedAt)}` : ""} · SHA-256 {b.fileSha256.slice(0, 12)}…
      </p>
      <div className="release-bar">
        <div>
          <span className="status">{b.state}</span>{" "}
          {Object.entries(b.summary).filter(([k]) => k !== "total").map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`).join(" · ")} · {b.summary.total} rows
        </div>
        {open && (
          <div className="actions" style={{ marginTop: 0 }}>
            <button className="btn" disabled={busy} onClick={() => confirm("Discard this import? Nothing will be created.") && void act(() => api.admin.discardImport(b.id))}>Discard</button>
            <button className="btn btn-primary" disabled={busy || ready === 0}
              onClick={() => confirm(`Commit ${ready} ready row(s)? Accounts are created awaiting activation and get ${b.edition} access. Rows are re-checked first.`)
                && void act(() => api.admin.commitImport(b.id, [...exclude]))}>
              Commit {ready} row{ready === 1 ? "" : "s"}
            </button>
          </div>
        )}
      </div>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {open && <p className="muted small">Rows with errors or duplicates are never imported. Untick a ready row to leave it out; leaving out a startup’s leader leaves out the whole startup.</p>}
      <div className="tabs" role="tablist">
        <button className="tab" aria-current={filter === "all"} onClick={() => setFilter("all")}>All rows</button>
        <button className="tab" aria-current={filter === "problems"} onClick={() => setFilter("problems")}>Errors and warnings</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>{open && <th>Import</th>}<th>Row</th><th>Outcome</th>{cols.map((c) => <th key={c}>{c.replace(/_/g, " ")}</th>)}<th>Problems</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rowNumber}>
                {open && (
                  <td>
                    {r.outcome === "valid" && (
                      <input type="checkbox" aria-label={`Import row ${r.rowNumber}`} checked={!exclude.has(r.rowNumber)}
                        onChange={(e) => setExclude((s) => { const n = new Set(s); if (e.target.checked) n.delete(r.rowNumber); else n.add(r.rowNumber); return n; })} />
                    )}
                  </td>
                )}
                <td>{r.rowNumber}</td>
                <td><span className={`status status-${r.outcome}`}>{OUTCOME_TEXT[r.outcome]}</span>{r.action && open && <div className="muted small">will {r.action}</div>}</td>
                {cols.map((c) => <td key={c} className="small">{r.data[c]}</td>)}
                <td className="small">
                  {r.errors.map((e, i) => <div key={`e${i}`} className="field-error">{e.field}: {e.reason}</div>)}
                  {r.warnings.map((w, i) => <div key={`w${i}`} style={{ color: "var(--warn)" }}>{w.field}: {w.reason}</div>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
