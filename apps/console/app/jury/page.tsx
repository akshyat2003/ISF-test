"use client";
// Management: jury scoring rubrics (TBD-43), jury assignments (TBD-20), the pitch schedule and the startup currently
// pitching (FR-JRY-14), and the review of submitted evaluations (FR-JRY-16). Jury scores are decision support for the
// event only: they are kept apart from AI ranking and never change selection decisions. The API enforces and audits all.
import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, formatIst } from "@sj/client";
import type { EvaluationReview, JuryOverview, JuryParameter } from "@sj/contracts";
import { can, useMe } from "@/lib/me";
import { api, useSessionEmail } from "@/lib/session";
import { MfaPrompt } from "../mfa-prompt";

const YEARS = [2026, 2027];
type Draft = { key: string; label: string; description: string; weight: string; min: string; max: string };
const toDraft = (p: JuryParameter): Draft => ({ key: p.key, label: p.label, description: p.description, weight: String(p.weight), min: String(p.min), max: String(p.max) });
/** A datetime-local value is read as IST (PRD NFR-12). */
const istIso = (v: string) => (v ? `${v.length === 16 ? `${v}:00` : v}+05:30` : null);

function Jury() {
  const email = useSessionEmail();
  const { me } = useMe();
  const router = useRouter();
  const year = Number(useSearchParams().get("edition") ?? 2026);
  const [o, setO] = useState<JuryOverview | null>(null);
  const [review, setReview] = useState<EvaluationReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ from: number; parameters: Draft[]; commentsAllowed: boolean; note: string } | null>(null);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [pick, setPick] = useState({ juror: "", startup: "" });
  const [slot, setSlot] = useState({ startup: "", at: "", venue: "" });
  const [reopen, setReopen] = useState<{ id: string; reason: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const ov = await api.manage.jury(year);
      setO(ov);
      setReview(can(me, "jury.review") ? await api.manage.evaluations(year) : null);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "mfa_required" ? "mfa_required"
        : e instanceof ApiError && e.status === 403 ? "Your account does not have Management permissions for the jury." : (e as Error).message);
    }
  }, [year, me]);
  useEffect(() => { if (email && me) void load(); }, [email, me, load]);

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true); setMessage(null); setError(null);
    try { await fn(); if (ok) setMessage(ok); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function saveVersion() {
    if (!editing) return;
    setFormErrors([]);
    const parameters = editing.parameters.map((d) => ({
      key: d.key.trim(), label: d.label.trim(), description: d.description.trim(), weight: Number(d.weight), min: Number(d.min), max: Number(d.max),
    }));
    setBusy(true);
    try {
      const created = await api.manage.createRubric(year, { parameters, commentsAllowed: editing.commentsAllowed, note: editing.note.trim() || undefined });
      setEditing(null);
      setMessage(`Saved as draft rubric version ${created.version}. Approve it before jurors can use it.`);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors?.length) setFormErrors(e.problem.errors.map((x) => `${x.path || "parameters"}: ${x.message}`));
      else setFormErrors([(e as Error).message]);
    } finally { setBusy(false); }
  }

  if (email === undefined) return null;
  if (!email) return <p>Please <Link href="/signin?next=/jury">sign in</Link>.</p>;
  const set = (i: number, patch: Partial<Draft>) =>
    setEditing((e) => e && { ...e, parameters: e.parameters.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  return (
    <>
      <h1>Jury</h1>
      <p className="muted">
        Jurors score the startups assigned to them against the approved rubric. Their scores support the event&apos;s jury discussion only:
        they are kept apart from AI ranking and never change who was selected. The platform never names a winner.
      </p>
      <div className="tabs" role="tablist">
        {YEARS.map((y) => <button key={y} className="tab" aria-current={y === year} onClick={() => router.push(`/jury?edition=${y}`)}>{y}</button>)}
      </div>
      {error === "mfa_required" ? <MfaPrompt next="/jury" /> : error && <p className="notice notice-error" role="alert">{error}</p>}
      {message && <p className="notice notice-ok" role="status">{message}</p>}

      {o && (
        <>
          <h2>Scoring rubric</h2>
          <p className="muted small">
            {o.activeRubricId ? `Jurors score with version ${o.rubrics.find((r) => r.id === o.activeRubricId)?.version}, the latest approved.`
              : "No rubric is approved yet: jurors cannot score until one is."} Weights are relative: a parameter counts weight ÷ total weight.
            Each submitted evaluation records the version it used.
          </p>
          <div className="list">
            {o.rubrics.map((r) => (
              <section className="card" key={r.id} aria-label={`Rubric version ${r.version}`}>
                <div className="row">
                  <h3>Version {r.version} {r.approvedAt ? <span className="badge badge-selected">Approved</span> : <span className="badge">Draft</span>}</h3>
                  <div className="actions" style={{ marginTop: 0 }}>
                    {!r.approvedAt && (
                      <button className="btn btn-sm btn-primary" disabled={busy}
                        onClick={() => void act(() => api.manage.approveRubric(r.id), `Rubric version ${r.version} approved. It can no longer be changed.`)}>
                        Approve version {r.version}
                      </button>
                    )}
                    <button className="btn btn-sm" disabled={busy} onClick={() => {
                      setFormErrors([]); setEditing({ from: r.version, parameters: r.parameters.map(toDraft), commentsAllowed: r.commentsAllowed, note: "" });
                    }}>New version from this</button>
                  </div>
                </div>
                <p className="muted small">
                  {r.approvedAt ? `Approved by ${r.approvedBy} on ${formatIst(r.approvedAt)} IST. ` : "Not approved. "}
                  {r.createdBy ? `Created by ${r.createdBy}. ` : "Draft default from the requirements (TBD-43). "}
                  Comments {r.commentsAllowed ? "allowed" : "not allowed"}. {r.usedByEvaluations ? `Used by ${r.usedByEvaluations} evaluation(s).` : ""}
                  {r.note ? ` Note: ${r.note}` : ""}
                </p>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Parameter</th><th>Weight</th><th>Scale</th><th>What it measures</th></tr></thead>
                    <tbody>{r.parameters.map((p) => (
                      <tr key={p.key}><td><strong>{p.label}</strong></td><td>{p.weight}</td><td>{p.min}–{p.max}</td><td>{p.description}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>

          {editing && (
            <section className="card" style={{ marginTop: 16 }} aria-label="New rubric version">
              <h3>New rubric version (based on version {editing.from})</h3>
              {editing.parameters.map((c, i) => (
                <fieldset key={i}>
                  <legend>Parameter {i + 1}</legend>
                  <div className="two">
                    <label>Label<input value={c.label} onChange={(e) => set(i, { label: e.target.value })} /></label>
                    <label>Key<input value={c.key} onChange={(e) => set(i, { key: e.target.value })} /></label>
                  </div>
                  <label>What it measures<input value={c.description} onChange={(e) => set(i, { description: e.target.value })} /></label>
                  <div className="two">
                    <label>Weight<input inputMode="numeric" value={c.weight} onChange={(e) => set(i, { weight: e.target.value.replace(/\D/g, "") })} /></label>
                    <label>Lowest score<input inputMode="numeric" value={c.min} onChange={(e) => set(i, { min: e.target.value.replace(/\D/g, "") })} /></label>
                    <label>Highest score<input inputMode="numeric" value={c.max} onChange={(e) => set(i, { max: e.target.value.replace(/\D/g, "") })} /></label>
                  </div>
                  <button className="btn btn-sm" type="button"
                    onClick={() => setEditing((e) => e && { ...e, parameters: e.parameters.filter((_, j) => j !== i) })}>Remove parameter</button>
                </fieldset>
              ))}
              <div className="actions">
                <button className="btn btn-sm" type="button" onClick={() => setEditing((e) => e && {
                  ...e, parameters: [...e.parameters, { key: "", label: "", description: "", weight: "1", min: "1", max: "10" }],
                })}>Add parameter</button>
              </div>
              <label className="check"><input type="checkbox" checked={editing.commentsAllowed}
                onChange={(e) => setEditing({ ...editing, commentsAllowed: e.target.checked })} /> Jurors may add comments</label>
              <label>Note (optional)<input value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} /></label>
              {formErrors.map((m) => <p key={m} className="field-error">{m}</p>)}
              <div className="actions">
                <button className="btn btn-primary" disabled={busy} onClick={() => void saveVersion()}>Save as draft version</button>
                <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </section>
          )}

          <h2 style={{ marginTop: 24 }}>Jury assignments</h2>
          <p className="muted small">Each juror sees and scores only the startups assigned here (TBD-20), plus the profile of the startup currently pitching.</p>
          <div className="release-bar">
            <label>Jury member
              <select aria-label="Jury member" value={pick.juror} onChange={(e) => setPick({ ...pick, juror: e.target.value })}>
                <option value="">Choose…</option>
                {o.jurors.map((j) => <option key={j.id} value={j.id}>{j.fullName} ({j.assigned} assigned)</option>)}
              </select>
            </label>
            <label>Startup
              <select aria-label="Startup to assign" value={pick.startup} onChange={(e) => setPick({ ...pick, startup: e.target.value })}>
                <option value="">Choose…</option>
                {o.startups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <button className="btn btn-primary" disabled={busy || !pick.juror || !pick.startup}
              onClick={() => void act(() => api.manage.assignJury(year, pick.juror, pick.startup), "Jury member assigned.")}>Assign</button>
          </div>
          {o.jurors.length === 0 && <p className="muted">No jury members take part in {year} yet. Import them on the Imports page.</p>}
          {o.assignments.length > 0 && (
            <div className="table-wrap">
              <table aria-label="Jury assignments">
                <thead><tr><th>Jury member</th><th>Startup</th><th>Evaluation</th><th></th></tr></thead>
                <tbody>{o.assignments.map((a) => (
                  <tr key={a.id}>
                    <td>{a.juryName}</td><td>{a.startupName}</td>
                    <td>{a.evaluation ? <span className="status">{a.evaluation.state}</span> : <span className="muted">Not started</span>}</td>
                    <td>{!a.evaluation && <button className="btn btn-sm" disabled={busy}
                      onClick={() => void act(() => api.manage.unassignJury(a.id), "Assignment removed.")}>Remove</button>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          <h2 style={{ marginTop: 24 }}>Pitch schedule</h2>
          {o.currentPitch
            ? <p className="notice notice-ok">Now pitching: <strong>{o.currentPitch.startupName}</strong>{o.currentPitch.venue ? ` at ${o.currentPitch.venue}` : ""}</p>
            : <p className="muted small">No startup is pitching now.</p>}
          <div className="release-bar">
            <label>Startup
              <select aria-label="Startup to schedule" value={slot.startup} onChange={(e) => setSlot({ ...slot, startup: e.target.value })}>
                <option value="">Choose…</option>
                {o.startups.filter((s) => !o.slots.some((x) => x.startupId === s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label>Time (IST)<input type="datetime-local" value={slot.at} onChange={(e) => setSlot({ ...slot, at: e.target.value })} /></label>
            <label>Venue<input value={slot.venue} onChange={(e) => setSlot({ ...slot, venue: e.target.value })} /></label>
            <button className="btn btn-primary" disabled={busy || !slot.startup} onClick={() => void act(async () => {
              await api.manage.createSlot(year, { startupId: slot.startup, startsAt: istIso(slot.at), venue: slot.venue.trim() || null });
              setSlot({ startup: "", at: "", venue: "" });
            }, "Pitch slot added.")}>Add to schedule</button>
          </div>
          {o.slots.length > 0 && (
            <div className="table-wrap">
              <table aria-label="Pitch schedule">
                <thead><tr><th>Time (IST)</th><th>Startup</th><th>Venue</th><th>State</th><th></th></tr></thead>
                <tbody>{o.slots.map((s) => (
                  <tr key={s.id}>
                    <td>{s.startsAt ? formatIst(s.startsAt) : <span className="muted">Not set</span>}</td>
                    <td>{s.startupName}</td><td>{s.venue ?? ""}</td><td><span className="status">{s.state}</span></td>
                    <td className="actions" style={{ marginTop: 0 }}>
                      {s.state !== "pitching" && <button className="btn btn-sm" disabled={busy}
                        onClick={() => void act(() => api.manage.startPitch(s.id), `${s.startupName} is now pitching.`)}>Start pitch</button>}
                      {s.state === "pitching" && <button className="btn btn-sm" disabled={busy}
                        onClick={() => void act(() => api.manage.finishPitch(s.id), "Pitch finished.")}>Finish pitch</button>}
                      {s.state === "scheduled" && <button className="btn btn-sm" disabled={busy}
                        onClick={() => void act(() => api.manage.deleteSlot(s.id), "Slot removed.")}>Remove</button>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {review && (
            <>
              <h2 style={{ marginTop: 24 }}>Evaluation review</h2>
              <p className="muted small">
                Submitted evaluations only. Averages are shown per rubric version and never mixed across versions. These figures are for the jury
                discussion: they do not rank applications and do not change any selection decision.
              </p>
              {review.startups.length === 0 ? <p className="muted">No assignments yet.</p> : (
                <div className="table-wrap">
                  <table aria-label="Evaluation summary">
                    <thead><tr><th>Startup</th><th>Submitted</th><th>Average total (0–100)</th><th>Per parameter (average)</th></tr></thead>
                    <tbody>{review.startups.map((s) => (
                      <tr key={s.startupId}>
                        <td>{s.startupName}</td>
                        <td>{s.submitted} of {s.assigned}</td>
                        <td>{s.byRubric.map((g) => <div key={g.rubricId}>v{g.version}: {g.averageTotal} <span className="muted small">({g.count})</span></div>)}</td>
                        <td className="small">{s.byRubric.map((g) => (
                          <div key={g.rubricId}>v{g.version}: {g.parameters.map((p) => `${p.label} ${p.average}`).join(" · ")}</div>
                        ))}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              {review.evaluations.length > 0 && (
                <div className="table-wrap" style={{ marginTop: 12 }}>
                  <table aria-label="Submitted evaluations">
                    <thead><tr><th>Startup</th><th>Jury member</th><th>Rubric</th><th>Total</th><th>Comments</th><th>Submitted (IST)</th><th></th></tr></thead>
                    <tbody>{review.evaluations.map((e) => (
                      <tr key={e.id}>
                        <td>{e.startupName}</td><td>{e.juryName}</td><td>v{e.rubricVersion}</td><td>{e.totalScore}</td>
                        <td className="small">{e.comments ?? ""}{e.reopenReason && <div className="muted">Reopened before: {e.reopenReason}</div>}</td>
                        <td>{e.submittedAt ? formatIst(e.submittedAt) : ""}</td>
                        <td>
                          {reopen?.id === e.id ? (
                            <span className="actions" style={{ marginTop: 0 }}>
                              <input aria-label="Reason for reopening" value={reopen.reason} onChange={(x) => setReopen({ id: e.id, reason: x.target.value })} />
                              <button className="btn btn-sm btn-primary" disabled={busy || !reopen.reason.trim()} onClick={() => void act(async () => {
                                await api.manage.reopenEvaluation(e.id, reopen.reason.trim()); setReopen(null);
                              }, "Evaluation reopened. The jury member can correct and resubmit it.")}>Confirm reopen</button>
                              <button className="btn btn-sm" onClick={() => setReopen(null)}>Cancel</button>
                            </span>
                          ) : <button className="btn btn-sm" disabled={busy} onClick={() => setReopen({ id: e.id, reason: "" })}>Reopen</button>}
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

export default function JuryPage() {
  return <Suspense fallback={null}><Jury /></Suspense>;
}

