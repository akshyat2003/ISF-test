"use client";
// Event information and documents (FR-EVT-*). One official copy for the website and the app. Every edit is a draft
// until published; each publish is a new version with a change summary. TBD-24: the Admin edits documents, emergency
// contacts, safety guidelines and pages; Management edits the schedule, venues, food, accommodation and travel.
// The API enforces who may edit what; this page only hides the buttons.
import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, formatIst } from "@sj/client";
import {
  AUDIENCE_LABEL, CONTENT_AUDIENCES, CONTENT_TYPE_LABEL, CONTENT_TYPES, DOCUMENT_TYPES, MAX_DOCUMENT_BYTES,
  type ContentAudience, type ContentOverview, type ContentType, type ContentVersion, type ManagedContentItem,
} from "@sj/contracts";
import { api, useSessionEmail } from "@/lib/session";
import { MfaPrompt } from "../mfa-prompt";

const YEARS = [2026, 2027];
type Tab = ContentType | "documents";
type Form = { id: string | null; type: ContentType; title: string; audience: ContentAudience[]; f: Record<string, string>; tentative: boolean };

/** "Public" and "All participants" already include everyone, so they stand alone; roles combine with each other. */
function toggleAudience(value: ContentAudience[], a: ContentAudience, on: boolean): ContentAudience[] {
  if (!on) return value.filter((x) => x !== a);
  if (a === "public" || a === "participants") return [a];
  return [...value.filter((x) => x !== "public" && x !== "participants"), a];
}
const blank = (type: ContentType): Form => ({ id: null, type, title: "", audience: ["public"], f: {}, tentative: type === "schedule_item" });
function toForm(i: ManagedContentItem): Form {
  const src = i.draft ?? i.live!;
  const b = src.body as Record<string, unknown>;
  const f: Record<string, string> = {};
  for (const [k, v] of Object.entries(b)) if (k !== "tentative") f[k] = Array.isArray(v) ? v.join("\n") : v == null ? "" : String(v);
  return { id: i.id, type: i.type, title: src.title, audience: src.audience as ContentAudience[], f, tentative: !!b.tentative };
}
function toBody(form: Form): Record<string, unknown> {
  const v = (k: string) => (form.f[k] ?? "").trim();
  const opt = (k: string) => v(k) || null;
  switch (form.type) {
    case "schedule_item":
      return { day: v("day"), startTime: opt("startTime"), endTime: opt("endTime"), venue: opt("venue"), details: opt("details"),
        tentative: form.tentative, order: Number(v("order") || 0) };
    case "meal":
      return { day: v("day"), meal: v("meal") || "lunch", startTime: opt("startTime"), endTime: opt("endTime"), venue: opt("venue"),
        menu: v("menu").split("\n").map((x) => x.trim()).filter(Boolean), notes: opt("notes") };
    case "venue": return { address: opt("address"), mapUrl: opt("mapUrl"), notes: opt("notes") };
    case "emergency_contact": return { phone: v("phone"), available: opt("available"), notes: opt("notes") };
    default: return { text: v("text"), address: opt("address") };
  }
}
const summary = (i: ManagedContentItem) => {
  const b = (i.draft ?? i.live)!.body as Record<string, string | null>;
  if (i.type === "schedule_item" || i.type === "meal") return [b.day, b.startTime ? `${b.startTime}${b.endTime ? `–${b.endTime}` : ""}` : "time TBA", b.venue].filter(Boolean).join(" · ");
  if (i.type === "emergency_contact") return b.phone;
  if (i.type === "venue") return b.address ?? "";
  return (b.text ?? "").slice(0, 120);
};

