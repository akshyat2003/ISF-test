"use client";
// One support ticket (FR-SUP-02…13): authorised requester details, the Help Desk transcript, the full history, and
// the actions Customer Support may take. Management sees the same page read-only. Every view and action is audited.
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import type { SupportTicketDetail } from "@sj/contracts";
import { formatIst } from "@sj/client";
import { api } from "@/lib/session";
import { can, useMe } from "@/lib/me";
import { MfaPrompt } from "../../mfa-prompt";

const EVENT: Record<string, string> = {
  created: "Raised", status: "Status", assigned: "Assigned", note: "Internal note", reply: "Reply to requester", contact: "Contacted requester",
  escalated: "Escalated", requester_note: "Requester added", priority: "Priority raised",
};

function describe(kind: string, d: Record<string, unknown>, names: Map<string, string>): string {
  if (kind === "status") return `${String(d.from ?? "")} → ${String(d.to ?? "")}${d.note ? `: ${String(d.note)}` : ""}`;
  if (kind === "assigned") return d.assigneeId ? `to ${names.get(String(d.assigneeId)) ?? "a support team member"}` : "unassigned";
  if (kind === "contact") return `${String(d.method ?? "")}: ${String(d.outcome ?? "")}`;
  if (kind === "escalated") return `to Management${d.automatic ? " (automatic)" : ""}: ${String(d.reason ?? "")}`;
  if (kind === "priority") return `${String(d.from ?? "")} → ${String(d.to ?? "")}`;
  if (kind === "created") return [String(d.source ?? "").replace(/_/g, " "), d.isEmergency ? "emergency" : String(d.priority ?? "")].filter(Boolean).join(" · ");
  return String(d.text ?? "");
}

