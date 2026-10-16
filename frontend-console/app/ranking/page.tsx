"use client";
// Management: criteria sets (TBD-01) and AI ranking runs (FR-RNK-*). The AI recommends; Management decides on the
// Applications pages. Every action here is enforced and audited by the API.
import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, formatIst } from "@sj/client";
import type { Criterion, CriteriaSet, RankingRunSummary } from "@sj/contracts";
import { api, useSessionEmail } from "@/lib/session";
import { MfaPrompt } from "../mfa-prompt";

const YEARS = [2026, 2027];

type Draft = { key: string; label: string; description: string; weight: string; min: string; max: string; guidance: string };
const toDraft = (c: Criterion): Draft => ({
  key: c.key, label: c.label, description: c.description, weight: String(c.weight), min: String(c.min), max: String(c.max), guidance: c.guidance.join("\n"),
});

function Ranking() {
  const email = useSessionEmail();
  const router = useRouter();
  const year = Number(useSearchParams().get("edition") ?? 2026);
  const [sets, setSets] = useState<CriteriaSet[] | null>(null);
  const [runs, setRuns] = useState<RankingRunSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ from: number; criteria: Draft[]; note: string } | null>(null);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [runSet, setRunSet] = useState("");

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([api.manage.criteriaSets(year), api.manage.runs(year)]);
      setSets(s);
      setRuns(r);
      setRunSet((cur) => cur || s.find((x) => x.approvedAt)?.id || "");
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "mfa_required" ? "mfa_required"
        : e instanceof ApiError && e.status === 403 ? "Your account does not have Management permissions." : (e as Error).message);
    }
  }, [year]);
  useEffect(() => { if (email) void load(); }, [email, load]);

  // Poll while a run is queued or running: the worker processes it in the background.
  const active = runs.some((r) => r.status === "queued" || r.status === "running");
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => void load(), 3000);
    return () => clearInterval(id);
  }, [active, load]);

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true); setMessage(null); setError(null);
    try { await fn(); if (ok) setMessage(ok); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function saveVersion() {
    if (!editing) return;
    setFormErrors([]);
    const criteria = editing.criteria.map((d) => ({
      key: d.key.trim(), label: d.label.trim(), description: d.description.trim(), weight: Number(d.weight), min: Number(d.min), max: Number(d.max),
      guidance: d.guidance.split("\n").map((g) => g.trim()).filter(Boolean),
    }));
    setBusy(true);
    try {
      const created = await api.manage.createCriteriaSet(year, { criteria, note: editing.note.trim() || undefined });
      setEditing(null);
      setMessage(`Saved as draft version ${created.version}. A Management user must approve it before it can be used.`);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors?.length) setFormErrors(e.problem.errors.map((x) => `${x.path || "criteria"}: ${x.message}`));
      else setFormErrors([(e as Error).message]);
    } finally { setBusy(false); }
  }

  if (email === undefined) return null;
  if (!email) return <p>Please <Link href="/signin?next=/ranking">sign in</Link>.</p>;
  const set = (i: number, patch: Partial<Draft>) =>
    setEditing((e) => e && { ...e, criteria: e.criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const weightSum = editing?.criteria.reduce((a, c) => a + (Number(c.weight) || 0), 0) ?? 0;

  return (
    <>
      <h1>AI ranking</h1>
      <p className="muted">
        The AI scores each application against criteria that Management approves, and ranks them. It only recommends:
        Management makes every decision on the Applications page. Applicants never see AI scores.
      </p>
      <div className="tabs" role="tablist">
        {YEARS.map((y) => (
          <button key={y} className="tab" aria-current={y === year} onClick={() => router.push(`/ranking?edition=${y}`)}>{y}</button>
        ))}
      </div>
      {error === "mfa_required" ? <MfaPrompt next="/ranking" /> : error && <p className="notice notice-error" role="alert">{error}</p>}
      {message && <p className="notice notice-ok">{message}</p>}

      {sets && (
        <>
          <h2>Criteria</h2>
          <div className="list">
            {sets.map((s) => (
              <section className="card" key={s.id} aria-label={`Criteria version ${s.version}`}>
                <div className="row">
                  <h3>Version {s.version} {s.approvedAt ? <span className="badge badge-selected">Approved</span> : <span className="badge">Draft</span>}</h3>
                  <div className="actions" style={{ marginTop: 0 }}>
                    {!s.approvedAt && (
                      <button className="btn btn-sm btn-primary" disabled={busy}
                        onClick={() => confirm(`Approve criteria version ${s.version}? It cannot be changed afterwards.`) &&
                          void act(() => api.manage.approveCriteriaSet(s.id), `Version ${s.version} approved.`)}>
                        Approve version {s.version}
                      </button>
                    )}
                    <button className="btn btn-sm" disabled={busy}
                      onClick={() => { setFormErrors([]); setEditing({ from: s.version, criteria: s.criteria.map(toDraft), note: "" }); }}>
                      New version from this
                    </button>
                  </div>
                </div>
                <p className="muted small">
                  {s.approvedAt ? `Approved by ${s.approvedBy} on ${formatIst(s.approvedAt)} IST. ` : "Not approved: it cannot be used for ranking yet. "}
                  {s.createdBy ? `Created by ${s.createdBy}. ` : "Recommended default (TBD-01). "}
                  {s.usedByRuns ? `Used by ${s.usedByRuns} run(s).` : ""}
                  {s.note ? ` Note: ${s.note}` : ""}
                </p>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Criterion</th><th>Weight</th><th>Scale</th><th>What it measures</th></tr></thead>
                    <tbody>
                      {s.criteria.map((c) => (
                        <tr key={c.key}>
                          <td><strong>{c.label}</strong></td>
                          <td>{c.weight}%</td>
                          <td>{c.min}–{c.max}</td>
                          <td>
                            {c.description}
                            <details><summary className="small">Score guidance</summary>
                              <ol start={c.min} className="small">{c.guidance.map((g, i) => <li key={i}>{g}</li>)}</ol>
                            </details>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>

          {editing && (
            <section className="card" style={{ marginTop: 16 }} aria-label="New criteria version">
              <h3>New version (based on version {editing.from})</h3>
              <p className="muted small">Weights are whole percentages and must add up to 100 (now {weightSum}). Give one line of guidance per score.</p>
              {editing.criteria.map((c, i) => (
                <fieldset key={i}>
                  <legend>Criterion {i + 1}</legend>
                  <div className="two">
                    <label>Label<input value={c.label} onChange={(e) => set(i, { label: e.target.value })} /></label>
                    <label>Key<input value={c.key} onChange={(e) => set(i, { key: e.target.value })} /></label>
                  </div>
                  <label>What it measures<input value={c.description} onChange={(e) => set(i, { description: e.target.value })} /></label>
                  <div className="two">
                    <label>Weight (%)<input inputMode="numeric" value={c.weight} onChange={(e) => set(i, { weight: e.target.value.replace(/\D/g, "") })} /></label>
                    <label>Lowest score<input inputMode="numeric" value={c.min} onChange={(e) => set(i, { min: e.target.value.replace(/\D/g, "") })} /></label>
                    <label>Highest score<input inputMode="numeric" value={c.max} onChange={(e) => set(i, { max: e.target.value.replace(/\D/g, "") })} /></label>
                  </div>
                  <label>Guidance, one line per score from lowest to highest<textarea rows={5} value={c.guidance} onChange={(e) => set(i, { guidance: e.target.value })} /></label>
                  <button className="btn btn-sm" type="button"
                    onClick={() => setEditing((e) => e && { ...e, criteria: e.criteria.filter((_, j) => j !== i) })}>Remove criterion</button>
                </fieldset>
              ))}
              <div className="actions">
                <button className="btn btn-sm" type="button" onClick={() => setEditing((e) => e && {
                  ...e, criteria: [...e.criteria, { key: "", label: "", description: "", weight: "0", min: "1", max: "5", guidance: "" }],
                })}>Add criterion</button>
              </div>
              <label>Note (optional)<input value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} /></label>
              {formErrors.map((m) => <p key={m} className="field-error">{m}</p>)}
              <div className="actions">
                <button className="btn btn-primary" disabled={busy} onClick={() => void saveVersion()}>Save as draft version</button>
                <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </section>
          )}

          <h2 style={{ marginTop: 24 }}>Ranking runs</h2>
          <div className="release-bar">
            <label>Criteria version
              <select value={runSet} onChange={(e) => setRunSet(e.target.value)}>
                <option value="">Choose an approved version</option>
                {sets.filter((s) => s.approvedAt).map((s) => <option key={s.id} value={s.id}>Version {s.version}</option>)}
              </select>
            </label>
            <button className="btn btn-primary" disabled={busy || !runSet || active}
              onClick={() => void act(() => api.manage.startRun(year, runSet), "Ranking run started. Results appear here when it finishes.")}>
              Rank all {year} applications
            </button>
          </div>
          <p className="muted small">
            A run ranks the whole cohort, so it can start only after {year} registration has closed (TBD-42). Applications the AI cannot
            score reliably are flagged for manual review instead of being ranked low.
          </p>
          {runs.some((r) => r.modelRef.startsWith("stub:")) && (
            <p className="notice notice-warn" role="note">
              Runs marked <code>stub:</code> used the development stub. It is <strong>not an AI</strong>: its scores carry no meaning, and
              production refuses to start with it (TBD-35).
            </p>
          )}
          {runs.length === 0 ? <p className="muted">No ranking runs yet.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Started (IST)</th><th>Criteria</th><th>Model</th><th>Status</th><th>Ranked</th><th>Flagged</th><th></th></tr></thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td>{formatIst(r.startedAt)}<div className="muted small">by {r.startedBy}</div></td>
                      <td>Version {r.criteriaVersion}</td>
                      <td className="small">{r.modelRef}<div className="muted">{r.promptVersion}</div></td>
                      <td><span className="status">{r.status}</span>{r.error && <div className="field-error">{r.error}</div>}</td>
                      <td>{r.counts.scored} / {r.counts.total}</td>
                      <td>{r.counts.flagged}</td>
                      <td><Link href={`/ranking/${r.id}`}>Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}

export default function RankingPage() {
  return <Suspense fallback={null}><Ranking /></Suspense>;
}