function Content() {
  const email = useSessionEmail();
  const router = useRouter();
  const params = useSearchParams();
  const year = Number(params.get("edition") ?? 2026);
  const tab = (params.get("tab") ?? "schedule_item") as Tab;
  const [o, setO] = useState<ContentOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [action, setAction] = useState<{ id: string; kind: "publish" | "archive"; text: string } | null>(null);
  const [history, setHistory] = useState<{ id: string; versions: ContentVersion[] } | null>(null);
  const [upload, setUpload] = useState<{ title: string; description: string; audience: ContentAudience[]; file: File | null; replacesId: string | null } | null>(null);

  const load = useCallback(async () => {
    try { setO(await api.manage.content(year)); setError(null); }
    catch (e) {
      setError(e instanceof ApiError && e.code === "mfa_required" ? "mfa_required"
        : e instanceof ApiError && e.status === 403 ? "Your account cannot manage event information." : (e as Error).message);
    }
  }, [year]);
  useEffect(() => { if (email) void load(); }, [email, load]);

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
  if (!email) return <p>Please <Link href="/signin?next=/content">sign in</Link>.</p>;
  const go = (q: Record<string, string>) => router.push(`/content?${new URLSearchParams({ edition: String(year), tab, ...q })}`);
  const canEdit = (t: Tab) => !!o && (t === "documents" || ["safety_guideline", "emergency_contact", "page"].includes(t) ? o.canEditSource : o.canEditOperational);
  const items = o?.items.filter((i) => i.type === tab) ?? [];
  const field = (k: string, label: string, props: Record<string, unknown> = {}) => (
    <label>{label}
      <input value={form!.f[k] ?? ""} onChange={(e) => setForm({ ...form!, f: { ...form!.f, [k]: e.target.value } })} {...props} />
      {errors[`body.${k}`] && <span className="field-error">{errors[`body.${k}`]}</span>}
    </label>
  );
  const area = (k: string, label: string, rows = 4) => (
    <label>{label}
      <textarea rows={rows} value={form!.f[k] ?? ""} onChange={(e) => setForm({ ...form!, f: { ...form!.f, [k]: e.target.value } })} />
      {errors[`body.${k}`] && <span className="field-error">{errors[`body.${k}`]}</span>}
    </label>
  );
  const daySelect = () => (
    <label>Day
      <select value={form!.f.day ?? ""} onChange={(e) => setForm({ ...form!, f: { ...form!.f, day: e.target.value } })}>
        <option value="">Choose…</option>
        {o!.days.map((d) => <option key={d.date} value={d.date}>{d.label}</option>)}
      </select>
      {errors["body.day"] && <span className="field-error">{errors["body.day"]}</span>}
    </label>
  );
  const audiencePicker = (value: ContentAudience[], set: (a: ContentAudience[]) => void) => (
    <fieldset>
      <legend>Who can see it</legend>
      <div className="choices-inline">
        {CONTENT_AUDIENCES.map((a) => (
          <label key={a} className="check"><input type="checkbox" checked={value.includes(a)} onChange={(e) => set(toggleAudience(value, a, e.target.checked))} />
            {AUDIENCE_LABEL[a]}</label>
        ))}
      </div>
      {errors.audience && <span className="field-error">{errors.audience}</span>}
    </fieldset>
  );

  async function save() {
    if (!form) return;
    const body = { title: form.title.trim(), audience: form.audience, body: toBody(form) };
    const ok = await act(() => form.id ? api.manage.updateContent(form.id, body) : api.manage.createContent(year, { type: form.type, ...body }),
      "Saved as a draft. Publish it to show it on the website and in the app.");
    if (ok) setForm(null);
  }

  async function doUpload() {
    if (!upload?.file) return;
    if (upload.file.size > MAX_DOCUMENT_BYTES) { setErrors({ file: "The file is larger than 10 MB" }); return; }
    const dataBase64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
      r.onerror = () => reject(new Error("Could not read the file"));
      r.readAsDataURL(upload.file!);
    });
    const ok = await act(() => api.manage.uploadDocument(year, {
      title: upload.title.trim(), description: upload.description.trim() || undefined, audience: upload.audience, fileName: upload.file!.name,
      contentType: upload.file!.type as keyof typeof DOCUMENT_TYPES, dataBase64, ...(upload.replacesId ? { replacesId: upload.replacesId } : {}),
    }), upload.replacesId ? "New version uploaded. The old one is kept in the history." : "Document uploaded.");
    if (ok) setUpload(null);
  }

  return (
    <>
      <h1>Event information</h1>
      <p className="muted">
        One official copy for the website and the app: a change appears everywhere as soon as it is published, with no app release.
        Edits stay drafts until you publish them. The Admin maintains documents, emergency contacts, safety guidelines and information pages;
        Management maintains the schedule, venues, food, accommodation and travel (TBD-24).
      </p>
      <div className="tabs" role="tablist" aria-label="Edition">
        {YEARS.map((y) => <button key={y} className="tab" aria-current={y === year} onClick={() => router.push(`/content?edition=${y}&tab=${tab}`)}>{y}</button>)}
      </div>
      <div className="tabs" role="tablist" aria-label="Information type" style={{ flexWrap: "wrap" }}>
        {[...CONTENT_TYPES, "documents" as const].map((t) => (
          <button key={t} className="tab" aria-current={t === tab} onClick={() => { setForm(null); setUpload(null); go({ tab: t }); }}>
            {t === "documents" ? "Documents" : CONTENT_TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      {error === "mfa_required" ? <MfaPrompt next="/content" /> : error && <p className="notice notice-error" role="alert">{error}</p>}
      {message && <p className="notice notice-ok" role="status">{message}</p>}
      {o && tab !== "documents" && !canEdit(tab) && <p className="muted small">This information is maintained by {o.canEditSource ? "Management" : "the Admin"}. You can view it here.</p>}
      {tab === "emergency_contact" && <p className="muted small">The national emergency number 112 is always shown first on the website and in the app; it does not need an entry here.</p>}

      {o && tab !== "documents" && (
        <>
          {canEdit(tab) && !form && <div className="actions"><button className="btn btn-primary" onClick={() => { setErrors({}); setForm(blank(tab)); }}>Add {CONTENT_TYPE_LABEL[tab].toLowerCase()} item</button></div>}
          {form && (
            <section className="card" style={{ marginTop: 16 }} aria-label="Edit item">
              <h3>{form.id ? "Edit (saved as a draft)" : `New ${CONTENT_TYPE_LABEL[form.type].toLowerCase()} item`}</h3>
              <label>Title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                {errors.title && <span className="field-error">{errors.title}</span>}</label>
              {form.type === "schedule_item" && (<>
                <div className="two">{daySelect()}{field("startTime", "Start (HH:MM, IST)", { placeholder: "09:30" })}{field("endTime", "End (HH:MM, IST)", { placeholder: "11:00" })}</div>
                <div className="two">{field("venue", "Venue")}{field("order", "Order within the day", { inputMode: "numeric" })}</div>
                {area("details", "Details")}
                <label className="check"><input type="checkbox" checked={form.tentative} onChange={(e) => setForm({ ...form, tentative: e.target.checked })} /> Show as tentative</label>
              </>)}
              {form.type === "meal" && (<>
                <div className="two">{daySelect()}
                  <label>Meal<select value={form.f.meal ?? "lunch"} onChange={(e) => setForm({ ...form, f: { ...form.f, meal: e.target.value } })}>
                    {["breakfast", "lunch", "dinner", "snacks", "other"].map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
                  {field("startTime", "Start (HH:MM)")}{field("endTime", "End (HH:MM)")}</div>
                {field("venue", "Venue")}{area("menu", "Menu, one dish per line", 5)}{area("notes", "Notes", 2)}
              </>)}
              {form.type === "venue" && (<>{field("address", "Address or location")}{field("mapUrl", "Map link (https://, optional)")}{area("notes", "Notes")}</>)}
              {form.type === "emergency_contact" && (<div className="two">{field("phone", "Phone number")}{field("available", "When it is available")}{field("notes", "Notes")}</div>)}
              {["accommodation", "travel", "safety_guideline", "page"].includes(form.type) && (<>{area("text", "Information", 8)}{field("address", "Address (optional)")}</>)}
              {audiencePicker(form.audience, (a) => setForm({ ...form, audience: a }))}
              <div className="actions">
                <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>Save draft</button>
                <button className="btn" onClick={() => setForm(null)}>Cancel</button>
              </div>
            </section>
          )}
          <div className="list" style={{ marginTop: 16 }}>
            {items.length === 0 && <p className="muted">Nothing here yet.</p>}
            {items.map((i) => (
              <section className="card" key={i.id} aria-label={(i.draft ?? i.live)!.title}>
                <div className="row">
                  <h3 style={{ margin: 0 }}>{(i.live ?? i.draft)!.title}{" "}
                    {i.state === "published" && <span className="badge badge-selected">Published v{i.version}</span>}
                    {i.state === "draft" && <span className="badge">Draft, never published</span>}
                    {i.state === "archived" && <span className="badge">Archived</span>}
                    {i.state === "published" && i.draft && <span className="badge badge-under_review">Unpublished changes</span>}
                  </h3>
                  {i.canEdit && (
                    <span className="actions" style={{ marginTop: 0 }}>
                      <button className="btn btn-sm" onClick={() => { setErrors({}); setForm(toForm(i)); }}>Edit</button>
                      {i.draft && <button className="btn btn-sm btn-primary" onClick={() => setAction({ id: i.id, kind: "publish", text: "" })}>Publish</button>}
                      {i.draft && i.version > 0 && <button className="btn btn-sm" disabled={busy} onClick={() => void act(() => api.manage.discardDraft(i.id), "Draft discarded.")}>Discard changes</button>}
                      <button className="btn btn-sm" onClick={() => setAction({ id: i.id, kind: "archive", text: "" })}>Archive</button>
                    </span>
                  )}
                </div>
                <p className="small">{summary(i)}</p>
                <p className="muted small">
                  {AUDIENCE_LABEL[((i.draft ?? i.live)!.audience[0]) as ContentAudience]}{(i.draft ?? i.live)!.audience.length > 1 ? ` + ${(i.draft ?? i.live)!.audience.slice(1).map((a) => AUDIENCE_LABEL[a as ContentAudience]).join(", ")}` : ""}
                  {i.publishedAt && ` · Published ${formatIst(i.publishedAt)} IST`}{i.changeSummary && ` · “${i.changeSummary}”`}
                  {i.draft && i.draftAt && ` · Draft saved ${formatIst(i.draftAt)} IST by ${i.draftBy}`}
                  {i.version > 0 && <> · <button className="link" onClick={async () => setHistory(history?.id === i.id ? null : { id: i.id, versions: await api.manage.contentVersions(i.id) })}>History</button></>}
                </p>
                {action?.id === i.id && (
                  <div className="actions" style={{ marginTop: 0 }}>
                    <input aria-label={action.kind === "publish" ? "What changed" : "Reason for archiving"} placeholder={action.kind === "publish" ? "What changed (shown in the history)" : "Reason for archiving"}
                      value={action.text} onChange={(e) => setAction({ ...action, text: e.target.value })} style={{ flex: 1 }} />
                    <button className="btn btn-sm btn-primary" disabled={busy || !action.text.trim()} onClick={() => void act(async () => {
                      if (action.kind === "publish") await api.manage.publishContent(i.id, action.text.trim()); else await api.manage.archiveContent(i.id, action.text.trim());
                      setAction(null);
                    }, action.kind === "publish" ? "Published. The website and the app show it now." : "Archived. It no longer appears anywhere.")}>
                      {action.kind === "publish" ? "Confirm publish" : "Confirm archive"}</button>
                    <button className="btn btn-sm" onClick={() => setAction(null)}>Cancel</button>
                  </div>
                )}
                {history?.id === i.id && (
                  <div className="table-wrap"><table aria-label="Version history"><thead><tr><th>Version</th><th>Published (IST)</th><th>By</th><th>What changed</th></tr></thead>
                    <tbody>{history.versions.map((v) => <tr key={v.version}><td>v{v.version}</td><td>{formatIst(v.publishedAt)}</td><td>{v.publishedBy}</td><td>{v.changeSummary}</td></tr>)}</tbody></table></div>
                )}
              </section>
            ))}
          </div>
        </>
      )}

      {o && tab === "documents" && (
        <>
          {o.canEditSource && !upload && <div className="actions"><button className="btn btn-primary" onClick={() => { setErrors({}); setUpload({ title: "", description: "", audience: ["participants"], file: null, replacesId: null }); }}>Upload a document</button></div>}
          {upload && (
            <section className="card" style={{ marginTop: 16 }} aria-label="Upload document">
              <h3>{upload.replacesId ? "Upload a new version" : "Upload a document"}</h3>
              <label>Title<input value={upload.title} onChange={(e) => setUpload({ ...upload, title: e.target.value })} />{errors.title && <span className="field-error">{errors.title}</span>}</label>
              <label>Description (optional)<input value={upload.description} onChange={(e) => setUpload({ ...upload, description: e.target.value })} /></label>
              <label>File (PDF, PNG or JPEG, up to 10 MB)<input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] ?? null })} />
                {errors.file && <span className="field-error">{errors.file}</span>}</label>
              {audiencePicker(upload.audience, (a) => setUpload({ ...upload, audience: a }))}
              <div className="actions">
                <button className="btn btn-primary" disabled={busy || !upload.file || !upload.title.trim()} onClick={() => void doUpload()}>Upload</button>
                <button className="btn" onClick={() => setUpload(null)}>Cancel</button>
              </div>
            </section>
          )}
          <div className="table-wrap" style={{ marginTop: 16 }}>
            <table aria-label="Documents">
              <thead><tr><th>Document</th><th>Who can see it</th><th>Version</th><th>Uploaded (IST)</th><th></th></tr></thead>
              <tbody>
                {o.documents.length === 0 && <tr><td colSpan={5} className="muted">No documents yet.</td></tr>}
                {o.documents.map((d) => (
                  <tr key={d.id} style={d.archivedAt ? { opacity: 0.6 } : undefined}>
                    <td><strong>{d.title}</strong><div className="muted small">{d.fileName} · {(d.sizeBytes / 1024).toFixed(0)} KB{d.archivedAt && " · archived or replaced"}</div></td>
                    <td className="small">{d.audience.map((a) => AUDIENCE_LABEL[a]).join(", ")}</td>
                    <td>v{d.version}</td>
                    <td>{formatIst(d.uploadedAt)}<div className="muted small">by {d.uploadedBy}</div></td>
                    <td className="actions" style={{ marginTop: 0 }}>
                      <button className="btn btn-sm" onClick={async () => { try { window.open(api.absoluteUrl((await api.manage.documentLink(d.id)).url), "_blank", "noopener"); } catch (e) { setError((e as Error).message); } }}>Open</button>
                      {d.canEdit && <button className="btn btn-sm" onClick={() => { setErrors({}); setUpload({ title: d.title, description: d.description ?? "", audience: d.audience, file: null, replacesId: d.id }); }}>New version</button>}
                      {d.canEdit && <button className="btn btn-sm" disabled={busy} onClick={() => {
                        const reason = window.prompt(`Why archive "${d.title}"?`);
                        if (reason?.trim()) void act(() => api.manage.archiveDocument(d.id, reason.trim()), "Document archived.");
                      }}>Archive</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

export default function ContentPage() {
  return <Suspense fallback={null}><Content /></Suspense>;
}