export default function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me, email } = useMe();
  const [t, setT] = useState<SupportTicketDetail | null>(null);
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [visibility, setVisibility] = useState<"internal" | "requester">("internal");
  const [resolution, setResolution] = useState("");
  const [contact, setContact] = useState({ method: "phone" as "phone" | "email" | "in_person" | "other", outcome: "" });
  const [reason, setReason] = useState("");
  const allowed = can(me, "support.handle") || can(me, "support.review");

  const load = useCallback(async () => {
    try { setT(await api.support.ticket(id)); } catch (e) { setError((e as Error).message); }
  }, [id]);
  useEffect(() => {
    if (!allowed) return;
    void load();
    if (can(me, "support.handle")) api.support.queue().then((q) => setStaff(q.staff), () => {});
  }, [allowed, load, me]);

  async function act(fn: () => Promise<SupportTicketDetail>, after?: () => void) {
    setBusy(true); setError(null);
    try { setT(await fn()); after?.(); } catch (e) { setError((e as Error).message); await load(); } finally { setBusy(false); }
  }

  if (email === undefined) return null;
  if (!email) return <p>Please <Link href={`/signin?next=/support/${id}`}>sign in</Link>.</p>;
  if (me?.mfaRequired) return <MfaPrompt />;
  if (me && !allowed) return <p className="notice notice-error">Your account does not have Customer Support or Management permissions.</p>;

  return (
    <>
      <p><Link href="/support">← Support</Link></p>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {t && (
        <>
          <h1>{t.ref} · {t.subject}</h1>
          <p>
            {t.isEmergency && <span className="badge badge-not">Emergency</span>}{" "}
            <span className="badge">{t.priority === "high" ? "High priority" : "Normal priority"}</span>{" "}
            <strong>{t.status}</strong>{t.overdue && <> · <span className="badge badge-not">Not acknowledged in time</span></>}
            <span className="muted small"> · raised {formatIst(t.createdAt)}{t.edition ? ` · ${t.edition}` : ""}
              {t.status === "Open" && t.ackDueAt ? ` · acknowledge by ${formatIst(t.ackDueAt)}` : ""}
              {t.acknowledgedAt ? ` · acknowledged ${formatIst(t.acknowledgedAt)} by ${t.acknowledgedBy ?? "—"}` : ""}
              · alerts {t.alerts.sent} sent, {t.alerts.seen} seen</span>
          </p>
          {t.escalation && (
            <p className="notice notice-warn">Escalated to Management {formatIst(t.escalation.at)}{t.escalation.by ? ` by ${t.escalation.by}` : " automatically"}: {t.escalation.reason}</p>
          )}
          {!t.canEdit && t.status !== "Resolved" && <p className="notice notice-warn">Read-only.</p>}
          {t.isEmergency && t.status === "Open" && t.canEdit && (
            <p className="notice notice-error" role="alert">Emergency: acknowledge now, then contact the requester. If life is at risk and they have not called 112, call 112.</p>
          )}

          <div className="two">
            <section className="card">
              <h2>Requester</h2>
              {t.requester ? (
                <ul className="plain">
                  <li><strong>{t.requester.name}</strong></li>
                  <li>{t.requester.mobile ? <a href={`tel:${t.requester.mobile}`}>{t.requester.mobile}</a> : "No mobile"}</li>
                  <li>{t.requester.email ?? "No email"}</li>
                  <li className="small">{t.requester.roles.join(", ") || "No role"}{t.requester.startup ? ` · ${t.requester.startup}` : ""}</li>
                </ul>
              ) : t.contact ? (
                <ul className="plain"><li><strong>{t.contact.name}</strong> (no account)</li><li>{t.contact.phone ? <a href={`tel:${t.contact.phone}`}>{t.contact.phone}</a> : "No phone"}</li></ul>
              ) : <p className="muted">Unknown.</p>}
              {t.description && <><h3>Details</h3><p style={{ whiteSpace: "pre-wrap" }}>{t.description}</p></>}
              {t.resolutionNote && <><h3>Resolution</h3><p style={{ whiteSpace: "pre-wrap" }}>{t.resolutionNote}</p><p className="muted small">by {t.resolvedBy} · {t.resolvedAt ? formatIst(t.resolvedAt) : ""}</p></>}
            </section>

            {t.canEdit && (
              <section className="card stack">
                <h2>Actions</h2>
                {t.status === "Open" && <div><button className="btn btn-primary" disabled={busy} onClick={() => void act(() => api.support.acknowledge(t.id))}>Acknowledge</button></div>}
                {t.status === "Acknowledged" && <div><button className="btn" disabled={busy} onClick={() => void act(() => api.support.status(t.id, { status: "In Progress" }))}>Start work (In Progress)</button></div>}
                <label>Assignee
                  <select value={t.assignee?.id ?? ""} disabled={busy} onChange={(e) => void act(() => api.support.assign(t.id, e.target.value || null))}>
                    <option value="">Unassigned</option>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                {t.priority === "normal" && <div><button className="btn btn-sm" disabled={busy} onClick={() => void act(() => api.support.raisePriority(t.id))}>Raise to high priority</button></div>}
                {!t.escalation && (
                  <form className="toolbar" onSubmit={(e) => { e.preventDefault(); void act(() => api.support.escalate(t.id, reason), () => setReason("")); }}>
                    <label>Escalate to Management<input type="text" value={reason} placeholder="Reason" onChange={(e) => setReason(e.target.value)} /></label>
                    <button className="btn btn-sm" disabled={busy || !reason.trim()}>Escalate</button>
                  </form>
                )}
                {t.status !== "Open" && (
                  <form className="stack" onSubmit={(e) => { e.preventDefault(); void act(() => api.support.status(t.id, { status: "Resolved", note: resolution }), () => setResolution("")); }}>
                    <label>Resolution notes (required; resolving is final)<textarea value={resolution} onChange={(e) => setResolution(e.target.value)} /></label>
                    <div><button className="btn btn-primary" disabled={busy || !resolution.trim()}>Resolve</button></div>
                  </form>
                )}
              </section>
            )}
          </div>

          {t.canEdit && (
            <div className="two" style={{ marginTop: 16 }}>
              <section className="card">
                <h2>Add a note</h2>
                <form className="stack" onSubmit={(e) => { e.preventDefault(); void act(() => api.support.note(t.id, { text: note, visibility }), () => setNote("")); }}>
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
                  <div className="choices-inline">
                    <label className="check"><input type="radio" checked={visibility === "internal"} onChange={() => setVisibility("internal")} /> Internal (staff only)</label>
                    <label className="check"><input type="radio" checked={visibility === "requester"} onChange={() => setVisibility("requester")} /> Reply to requester (they are notified)</label>
                  </div>
                  <div><button className="btn" disabled={busy || !note.trim()}>Add</button></div>
                </form>
              </section>
              <section className="card">
                <h2>Log contact</h2>
                <form className="stack" onSubmit={(e) => { e.preventDefault(); void act(() => api.support.contact(t.id, contact), () => setContact({ ...contact, outcome: "" })); }}>
                  <label>Method
                    <select value={contact.method} onChange={(e) => setContact({ ...contact, method: e.target.value as typeof contact.method })}>
                      <option value="phone">Phone</option><option value="email">Email</option><option value="in_person">In person</option><option value="other">Other</option>
                    </select>
                  </label>
                  <label>Outcome<input type="text" value={contact.outcome} onChange={(e) => setContact({ ...contact, outcome: e.target.value })} /></label>
                  <div><button className="btn" disabled={busy || !contact.outcome.trim()}>Log</button></div>
                </form>
              </section>
            </div>
          )}

          {t.transcript && t.transcript.length > 0 && (
            <section className="card" style={{ marginTop: 16 }}>
              <h2>Help Desk conversation</h2>
              <ul className="plain">
                {t.transcript.map((m, i) => (
                  <li key={i}><strong>{m.role === "user" ? "Requester" : "Assistant"}:</strong> {m.text} <span className="muted small">{formatIst(m.at)}</span></li>
                ))}
              </ul>
            </section>
          )}

          <section className="card" style={{ marginTop: 16 }}>
            <h2>History</h2>
            <ul className="plain">
              {t.events.map((e) => (
                <li key={e.id}>
                  <span className="muted small">{formatIst(e.at)}</span> · <strong>{EVENT[e.kind] ?? e.kind}</strong> {describe(e.kind, e.detail, new Map(staff.map((s) => [s.id, s.name])))}{" "}
                  <span className="muted small">— {e.actor ?? "system"}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
