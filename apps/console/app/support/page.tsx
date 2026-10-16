"use client";
// Customer Support queue (FR-SUP-01…15): emergencies first, unacknowledged and overdue tickets highlighted, live alerts.
// Customer Support works the queue; Management reviews it read-only and sets the acknowledgement windows (TBD-27).
import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TICKET_STATUSES, type RequesterMatch, type SupportAlerts, type SupportPolicy, type SupportQueue } from "@sj/contracts";
import { formatIst } from "@sj/client";
import { api } from "@/lib/session";
import { can, useMe } from "@/lib/me";
import { MfaPrompt } from "../mfa-prompt";

const REASON: Record<string, string> = {
  emergency: "New emergency", high_priority: "New high-priority ticket", reminder: "Still not acknowledged", escalation: "Escalated to Management",
  overdue: "Overdue", no_support_staff: "No support staff active — you are alerted instead", reported_again: "Reported again by the requester",
};
const POLL_MS = 15_000;

function Queue() {
  const { me, email } = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const status = params.get("status") ?? "";
  const mine = params.get("mine") === "true";
  const [q, setQ] = useState<SupportQueue | null>(null);
  const [alerts, setAlerts] = useState<SupportAlerts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const allowed = can(me, "support.handle") || can(me, "support.review");

  const load = useCallback(async () => {
    try {
      setQ(await api.support.queue({ status: status || undefined, mine }));
      if (can(me, "support.alerts")) setAlerts(await api.support.alerts());
      setError(null);
    } catch (e) { setError((e as Error).message); }
  }, [status, mine, me]);
  useEffect(() => {
    if (!allowed) return;
    void load();
    const t = setInterval(() => void load(), POLL_MS);   // alerts arrive within one poll; sweeps re-alert until acknowledged
    return () => clearInterval(t);
  }, [allowed, load]);

  const go = (next: Record<string, string>) => {
    const p = new URLSearchParams({ status, mine: mine ? "true" : "", ...next });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    router.push(`/support${p.size ? `?${p}` : ""}`);
  };

  if (email === undefined) return null;
  if (!email) return <p>Please <Link href="/signin?next=/support">sign in</Link>.</p>;
  if (me?.mfaRequired) return <MfaPrompt next="/support" />;
  if (me && !allowed) return <p className="notice notice-error">Your account does not have Customer Support or Management permissions.</p>;

  return (
    <>
      <h1>Support</h1>
      {q && !q.canEdit && <p className="notice notice-warn">Read-only review. Customer Support acknowledges, works and resolves tickets.</p>}
      {alerts && alerts.alerts.length > 0 && (
        <section className="notice notice-error" role="alert" aria-live="assertive">
          <strong>{alerts.unacknowledgedEmergencies ? `${alerts.unacknowledgedEmergencies} emergency ticket(s) not yet acknowledged.` : "New alerts."}</strong>
          <ul className="plain">
            {alerts.alerts.slice(0, 8).map((a) => (
              <li key={a.id}>
                <Link href={`/support/${a.ticketId}`}><strong>{a.ref}</strong> {a.subject}</Link>{" "}
                <span className="small">· {REASON[a.reason] ?? a.reason}{a.round ? ` (round ${a.round})` : ""} · {formatIst(a.createdAt)}</span>{" "}
                <button className="btn btn-sm" onClick={() => void api.support.alertSeen(a.id).then(load)}>Seen</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {q && (
        <p className="muted small">
          {q.counts.open} open · {q.counts.unacknowledgedEmergencies} unacknowledged emergencies · {q.counts.overdue} overdue · {q.counts.escalated} escalated
        </p>
      )}
      <div className="toolbar">
        <label>Status
          <select value={status} onChange={(e) => go({ status: e.target.value })}>
            <option value="">Not resolved</option>
            {TICKET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {q?.canEdit && <label className="check"><input type="checkbox" checked={mine} onChange={(e) => go({ mine: e.target.checked ? "true" : "" })} /> Assigned to me</label>}
      </div>
      {q && (q.tickets.length === 0 ? <p className="muted">No tickets.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Ticket</th><th>Requester</th><th>Status</th><th>Assignee</th><th>Created (IST)</th><th>Acknowledge by</th></tr></thead>
            <tbody>
              {q.tickets.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/support/${t.id}`}><strong>{t.ref}</strong> {t.subject}</Link><br />
                    {t.isEmergency && <span className="badge badge-not">Emergency</span>}{" "}
                    {!t.isEmergency && t.priority === "high" && <span className="badge badge-under">High</span>}{" "}
                    {t.overdue && <span className="badge badge-not">Overdue</span>}{" "}
                    {t.escalation && <span className="badge badge-under">Escalated</span>}
                  </td>
                  <td className="small">{t.requesterName}</td>
                  <td>{t.status}</td>
                  <td className="small">{t.assignee?.name ?? "—"}</td>
                  <td className="small">{formatIst(t.createdAt)}</td>
                  <td className="small">{t.status === "Open" && t.ackDueAt ? formatIst(t.ackDueAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {q?.canEdit && <NewTicket onCreated={(id) => router.push(`/support/${id}`)} editions={me?.editionAccess ?? []} />}
      {can(me, "support.configure") && <Policy year={2026} />}
    </>
  );
}

/** FR-SUP-14: raise a ticket for a caller or walk-in, linked to their account when an exact match is found. */
function NewTicket({ onCreated, editions }: { onCreated: (id: string) => void; editions: number[] }) {
  const [edition, setEdition] = useState(String(editions[0] ?? 2026));
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"normal" | "high" | "emergency">("normal");
  const [lookup, setLookup] = useState("");
  const [matches, setMatches] = useState<RequesterMatch[] | null>(null);
  const [requester, setRequester] = useState<RequesterMatch | null>(null);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const t = await api.support.create({
        edition: Number(edition), subject, ...(description ? { description } : {}), priority: kind === "normal" ? "normal" : "high", isEmergency: kind === "emergency",
        ...(requester ? { requesterId: requester.id } : { contact: { name: contactName, ...(contactPhone ? { phone: contactPhone } : {}) } }),
      });
      onCreated(t.id);
    } catch (x) { setError((x as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="card" style={{ marginTop: 24 }}>
      <h2>Raise a ticket for someone</h2>
      <p className="muted small">For a phone call or a walk-in. Find their account by exact email or mobile number, or enter the caller&rsquo;s name.</p>
      <form className="stack" onSubmit={submit}>
        <div className="toolbar">
          <label>Find account
            <input type="text" value={lookup} placeholder="Exact email or mobile" onChange={(e) => setLookup(e.target.value)} />
          </label>
          <button type="button" className="btn btn-sm" disabled={lookup.trim().length < 3}
            onClick={() => void api.support.findRequester(lookup.trim()).then(setMatches, (x: Error) => setError(x.message))}>Find</button>
        </div>
        {matches && (matches.length === 0 ? <p className="muted small">No account with exactly that email or mobile.</p> : (
          <div className="choices-inline">
            {matches.map((m) => (
              <label key={m.id} className="check">
                <input type="radio" name="req" checked={requester?.id === m.id} onChange={() => setRequester(m)} /> {m.name} <span className="muted small">({m.roles.join(", ") || "no role"})</span>
              </label>
            ))}
            {requester && <button type="button" className="btn btn-sm" onClick={() => setRequester(null)}>Clear</button>}
          </div>
        ))}
        {!requester && (
          <div className="toolbar">
            <label>Caller&rsquo;s name<input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)} /></label>
            <label>Phone (optional)<input type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} /></label>
          </div>
        )}
        <div className="toolbar">
          <label>Edition
            <select value={edition} onChange={(e) => setEdition(e.target.value)}>
              {[...new Set([...editions, 2026, 2027])].sort().map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label>Priority
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="normal">Normal</option><option value="high">High</option><option value="emergency">Emergency (high)</option>
            </select>
          </label>
        </div>
        <label>Subject<input type="text" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} required /></label>
        <label>Details<textarea value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} /></label>
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        <div><button className="btn btn-primary" disabled={busy || !subject.trim() || (!requester && !contactName.trim())}>Raise ticket</button></div>
      </form>
    </section>
  );
}

const POLICY_FIELDS: [keyof SupportPolicy, string][] = [
  ["emergencyAckMinutes", "Emergency: acknowledge within (minutes)"], ["highAckMinutes", "High priority: acknowledge within"],
  ["normalAckMinutes", "Normal: acknowledge within"], ["emergencyRealertMinutes", "Emergency: re-alert every"],
  ["highRealertMinutes", "High priority: re-alert every"], ["maxRealerts", "Maximum re-alerts"],
];

/** TBD-27: per-edition windows. The defaults are a recommendation awaiting organiser approval. */
function Policy({ year: initial }: { year: number }) {
  const [year, setYear] = useState(initial);
  const [p, setP] = useState<SupportPolicy | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  useEffect(() => { api.support.policy(year).then(setP, (e: Error) => setMsg({ kind: "error", text: e.message })); }, [year]);
  return (
    <section className="card" style={{ marginTop: 24 }}>
      <h2>Acknowledgement windows</h2>
      <p className="muted small">Pending organiser approval (TBD-27). Changes apply to tickets raised afterwards and to re-alert timing at once.</p>
      <label>Edition <select value={year} onChange={(e) => setYear(Number(e.target.value))}><option>2026</option><option>2027</option></select></label>
      {p && (
        <form className="stack" onSubmit={(e) => {
          e.preventDefault();
          api.support.setPolicy(year, p).then((n) => { setP(n); setMsg({ kind: "ok", text: "Saved." }); }, (x: Error) => setMsg({ kind: "error", text: x.message }));
        }}>
          <div className="toolbar">
            {POLICY_FIELDS.map(([k, l]) => (
              <label key={k}>{l}<input type="number" min={1} value={p[k]} onChange={(e) => setP({ ...p, [k]: Number(e.target.value) })} /></label>
            ))}
          </div>
          {msg && <p className={`notice notice-${msg.kind}`} role={msg.kind === "error" ? "alert" : undefined}>{msg.text}</p>}
          <div><button className="btn btn-primary">Save windows</button></div>
        </form>
      )}
    </section>
  );
}

export default function Page() {
  return <Suspense><Queue /></Suspense>;
}
