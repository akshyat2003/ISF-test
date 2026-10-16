"use client";
// Notices (FR-NOT-*; TBD-29): Management publishes to everyone, to participant roles or to a named group of one edition.
// Notices appear in the app inbox and, when chosen, as push notifications. Recipients are worked out on the server,
// within the edition only. Corrections and withdrawals are recorded; notices are never deleted.
import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, formatIst } from "@sj/client";
import { AUDIENCE_LABEL, PARTICIPANT_ROLES, type NoticeAudience, type NoticePreview, type NoticesOverview, type ParticipantRole } from "@sj/contracts";
import { api, useSessionEmail } from "@/lib/session";
import { MfaPrompt } from "../mfa-prompt";

const YEARS = [2026, 2027];
type Compose = { title: string; body: string; kind: "everyone" | "roles" | "group"; roles: ParticipantRole[]; groupId: string; sendPush: boolean };
const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
const empty: Compose = { title: "", body: "", kind: "everyone", roles: [], groupId: "", sendPush: true };
const audienceOf = (c: Compose): NoticeAudience =>
  c.kind === "everyone" ? { kind: "everyone" } : c.kind === "roles" ? { kind: "roles", roles: c.roles } : { kind: "group", groupId: c.groupId };

function Notices() {
  const email = useSessionEmail();
  const router = useRouter();
  const year = Number(useSearchParams().get("edition") ?? 2026);
  const [o, setO] = useState<NoticesOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [c, setC] = useState<Compose>(empty);
  const [preview, setPreview] = useState<NoticePreview | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [change, setChange] = useState<{ id: string; kind: "edit" | "withdraw"; title: string; body: string; reason: string } | null>(null);
  const [group, setGroup] = useState({ name: "", description: "" });
  const [member, setMember] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try { setO(await api.manage.notices(year)); setError(null); }
    catch (e) {
      setError(e instanceof ApiError && e.code === "mfa_required" ? "mfa_required"
        : e instanceof ApiError && e.status === 403 ? "Only Management publishes notices." : (e as Error).message);
    }
  }, [year]);
  useEffect(() => { if (email) void load(); }, [email, load]);
  useEffect(() => { setPreview(null); }, [c.kind, c.roles, c.groupId]);

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true); setMessage(null); setError(null); setErrors({});
    try { await fn(); if (ok) setMessage(ok); await load(); return true; }
    catch (e) {
      if (e instanceof ApiError && e.problem.errors?.length) setErrors(e.fieldErrors());
      else setError((e as Error).message);
      return false;
    } finally { setBusy(false); }
  }

  if (email === undefined) return null;
  if (!email) return <p>Please <Link href="/signin?next=/notices">sign in</Link>.</p>;

  return (
    <>
      <h1>Notices</h1>
      <p className="muted">
        Notices go to the app inbox of everyone in the chosen audience who takes part in the {year} event and, if you choose, as a push notification
        to their phones. No email, SMS or WhatsApp (TBD-29). You can correct or withdraw a notice later; both are recorded.
      </p>
      <div className="tabs" role="tablist">
        {YEARS.map((y) => <button key={y} className="tab" aria-current={y === year} onClick={() => router.push(`/notices?edition=${y}`)}>{y}</button>)}
      </div>
      {error === "mfa_required" ? <MfaPrompt next="/notices" /> : error && <p className="notice notice-error" role="alert">{error}</p>}
      {message && <p className="notice notice-ok" role="status">{message}</p>}

      {o && (
        <>
          <section className="card" aria-label="New notice">
            <h2 style={{ marginTop: 0 }}>New notice</h2>
            <label>Title<input value={c.title} maxLength={200} onChange={(e) => setC({ ...c, title: e.target.value })} />
              {errors.title && <span className="field-error">{errors.title}</span>}</label>
            <label>Message<textarea rows={5} value={c.body} maxLength={4000} onChange={(e) => setC({ ...c, body: e.target.value })} />
              {errors.body && <span className="field-error">{errors.body}</span>}</label>
            <fieldset>
              <legend>Send to</legend>
              <label className="check"><input type="radio" name="kind" checked={c.kind === "everyone"} onChange={() => setC({ ...c, kind: "everyone" })} /> Everyone taking part in {year}</label>
              <label className="check"><input type="radio" name="kind" checked={c.kind === "roles"} onChange={() => setC({ ...c, kind: "roles" })} /> Selected roles</label>
              {c.kind === "roles" && (
                <div className="choices-inline" style={{ marginLeft: 24 }}>
                  {PARTICIPANT_ROLES.map((r) => (
                    <label key={r} className="check"><input type="checkbox" checked={c.roles.includes(r)}
                      onChange={(e) => setC({ ...c, roles: e.target.checked ? [...c.roles, r] : c.roles.filter((x) => x !== r) })} /> {AUDIENCE_LABEL[r]}</label>
                  ))}
                </div>
              )}
              <label className="check"><input type="radio" name="kind" checked={c.kind === "group"} onChange={() => setC({ ...c, kind: "group" })} disabled={!o.groups.length} />
                An authorised group{!o.groups.length && <span className="muted small"> (create one below first)</span>}</label>
              {c.kind === "group" && (
                <select aria-label="Group" value={c.groupId} onChange={(e) => setC({ ...c, groupId: e.target.value })} style={{ marginLeft: 24 }}>
                  <option value="">Choose…</option>
                  {o.groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.members.length})</option>)}
                </select>
              )}
              {(errors.audience || errors["audience.roles"] || errors["audience.groupId"]) &&
                <span className="field-error">{errors.audience ?? errors["audience.roles"] ?? errors["audience.groupId"]}</span>}
            </fieldset>
            <label className="check"><input type="checkbox" checked={c.sendPush} onChange={(e) => setC({ ...c, sendPush: e.target.checked })} /> Also send as a push notification</label>
            <div className="actions">
              <button className="btn" disabled={busy || (c.kind === "roles" && !c.roles.length) || (c.kind === "group" && !c.groupId)}
                onClick={() => void act(async () => setPreview(await api.manage.previewNotice(year, audienceOf(c))))}>Check recipients</button>
              <button className="btn btn-primary" disabled={busy || !preview || !preview.recipients || !c.title.trim() || !c.body.trim()}
                onClick={() => void act(async () => {
                  await api.manage.publishNotice(year, { title: c.title.trim(), body: c.body.trim(), audience: audienceOf(c), sendPush: c.sendPush });
                  setC(empty); setPreview(null);
                }, "Notice published.")}>Publish to {preview ? people(preview.recipients) : "…"}</button>
            </div>
            {preview && (
              <p className={preview.recipients ? "muted small" : "field-error"} role="status">
                {preview.recipients
                  ? `${people(preview.recipients)} will see it in the app.${c.sendPush ? ` ${preview.withDevice} of them have the app with notifications on (${preview.devices} devices).` : ""}`
                  : "Nobody in this audience takes part in the event yet."}
              </p>
            )}
          </section>

          <h2 style={{ marginTop: 24 }}>Published notices</h2>
          {o.notices.length === 0 ? <p className="muted">No notices yet.</p> : (
            <div className="list">
              {o.notices.map((n) => (
                <section className="card" key={n.id} aria-label={`Notice: ${n.title}`} style={n.withdrawnAt ? { opacity: 0.7 } : undefined}>
                  <div className="row">
                    <h3 style={{ margin: 0 }}>{n.title} {n.withdrawnAt && <span className="badge">Withdrawn</span>}{n.editedAt && !n.withdrawnAt && <span className="badge">Corrected</span>}</h3>
                    {!n.withdrawnAt && change?.id !== n.id && (
                      <span className="actions" style={{ marginTop: 0 }}>
                        <button className="btn btn-sm" onClick={() => setChange({ id: n.id, kind: "edit", title: n.title, body: n.body, reason: "" })}>Correct</button>
                        <button className="btn btn-sm" onClick={() => setChange({ id: n.id, kind: "withdraw", title: n.title, body: n.body, reason: "" })}>Withdraw</button>
                      </span>
                    )}
                  </div>
                  <p className="small" style={{ whiteSpace: "pre-wrap" }}>{n.body}</p>
                  <p className="muted small">
                    To {n.audienceLabel} · {people(n.recipients)} · published {formatIst(n.publishedAt)} IST by {n.publishedBy}
                    {n.editedAt && ` · corrected ${formatIst(n.editedAt)} IST by ${n.editedBy}`}
                    {n.withdrawnAt && ` · withdrawn ${formatIst(n.withdrawnAt)} IST by ${n.withdrawnBy}: ${n.withdrawReason}`}
                  </p>
                  <p className="small" aria-label="Delivery">
                    In the app: <strong>{n.delivery.inApp.total}</strong> inboxes, {n.delivery.inApp.read} opened
                    {n.sendPush && <> · Push: {n.delivery.push.sent} handed to the push service, {n.delivery.push.queued} waiting, {n.delivery.push.failed} failed
                      {n.delivery.push.cancelled > 0 && `, ${n.delivery.push.cancelled} cancelled`}</>}
                  </p>
                  {change?.id === n.id && (
                    <div className="stack" aria-label={change.kind === "edit" ? "Correct notice" : "Withdraw notice"}>
                      {change.kind === "edit" && (<>
                        <label className="small">Title<input value={change.title} onChange={(e) => setChange({ ...change, title: e.target.value })} /></label>
                        <label className="small">Message<textarea rows={4} value={change.body} onChange={(e) => setChange({ ...change, body: e.target.value })} /></label>
                      </>)}
                      <label className="small">{change.kind === "edit" ? "Why are you correcting it? (recorded)" : "Why are you withdrawing it? (recorded)"}
                        <input value={change.reason} onChange={(e) => setChange({ ...change, reason: e.target.value })} /></label>
                      <span className="actions" style={{ marginTop: 0 }}>
                        <button className="btn btn-sm btn-primary" disabled={busy || !change.reason.trim()} onClick={() => void act(async () => {
                          if (change.kind === "edit") await api.manage.editNotice(n.id, { title: change.title.trim(), body: change.body.trim(), reason: change.reason.trim() });
                          else await api.manage.withdrawNotice(n.id, change.reason.trim());
                          setChange(null);
                        }, change.kind === "edit" ? "Corrected. Inboxes show the new text." : "Withdrawn. It no longer shows in anyone's inbox.")}>
                          {change.kind === "edit" ? "Save correction" : "Confirm withdrawal"}</button>
                        <button className="btn btn-sm" onClick={() => setChange(null)}>Cancel</button>
                      </span>
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}

          <h2 style={{ marginTop: 24 }}>Authorised groups</h2>
          <p className="muted small">Named lists of participants for notices, kept by Management (TBD-29). Only people taking part in the {year} event can be added.</p>
          <div className="release-bar">
            <label>Group name<input value={group.name} onChange={(e) => setGroup({ ...group, name: e.target.value })} /></label>
            <label>Description<input value={group.description} onChange={(e) => setGroup({ ...group, description: e.target.value })} /></label>
            <button className="btn btn-primary" disabled={busy || !group.name.trim()} onClick={() => void act(async () => {
              await api.manage.createNoticeGroup(year, group.name.trim(), group.description.trim() || undefined); setGroup({ name: "", description: "" });
            }, "Group created.")}>Create group</button>
          </div>
          <div className="list" style={{ marginTop: 12 }}>
            {o.groups.map((g) => (
              <section className="card" key={g.id} aria-label={`Group: ${g.name}`}>
                <h3 style={{ marginTop: 0 }}>{g.name} <span className="muted small">({g.members.length})</span></h3>
                {g.description && <p className="muted small">{g.description}</p>}
                <ul className="plain small">
                  {g.members.map((m) => (
                    <li key={m.id}>{m.fullName} <span className="muted">({m.roles.map((r) => AUDIENCE_LABEL[r as ParticipantRole] ?? r).join(", ")})</span>{" "}
                      <button className="link" onClick={() => void act(() => api.manage.removeGroupMember(g.id, m.id), "Removed from the group.")}>Remove</button></li>
                  ))}
                </ul>
                <div className="release-bar">
                  <label>Add a participant
                    <select aria-label={`Add to ${g.name}`} value={member[g.id] ?? ""} onChange={(e) => setMember({ ...member, [g.id]: e.target.value })}>
                      <option value="">Choose…</option>
                      {o.participants.filter((p) => !g.members.some((m) => m.id === p.id)).map((p) => (
                        <option key={p.id} value={p.id}>{p.fullName} ({p.roles.map((r) => AUDIENCE_LABEL[r as ParticipantRole] ?? r).join(", ")})</option>
                      ))}
                    </select>
                  </label>
                  <button className="btn" disabled={busy || !member[g.id]} onClick={() => void act(async () => {
                    await api.manage.addGroupMembers(g.id, [member[g.id]!]); setMember({ ...member, [g.id]: "" });
                  }, "Added to the group.")}>Add</button>
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}

export default function NoticesPage() {
  return <Suspense fallback={null}><Notices /></Suspense>;
}
