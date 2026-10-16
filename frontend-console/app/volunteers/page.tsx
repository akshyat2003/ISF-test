"use client";
// Volunteer assignment (PRD §9, FR-VOL-*): generate a random draft, review it (unassigned targets and surplus volunteers
// are listed, never hidden), save it, then reassign or close with a reason. History is never overwritten. The API
// enforces every permission (TBD-47: Admin or Management generates; only Management saves and changes) and audits all.
import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, formatIst } from "@sj/client";
import type { VolunteerAssignmentItem, VolunteerOverview, VolunteerTarget } from "@sj/contracts";
import { can, useMe } from "@/lib/me";
import { api, useSessionEmail } from "@/lib/session";
import { MfaPrompt } from "../mfa-prompt";

const YEARS = [2026, 2027];
const targetLabel = (t: VolunteerTarget) => `${t.name} (${t.type === "startup" ? "startup" : "jury member"})`;
const targetValue = (t: { type: string; id: string }) => `${t.type}:${t.id}`;
const parseTarget = (v: string) => { const [type, id] = v.split(":"); return { type: type as "startup" | "jury", id: id! }; };

/** Delivery status exactly as recorded: "queued" means no provider has accepted the message yet (FR-NOT-04). */
function Delivery({ a }: { a: VolunteerAssignmentItem }) {
  if (!a.notifications.length) return <span className="muted small">No messages</span>;
  return (
    <ul className="small plain">
      {a.notifications.map((n, i) => (
        <li key={i}>{n.recipient === "volunteer" ? "Volunteer" : "Target"} · {n.channel.replace("_", "-")}: <span className="status">{n.status}</span></li>
      ))}
    </ul>
  );
}

