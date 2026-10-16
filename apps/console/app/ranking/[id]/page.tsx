"use client";
// One ranking run (FR-RNK-03, -07, -11, -13): ranks, criterion scores, explanations and flags, the criteria version,
// model and prompt version it used, and review aids (score spread per criterion). Earlier runs stay viewable here.
// The AI only recommends: decisions are drafted on the application pages.
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { ApiError, formatIst } from "@sj/client";
import type { RankingRunDetail } from "@sj/contracts";
import { FLAG_LABELS } from "@/lib/ranking";
import { api, useSessionEmail } from "@/lib/session";
import { MfaPrompt } from "../../mfa-prompt";

/** Lowest, median and highest score per criterion among the scored applications (PRD §8 review aids). */
function spread(values: number[]) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const median = s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  return { min: s[0]!, median, max: s[s.length - 1]!, mean: s.reduce((a, b) => a + b, 0) / s.length };
}

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const email = useSessionEmail();
  const [run, setRun] = useState<RankingRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cutLine, setCutLine] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.manage.run(id);
      setRun(r);
      setCutLine(r.cutLine?.toString() ?? "");
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "mfa_required" ? "mfa_required" : (e as Error).message);
    }
  }, [id]);
  useEffect(() => { if (email) void load(); }, [email, load]);

  // The worker processes the run in the background; poll until it has finished.
  const active = run?.status === "queued" || run?.status === "running";
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [active, load]);

  if (email === undefined) return null;
  if (!email) return <p>Please <Link href={`/signin?next=/ranking/${id}`}>sign in</Link>.</p>;
  if (error === "mfa_required") return <MfaPrompt next={`/ranking/${id}`} />;
  if (error && !run) return <p className="notice notice-error" role="alert">{error}</p>;
  if (!run) return <p className="muted">Loading…</p>;

  const ranked = run.results.filter((r) => r.state === "scored");
  const manual = run.results.filter((r) => r.state === "flagged");
  const pending = run.results.filter((r) => r.state === "pending");
  // TBD-18: N for override detection is the selection limit; the run's cut line applies only when no limit is set.
  const n = run.selectionLimit ?? run.cutLine;
  const stub = run.modelRef.startsWith("stub:");

  async function saveCutLine() {
    setBusy(true); setMessage(null); setError(null);
    try {
      const r = await api.manage.setCutLine(id, cutLine ? Number(cutLine) : null);
      setRun(r);
      setMessage(cutLine ? `Cut line set to ${cutLine}.` : "Cut line removed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="small"><Link href={`/ranking?edition=${run.edition}`}>← {run.edition} AI ranking</Link></p>
      <h1>Ranking run · {run.edition}</h1>
      <p className="muted">
        <span className="status">{run.status}</span> · criteria version {run.criteriaVersion} · model {run.modelRef} · prompt {run.promptVersion}
        <br />Started {formatIst(run.startedAt)} IST by {run.startedBy}{run.finishedAt && <> · finished {formatIst(run.finishedAt)} IST</>}
      </p>
      {stub && (
        <p className="notice notice-warn" role="note">
          <strong>Development stub, not an AI evaluation.</strong> These scores come from a hash of each application and carry no
          meaning. Production refuses to start with the stub (TBD-35).
        </p>
      )}
      {run.status === "failed" && <p className="notice notice-error">The run failed: {run.error}. Every unscored application was sent to manual review.</p>}
      {active && <p className="notice notice-warn">The run is {run.status}: {pending.length} of {run.counts.total} applications still to score. This page refreshes itself.</p>}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {message && <p className="notice notice-ok">{message}</p>}

      <section className="card" style={{ marginBottom: 16 }} aria-label="Override line">
        <h2>Override line</h2>
        {run.selectionLimit !== null ? (
          <p className="small">
            The {run.edition} selection limit, <strong>{run.selectionLimit}</strong>, is the line: selecting an application ranked below it, or not
            selecting one ranked within it, is an override and needs a written reason (TBD-18). Change the limit on the{" "}
            <Link href={`/applications?edition=${run.edition}`}>Applications</Link> page.
          </p>
        ) : (
          <>
            <p className="small">
              No selection limit is set for {run.edition}. Set a cut line here so overrides of this ranking can be recognised; without one, decisions
              are recorded with the rank but no override check (TBD-18).
            </p>
            <div className="toolbar">
              <label>Cut line (top N)
                <input type="text" inputMode="numeric" placeholder="none" value={cutLine} onChange={(e) => setCutLine(e.target.value.replace(/\D/g, ""))} />
              </label>
              <button className="btn btn-sm" disabled={busy || run.status !== "completed"} onClick={() => void saveCutLine()}>Save</button>
            </div>
          </>
        )}
      </section>

      <h2>Criteria (version {run.criteriaVersion})</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Criterion</th><th>Weight</th><th>Scale</th><th>Lowest · median · highest · mean (scored)</th></tr></thead>
          <tbody>
            {run.criteria.map((c) => {
              const sp = spread(ranked.map((r) => r.scores.find((s) => s.key === c.key)?.score).filter((v): v is number => v !== undefined));
              return (
                <tr key={c.key}>
                  <td><strong>{c.label}</strong><div className="muted small">{c.description}</div></td>
                  <td>{c.weight}%</td>
                  <td>{c.min}–{c.max}</td>
                  <td>{sp ? `${sp.min} · ${sp.median} · ${sp.max} · ${sp.mean.toFixed(1)}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: 24 }}>Ranked ({ranked.length})</h2>
      <p className="muted small">
        Weighted totals (0–100) are computed from the approved weights outside the model; equal totals share a rank. Open an explanation to see
        the evidence the AI cited. Applicants never see any of this (TBD-44).
      </p>
      {ranked.length === 0 ? <p className="muted">No application has been ranked in this run.</p> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rank</th><th>Startup</th><th>Status</th><th>Total</th>
                {run.criteria.map((c) => <th key={c.key} title={c.description}>{c.label}</th>)}
                <th>Flags and explanation</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r) => (
                <tr key={r.applicationId}>
                  <td>
                    <strong>{r.rank}</strong>
                    {n !== null && <div className="muted small">{r.rank! <= n ? `within top ${n}` : `below top ${n}`}</div>}
                  </td>
                  <td><Link href={`/applications/${r.applicationId}`}>{r.startupName}</Link></td>
                  <td><span className="status">{r.applicationStatus}</span></td>
                  <td>{r.totalScore?.toFixed(2)}</td>
                  {run.criteria.map((c) => {
                    const s = r.scores.find((x) => x.key === c.key);
                    return <td key={c.key}>{s ? `${s.score}/${s.max}` : "—"}</td>;
                  })}
                  <td className="small">
                    {r.flags.map((f) => <div key={f}><span className="flag">{FLAG_LABELS[f] ?? f}</span></div>)}
                    <details>
                      <summary>Explanation</summary>
                      {r.summary && <p>{r.summary}</p>}
                      <ul>{r.scores.map((s) => <li key={s.key}><strong>{s.label} {s.score}/{s.max}:</strong> {s.explanation}</li>)}</ul>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={{ marginTop: 24 }}>Manual review ({manual.length})</h2>
      <p className="muted small">
        These applications were not ranked, so they are not placed low by mistake (FR-RNK-13). Review each one yourself; you can still decide on it.
      </p>
      {manual.length === 0 ? <p className="muted">None.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Startup</th><th>Status</th><th>Why</th></tr></thead>
            <tbody>
              {manual.map((r) => (
                <tr key={r.applicationId}>
                  <td><Link href={`/applications/${r.applicationId}`}>{r.startupName}</Link></td>
                  <td><span className="status">{r.applicationStatus}</span></td>
                  <td>{r.flags.map((f) => <div key={f}><span className="flag">{FLAG_LABELS[f] ?? f}</span></div>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
