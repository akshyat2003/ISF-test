"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { formatIst } from "@sj/client";
import { overrideOf, type FormQuestion, type ManageApplication } from "@sj/contracts";
import { useMe } from "@/lib/me";
import { FLAG_LABELS } from "@/lib/ranking";
import { api, useSessionEmail } from "@/lib/session";

const OUTCOME = { selected: "selected", not_selected: "not selected" } as const;

export default function ApplicationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const email = useSessionEmail();
  const [a, setA] = useState<ManageApplication | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [questions, setQuestions] = useState<FormQuestion[]>([]);
  const { me } = useMe();
  const [correctionReason, setCorrectionReason] = useState("");
  const [reviewNote, setReviewNote] = useState("");

  useEffect(() => {
    if (!email) return;
    api.manage.get(id).then((x) => { setA(x); setReason(x.decision?.reason ?? ""); }).catch((e: Error) => setError(e.message));
  }, [email, id]);

  // Question wording comes from the edition's form configuration (TBD-39); unknown keys fall back to the key itself.
  useEffect(() => {
    if (!a) return;
    api.editions().then((es) => setQuestions(es.find((e) => e.year === a.edition)?.applicationForm.questions ?? [])).catch(() => setQuestions([]));
  }, [a?.edition]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(fn: () => Promise<ManageApplication>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      setA(await fn());
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const decide = (outcome: "selected" | "not_selected") => run(() => api.manage.decide(id, { outcome, reason: reason.trim() || undefined }));

  if (email === undefined) return null;
  if (!email) return <p>Please <Link href={`/signin?next=/applications/${id}`}>sign in</Link>.</p>;
  if (error && !a) return <p className="notice notice-error">{error}</p>;
  if (!a) return <p className="muted">Loading…</p>;
  const released = !!a.decision?.releasedAt;
  const ai = a.ai;
  const overrides = (["selected", "not_selected"] as const).filter((o) => overrideOf(o, ai?.rank ?? null, ai?.cutLine ?? null));
  const pending = a.corrections.find((c) => c.status === "pending");
  const mine = pending && me?.account?.id === pending.requestedById;

  return (
    <>
      <p className="small"><Link href={`/applications?edition=${a.edition}`}>← {a.edition} applications</Link></p>
      <h1>{a.startup.name}</h1>
      <p className="muted">Startup Jathara {a.edition} · <span className="status">{a.status}</span>{a.flags.map((f) => <span key={f}> · <span className="flag">{FLAG_LABELS[f] ?? f.replace(/_/g, " ")}</span></span>)}</p>
      {a.withdrawnAt && <p className="notice notice-warn">The applicant withdrew this application on {formatIst(a.withdrawnAt)} IST. It is excluded from ranking and decisions.</p>}
      <section className="card" style={{ marginBottom: 16 }} aria-label="AI ranking">
        <h2>AI ranking <span className="muted small">(advice only; Management decides)</span></h2>
        {!ai ? (
          <p className="muted">Not ranked yet. Rankings are produced on the <Link href={`/ranking?edition=${a.edition}`}>AI ranking</Link> page after registration closes.</p>
        ) : ai.state !== "scored" ? (
          <p>Not ranked: {ai.flags.map((f) => <span key={f} className="flag">{FLAG_LABELS[f] ?? f}</span>)} <span className="muted small">Review this application yourself.</span></p>
        ) : (
          <>
            <p>
              Rank <strong>{ai.rank}</strong> · weighted total <strong>{ai.totalScore?.toFixed(2)}</strong> / 100 · criteria version {ai.criteriaVersion}
              {ai.cutLine !== null && <> · cut line {ai.cutLine}</>} · <Link href={`/ranking/${ai.runId}`}>whole run</Link>
            </p>
            {ai.flags.map((f) => <p key={f}><span className="flag">{FLAG_LABELS[f] ?? f}</span></p>)}
            {ai.summary && <p className="small">{ai.summary}</p>}
            <div className="table-wrap">
              <table>
                <thead><tr><th>Criterion</th><th>Score</th><th>Explanation</th></tr></thead>
                <tbody>{ai.scores.map((s) => <tr key={s.key}><td>{s.label}</td><td>{s.score} / {s.max}</td><td className="small">{s.explanation}</td></tr>)}</tbody>
              </table>
            </div>
          </>
        )}
      </section>
      <div className="grid">
        <section className="card">
          <h2>Startup</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{a.startup.description}</p>
          <dl>
            <dt>Website</dt><dd>{a.startup.website ? <a href={a.startup.website} target="_blank" rel="noreferrer">{a.startup.website}</a> : "—"}</dd>
            <dt>Location</dt><dd>{[a.startup.city, a.startup.state].filter(Boolean).join(", ") || "—"}</dd>
            <dt>Submitted</dt><dd>{formatIst(a.submittedAt)} IST</dd>
            <dt>Other year</dt><dd>{a.otherEditions.map((o) => `${o.edition}: ${o.status}`).join(", ") || "—"}</dd>
            {a.formVersion && <><dt>Form version</dt><dd>{a.formVersion}</dd></>}
          </dl>
          {/* Questions are long: each answer gets its own block instead of a two-column row (TBD-39). */}
          {Object.entries(a.formAnswers).map(([k, v]) => (
            <div key={k} style={{ marginTop: 12 }}>
              <p className="small muted" style={{ margin: 0 }}>{questions.find((q) => q.key === k)?.label ?? k}</p>
              <p style={{ whiteSpace: "pre-wrap", margin: "2px 0 0", overflowWrap: "anywhere" }}>{String(v)}</p>
            </div>
          ))}
        </section>
        <section className="card">
          <h2>Team leader</h2>
          <dl>
            <dt>Name</dt><dd>{a.leader.fullName}</dd>
            <dt>Email</dt><dd>{a.leader.email ?? "—"}</dd>
            <dt>Mobile</dt><dd>{a.leader.mobile ?? "—"}</dd>
          </dl>
        </section>
        <section className="card">
          <h2>Decision</h2>
          {a.decision && (
            <>
              <p>
                {released ? "Released" : "Draft"}: <strong>{OUTCOME[a.decision.outcome]}</strong>
                {released && <> on {formatIst(a.decision.releasedAt!)} IST</>}
                {a.decision.correctedAt && <> · corrected {formatIst(a.decision.correctedAt)} IST</>}
              </p>
              {a.decision.isOverride && <p><span className="flag">Override of the AI ranking (rank {a.decision.aiRankAtDecision})</span></p>}
              {a.decision.reason && <p className="small">Reason: {a.decision.reason}</p>}
            </>
          )}
          {a.status === "withdrawn" ? null : released ? (
            <>
              <h3>Correction</h3>
              {pending ? (
                <div className="notice notice-warn">
                  <p><strong>{pending.requestedBy}</strong> asked to change this decision to <strong>{OUTCOME[pending.toOutcome]}</strong> on {formatIst(pending.requestedAt)} IST.</p>
                  <p className="small">Reason: {pending.reason}</p>
                  {mine ? (
                    <div className="actions">
                      <span className="small">A different Management member must approve it.</span>
                      <button className="btn btn-sm" disabled={busy} onClick={() => void run(() => api.manage.cancelCorrection(pending.id))}>Cancel my request</button>
                    </div>
                  ) : (
                    <>
                      <label>Note (optional)<input value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} /></label>
                      <div className="actions">
                        <button className="btn btn-sm btn-primary" disabled={busy}
                          onClick={() => confirm(`Approve: change the released decision to "${OUTCOME[pending.toOutcome]}"? The applicant will be notified.`) &&
                            void run(() => api.manage.approveCorrection(pending.id, reviewNote.trim() || undefined))}>
                          Approve correction
                        </button>
                        <button className="btn btn-sm" disabled={busy} onClick={() => void run(() => api.manage.rejectCorrection(pending.id, reviewNote.trim() || undefined))}>Reject</button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <p className="muted small">A released decision changes only through a correction: you give the reason, and a second Management member approves it (TBD-37).</p>
                  <label>Reason for changing it to “{OUTCOME[a.decision!.outcome === "selected" ? "not_selected" : "selected"]}”
                    <textarea value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} />
                  </label>
                  <div className="actions">
                    <button className="btn btn-sm" disabled={busy || !correctionReason.trim()}
                      onClick={() => void run(() => api.manage.requestCorrection(id, {
                        outcome: a.decision!.outcome === "selected" ? "not_selected" : "selected", reason: correctionReason,
                      })).then((ok) => ok && setCorrectionReason(""))}>
                      Request correction
                    </button>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <label>Reason {overrides.length ? <strong>(required for an override)</strong> : "(optional, internal)"}
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              {overrides.length > 0 && (
                <p className="small notice notice-warn">
                  The AI ranked this application {ai!.rank} with a cut line of {ai!.cutLine}. {overrides.includes("selected") ? "Selecting" : "Not selecting"} it
                  overrides the ranking, so give a reason (TBD-18).
                </p>
              )}
              <div className="actions">
                <button className="btn btn-primary" disabled={busy} onClick={() => void decide("selected")}>Draft: select</button>
                <button className="btn" disabled={busy} onClick={() => void decide("not_selected")}>Draft: not select</button>
              </div>
              <p className="muted small">Drafts are released together from the applications list.</p>
            </>
          )}
          {error && <p className="field-error" role="alert">{error}</p>}
          {a.corrections.filter((c) => c.status !== "pending").length > 0 && (
            <details style={{ marginTop: 12 }}><summary className="small">Correction history</summary>
              <ul className="small">
                {a.corrections.filter((c) => c.status !== "pending").map((c) => (
                  <li key={c.id}>{formatIst(c.requestedAt)}: {c.requestedBy} asked for “{OUTCOME[c.toOutcome]}” ({c.reason}) — {c.status}
                    {c.reviewedBy && <> by {c.reviewedBy}</>}{c.reviewNote && <>: {c.reviewNote}</>}</li>
                ))}
              </ul>
            </details>
          )}
          {a.notifications.length > 0 && (
            <>
              <h3>Messages to the applicant</h3>
              <ul className="small plain">
                {a.notifications.map((n, i) => (
                  <li key={i}>{n.kind === "decision_corrected" ? "Correction" : "Result"} · {n.channel.replace("_", "-")} · <span className="status">{n.status}</span>
                    {n.sentAt ? ` ${formatIst(n.sentAt)}` : n.status === "queued" ? " (waiting for delivery)" : ""}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </>
  );
}