function Volunteers() {
  const email = useSessionEmail();
  const { me } = useMe();
  const router = useRouter();
  const year = Number(useSearchParams().get("edition") ?? 2026);
  const [o, setO] = useState<VolunteerOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [change, setChange] = useState<{ id: string; mode: "reassign" | "close"; volunteer: string; target: string; reason: string } | null>(null);
  const [manual, setManual] = useState({ volunteer: "", target: "", reason: "" });
  const mayGenerate = can(me, "volunteer.generate"), mayReview = can(me, "volunteer.review"), mayChange = can(me, "volunteer.reassign");

  const load = useCallback(async () => {
    try { setO(await api.manage.volunteers(year)); setError(null); }
    catch (e) {
      setError(e instanceof ApiError && e.code === "mfa_required" ? "mfa_required"
        : e instanceof ApiError && e.status === 403 ? "Your account cannot view volunteer assignments." : (e as Error).message);
    }
  }, [year]);
  useEffect(() => { if (email) void load(); }, [email, load]);

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true); setMessage(null); setError(null);
    try { await fn(); if (ok) setMessage(ok); await load(); }
    catch (e) {
      setError(e instanceof ApiError && e.problem.errors?.length ? e.problem.errors.map((x) => x.message).join(" ") : (e as Error).message);
    } finally { setBusy(false); }
  }

  if (email === undefined) return null;
  if (!email) return <p>Please <Link href="/signin?next=/volunteers">sign in</Link>.</p>;
  const run = o?.draftRun;

  return (
    <>
      <h1>Volunteers</h1>
      <p className="muted">
        Each volunteer is assigned to exactly one startup or one jury member, and each startup and jury member gets at most one volunteer.
        When there are not enough volunteers, the remaining targets are listed as unassigned; nobody is doubled up.
      </p>
      <div className="tabs" role="tablist">
        {YEARS.map((y) => <button key={y} className="tab" aria-current={y === year} onClick={() => router.push(`/volunteers?edition=${y}`)}>{y}</button>)}
      </div>
      {error === "mfa_required" ? <MfaPrompt next="/volunteers" /> : error && <p className="notice notice-error" role="alert">{error}</p>}
      {message && <p className="notice notice-ok" role="status">{message}</p>}

      {o && (
        <>
          <h2>Random assignment</h2>
          {!run ? (
            <>
              <p className="muted small">
                {o.freeVolunteers.length} volunteer(s) without an assignment and {o.unassignedTargets.length} target(s) without a volunteer.
                Generating creates a draft that nobody else sees until it is saved.
              </p>
              {mayGenerate && (
                <div className="actions">
                  <button className="btn btn-primary" disabled={busy}
                    onClick={() => void act(() => api.manage.generateVolunteerRun(year), "Draft generated. Review it below, then save or discard it.")}>
                    Generate random assignment
                  </button>
                </div>
              )}
            </>
          ) : (
            <section className="card" aria-label="Draft assignment">
              <h3>Draft for review <span className="badge">Not visible to participants</span></h3>
              <p className="muted small">
                Generated by {run.startedBy} on {formatIst(run.createdAt)} IST from {run.volunteerCount} volunteer(s) and {run.targetCount} target(s).
                Seed <code>{run.seed.slice(0, 12)}…</code> recorded for reproducibility.
              </p>
              {run.pairs.length > 0 && (
                <div className="table-wrap">
                  <table aria-label="Draft pairs">
                    <thead><tr><th>Volunteer</th><th>Assigned to</th></tr></thead>
                    <tbody>{run.pairs.map((p) => <tr key={p.id}><td>{p.volunteer.name}</td><td>{targetLabel(p.target)}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
              {run.unassignedTargets.length > 0 && (
                <div className="notice notice-warn" role="note">
                  <strong>Not enough volunteers: {run.unassignedTargets.length} target(s) will have no volunteer.</strong>
                  <ul className="small">{run.unassignedTargets.map((t) => <li key={targetValue(t)}>{targetLabel(t)}</li>)}</ul>
                </div>
              )}
              {run.surplusVolunteers.length > 0 && (
                <div className="notice" role="note">
                  <strong>{run.surplusVolunteers.length} volunteer(s) left without a target.</strong>
                  <ul className="small">{run.surplusVolunteers.map((v) => <li key={v.id}>{v.name}</li>)}</ul>
                </div>
              )}
              <div className="actions">
                {mayReview && (
                  <button className="btn btn-primary" disabled={busy}
                    onClick={() => void act(() => api.manage.approveVolunteerRun(run.id), "Assignments saved. Volunteers and targets have been notified.")}>
                    Save and notify
                  </button>
                )}
                {mayGenerate && (
                  <button className="btn" disabled={busy} onClick={() => void act(() => api.manage.discardVolunteerRun(run.id), "Draft discarded.")}>Discard draft</button>
                )}
                {!mayReview && <span className="muted small">A Management user must review and save this draft.</span>}
              </div>
            </section>
          )}

          <h2 style={{ marginTop: 24 }}>Current assignments</h2>
          {o.active.length === 0 ? <p className="muted">No saved assignments yet.</p> : (
            <div className="table-wrap">
              <table aria-label="Current assignments">
                <thead><tr><th>Volunteer</th><th>Assigned to</th><th>Since (IST)</th><th>Messages</th><th></th></tr></thead>
                <tbody>{o.active.map((a) => (
                  <tr key={a.id}>
                    <td>{a.volunteer.name}</td>
                    <td>{targetLabel(a.target)}{a.reason && <div className="muted small">{a.reason}</div>}</td>
                    <td>{a.activatedAt ? formatIst(a.activatedAt) : ""}</td>
                    <td><Delivery a={a} /></td>
                    <td>
                      {mayChange && change?.id !== a.id && (
                        <span className="actions" style={{ marginTop: 0 }}>
                          <button className="btn btn-sm" onClick={() => setChange({ id: a.id, mode: "reassign", volunteer: "", target: "", reason: "" })}>Reassign</button>
                          <button className="btn btn-sm" onClick={() => setChange({ id: a.id, mode: "close", volunteer: "", target: "", reason: "" })}>End</button>
                        </span>
                      )}
                      {change?.id === a.id && (
                        <div className="stack" aria-label={change.mode === "reassign" ? "Reassign" : "End assignment"}>
                          {change.mode === "reassign" && (
                            <>
                              <label className="small">New volunteer
                                <select value={change.volunteer} onChange={(e) => setChange({ ...change, volunteer: e.target.value })}>
                                  <option value="">Keep {a.volunteer.name}</option>
                                  {o.freeVolunteers.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                                </select>
                              </label>
                              <label className="small">New target
                                <select value={change.target} onChange={(e) => setChange({ ...change, target: e.target.value })}>
                                  <option value="">Keep {a.target.name}</option>
                                  {o.unassignedTargets.map((t) => <option key={targetValue(t)} value={targetValue(t)}>{targetLabel(t)}</option>)}
                                </select>
                              </label>
                            </>
                          )}
                          <label className="small">Reason (recorded)<input value={change.reason} onChange={(e) => setChange({ ...change, reason: e.target.value })} /></label>
                          <span className="actions" style={{ marginTop: 0 }}>
                            <button className="btn btn-sm btn-primary" disabled={busy || !change.reason.trim() || (change.mode === "reassign" && !change.volunteer && !change.target)}
                              onClick={() => void act(async () => {
                                if (change.mode === "close") await api.manage.closeVolunteerAssignment(a.id, change.reason.trim());
                                else await api.manage.reassignVolunteer(a.id, { reason: change.reason.trim(),
                                  ...(change.volunteer ? { volunteerUserId: change.volunteer } : {}), ...(change.target ? { target: parseTarget(change.target) } : {}) });
                                setChange(null);
                              }, change.mode === "close" ? "Assignment ended. The target is listed as unassigned." : "Reassigned. The people affected have been notified.")}>
                              {change.mode === "close" ? "Confirm end" : "Confirm reassignment"}
                            </button>
                            <button className="btn btn-sm" onClick={() => setChange(null)}>Cancel</button>
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          <h2 style={{ marginTop: 24 }}>Without a volunteer</h2>
          {o.unassignedTargets.length === 0 ? <p className="muted">Every startup and jury member has a volunteer.</p> : (
            <ul aria-label="Unassigned targets">{o.unassignedTargets.map((t) => <li key={targetValue(t)}>{targetLabel(t)}</li>)}</ul>
          )}
          {o.freeVolunteers.length > 0 && <p className="muted small">Volunteers without an assignment: {o.freeVolunteers.map((v) => v.name).join(", ")}.</p>}
          {mayChange && o.unassignedTargets.length > 0 && o.freeVolunteers.length > 0 && !run && (
            <section className="card" aria-label="Assign by hand">
              <h3>Assign by hand</h3>
              <div className="release-bar">
                <label>Volunteer<select value={manual.volunteer} onChange={(e) => setManual({ ...manual, volunteer: e.target.value })}>
                  <option value="">Choose…</option>{o.freeVolunteers.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select></label>
                <label>Target<select value={manual.target} onChange={(e) => setManual({ ...manual, target: e.target.value })}>
                  <option value="">Choose…</option>{o.unassignedTargets.map((t) => <option key={targetValue(t)} value={targetValue(t)}>{targetLabel(t)}</option>)}
                </select></label>
                <label>Reason<input value={manual.reason} onChange={(e) => setManual({ ...manual, reason: e.target.value })} /></label>
                <button className="btn btn-primary" disabled={busy || !manual.volunteer || !manual.target || !manual.reason.trim()} onClick={() => void act(async () => {
                  await api.manage.assignVolunteer(year, manual.volunteer, parseTarget(manual.target), manual.reason.trim());
                  setManual({ volunteer: "", target: "", reason: "" });
                }, "Assigned. Both people have been notified.")}>Assign</button>
              </div>
            </section>
          )}

          <h2 style={{ marginTop: 24 }}>History</h2>
          {o.history.length === 0 ? <p className="muted">No reassignments or ended assignments yet.</p> : (
            <div className="table-wrap">
              <table aria-label="Assignment history">
                <thead><tr><th>Volunteer</th><th>Was assigned to</th><th>Ended (IST)</th><th>By</th><th>Reason</th><th>Replaced by</th></tr></thead>
                <tbody>{o.history.map((h) => {
                  const next = [...o.active, ...o.history].find((x) => x.replacesId === h.id);
                  return (
                    <tr key={h.id}>
                      <td>{h.volunteer.name}</td><td>{targetLabel(h.target)}</td><td>{h.closedAt ? formatIst(h.closedAt) : ""}</td>
                      <td>{h.closedBy}</td><td>{h.closeReason}</td>
                      <td>{next ? `${next.volunteer.name} → ${next.target.name}` : <span className="muted">—</span>}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}

          {o.runs.length > 0 && (
            <>
              <h2 style={{ marginTop: 24 }}>Generation runs</h2>
              <div className="table-wrap">
                <table aria-label="Generation runs">
                  <thead><tr><th>Generated (IST)</th><th>By</th><th>State</th><th>Pairs</th><th>Unassigned targets</th><th>Surplus volunteers</th></tr></thead>
                  <tbody>{o.runs.map((r) => (
                    <tr key={r.id}>
                      <td>{formatIst(r.createdAt)}</td><td>{r.startedBy}</td>
                      <td><span className="status">{r.state}</span>{r.reviewedBy && <div className="muted small">by {r.reviewedBy}</div>}</td>
                      <td>{r.pairs}</td><td>{r.unassignedTargets}</td><td>{r.surplusVolunteers}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

export default function VolunteersPage() {
  return <Suspense fallback={null}><Volunteers /></Suspense>;
}
