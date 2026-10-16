"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { IMPORT_CATEGORIES, IMPORT_COLUMNS, type ImportBatch, type ImportCategory } from "@sj/contracts";
import { ApiError, formatIst } from "@sj/client";
import { api, authMode } from "@/lib/session";
import { can, useMe } from "@/lib/me";
import { MfaPrompt } from "../mfa-prompt";

export default function Imports() {
  const { me, email } = useMe();
  const router = useRouter();
  const [batches, setBatches] = useState<ImportBatch[] | null>(null);
  const [category, setCategory] = useState<ImportCategory>("startups");
  const [edition, setEdition] = useState(2026);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setBatches(await api.admin.imports()); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { if (can(me, "import.manage")) void load(); }, [me, load]);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const b = await api.admin.previewImport({ category, edition, fileName: file.name, csv: await file.text() });
      router.push(`/imports/${b.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.problem.title}. ${err.problem.detail ?? ""}` : (err as Error).message);
    } finally { setBusy(false); }
  }

  function downloadTemplate() {
    const cols = IMPORT_COLUMNS[category];
    const url = URL.createObjectURL(new Blob([[...cols.required, ...cols.optional].join(",") + "\n"], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `sj-import-${category}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  if (email === undefined) return null;
  if (!email) return <p>Please <Link href="/signin?next=/imports">sign in</Link>.</p>;
  if (me?.mfaRequired) return <MfaPrompt next="/imports" />;
  if (me && !can(me, "import.manage")) return <p className="notice notice-error">Your account does not have Admin permissions.</p>;
  const cols = IMPORT_COLUMNS[category];

  return (
    <>
      <h1>Imports</h1>
      <p className="lede">Import predefined startups, jury members, volunteers and delegates. Every file is checked first; nothing is created until you review the preview and commit.</p>
      <form className="card" onSubmit={upload}>
        <div className="two">
          <label>Participant category
            <select value={category} onChange={(e) => setCategory(e.target.value as ImportCategory)}>
              {IMPORT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>Edition
            <select value={edition} onChange={(e) => setEdition(Number(e.target.value))}>
              <option value={2026}>2026</option><option value={2027}>2027</option>
            </select>
          </label>
        </div>
        <label>CSV file
          <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <span className="hint">
            Required columns: <code>{cols.required.join(", ")}</code>. Optional: <code>{cols.optional.join(", ")}</code>.
            Each person needs an email or a mobile number. Files with a password column are rejected.{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); downloadTemplate(); }}>Download the template</a>.
          </span>
        </label>
        <p className="notice notice-warn small" style={{ margin: 0 }}>
          Column set v1 (TBD-41). It is the recommended format and awaits the organising team’s sign-off on a real sample file.
        </p>
        <div><button className="btn btn-primary" disabled={!file || busy}>{busy ? "Checking…" : "Check file"}</button></div>
        {authMode === "dev" && <p className="muted small" style={{ margin: 0 }}>Development sign-in is active. Use test data only.</p>}
      </form>
      {error && <p className="notice notice-error" role="alert" style={{ marginTop: 16 }}>{error}</p>}

      <h2 style={{ marginTop: 32 }}>Recent imports</h2>
      {batches && (batches.length === 0 ? <p className="muted">No imports yet.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>File</th><th>Category</th><th>Edition</th><th>Uploaded (IST)</th><th>Rows</th><th>State</th></tr></thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td><Link href={`/imports/${b.id}`}>{b.fileName}</Link></td>
                  <td>{b.category}</td><td>{b.edition}</td><td className="small">{formatIst(b.uploadedAt)}</td>
                  <td className="small">{b.rowCount} rows · {b.errorCount} with problems</td>
                  <td><span className="status">{b.state}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
