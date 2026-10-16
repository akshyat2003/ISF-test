// Event information and documents (PRD §10, FR-EVT-*; decisions TBD-06, TBD-24, TBD-51 in docs/DECISIONS.md).
// One official copy, served to the website and the app (FR-EVT-01/02): a change never needs an app release.
// Every edit is a draft until published; each publish is a new version with editor, time and change summary
// (FR-EVT-16); content and documents carry an audience that decides who sees them (FR-EVT-17).
// TBD-24: the Admin maintains source information (documents, emergency contacts, safety guidelines, pages);
// Management maintains operational information (schedule, venues, food, accommodation, travel).
import { createHash, randomUUID } from "node:crypto";
import {
  contentBodySchema, eventDays, MAX_DOCUMENT_BYTES, NATIONAL_EMERGENCY, OPERATIONAL_CONTENT_TYPES, PARTICIPANT_ROLES, SOURCE_CONTENT_TYPES,
  type ContentAudience, type ContentCreate, type ContentOverview, type ContentType, type ContentUpdate, type ContentVersion,
  type DocumentLink, type DocumentUpload, type EventDocument, type EventInfo, type ManagedContentItem, type ManagedDocument,
} from "@sj/contracts";
import type { Db, Sql } from "../../db/client.js";
import { audit } from "../../platform/audit.js";
import { AppError, forbidden, notFound } from "../../platform/errors.js";
import { permissionsOf, type Principal } from "../../platform/principal.js";
import { getEdition, type EditionRow } from "../editions/service.js";
import { sniffMatches, type FileStore } from "./storage.js";

// ---------------------------------------------------------------- who may edit what (TBD-24)
const isSource = (t: ContentType) => SOURCE_CONTENT_TYPES.includes(t);
export function canEditType(p: Principal, type: ContentType | "document"): boolean {
  const perms = permissionsOf(p);
  return type === "document" || isSource(type) ? perms.has("content.manage_source") : perms.has("content.manage_operational");
}
function assertCanEdit(p: Principal, type: ContentType | "document") {
  if (!canEditType(p, type)) {
    const owner = type === "document" || isSource(type as ContentType) ? "the Admin" : "Management";
    throw forbidden(`This information is maintained by ${owner} (TBD-24).`, "content_not_yours");
  }
}

/** Validates a body for its type, with field paths prefixed "body." so screens can show them by the field. */
function checkBody(type: ContentType, body: unknown, e: EditionRow): Record<string, unknown> {
  const r = contentBodySchema(type).safeParse(body);
  if (!r.success) {
    throw new AppError(400, "validation_failed", "Some fields are invalid", undefined, {
      errors: r.error.issues.map((i) => ({ path: ["body", ...i.path].join("."), message: i.message })),
    });
  }
  const day = (r.data as { day?: string }).day;
  if (day) {
    const days = eventDays(e);
    if (days.length && !days.some((d) => d.date === day)) {
      throw new AppError(400, "validation_failed", "Some fields are invalid", undefined, {
        errors: [{ path: "body.day", message: `Choose one of the event days: ${days.map((d) => d.label).join("; ")}` }],
      });
    }
  }
  return r.data;
}

// ---------------------------------------------------------------- reading (console)
type ItemRow = {
  id: string; edition: number; type: ContentType; state: "draft" | "published" | "archived"; version: number; title: string;
  body: Record<string, unknown>; audience: ContentAudience[]; publishedAt: Date | null; changeSummary: string | null;
  draft: { title: string; body: Record<string, unknown>; audience: ContentAudience[] } | null; draftBy: string | null; draftAt: Date | null;
  archivedAt: Date | null;
};
const ITEM_SELECT = (db: Db) => db`
  select c.id, c.edition_id as edition, c.type, c.state, c.version, c.title, c.body, c.audience, c.published_at as "publishedAt",
         c.change_summary as "changeSummary", c.draft, du.full_name as "draftBy", c.draft_at as "draftAt", c.archived_at as "archivedAt"
  from content_items c left join user_accounts du on du.id = c.draft_by`;

function toManaged(r: ItemRow, p: Principal): ManagedContentItem {
  return {
    id: r.id, edition: r.edition, type: r.type, state: r.state, version: r.version,
    live: r.version > 0 ? { title: r.title, body: r.body, audience: r.audience } : null,
    publishedAt: r.publishedAt?.toISOString() ?? null, changeSummary: r.changeSummary,
    draft: r.draft, draftBy: r.draftBy, draftAt: r.draftAt?.toISOString() ?? null, archivedAt: r.archivedAt?.toISOString() ?? null,
    canEdit: r.state !== "archived" && canEditType(p, r.type),
  };
}

type DocRow = {
  id: string; edition: number; title: string; description: string | null; fileName: string; contentType: string; sizeBytes: number;
  version: number; uploadedAt: Date; audience: ContentAudience[]; uploadedBy: string | null; replacesId: string | null; archivedAt: Date | null;
  storageKey: string;
};
const DOC_SELECT = (db: Db) => db`
  select d.id, d.edition_id as edition, d.title, d.description, d.file_name as "fileName", d.content_type as "contentType",
         d.size_bytes as "sizeBytes", d.version, d.uploaded_at as "uploadedAt", d.audience, u.full_name as "uploadedBy",
         d.replaces_id as "replacesId", d.archived_at as "archivedAt", d.storage_key as "storageKey"
  from documents d left join user_accounts u on u.id = d.uploaded_by`;
const toEventDoc = (d: DocRow): EventDocument => ({
  id: d.id, title: d.title, description: d.description, fileName: d.fileName, contentType: d.contentType, sizeBytes: d.sizeBytes,
  version: d.version, uploadedAt: d.uploadedAt.toISOString(),
});

export async function contentOverview(db: Db, p: Principal, year: number): Promise<ContentOverview> {
  const e = await getEdition(db, year);
  const items = await db<ItemRow[]>`${ITEM_SELECT(db)} where c.edition_id = ${year}
    order by c.type, c.body->>'day' nulls last, coalesce(c.draft->'body'->>'day', '') , c.body->>'startTime' nulls last, (c.body->>'order')::int nulls last, c.title`;
  const docs = await db<DocRow[]>`${DOC_SELECT(db)} where d.edition_id = ${year} order by d.archived_at nulls first, d.title, d.version desc`;
  return {
    edition: year, days: eventDays(e), items: items.map((r) => toManaged(r, p)),
    documents: docs.map((d) => ({ ...toEventDoc(d), edition: d.edition, audience: d.audience, uploadedBy: d.uploadedBy,
      replacesId: d.replacesId, archivedAt: d.archivedAt?.toISOString() ?? null, canEdit: !d.archivedAt && canEditType(p, "document") })),
    canEditSource: canEditType(p, "document"), canEditOperational: canEditType(p, "schedule_item"),
  };
}

async function lockItem(tx: Db, id: string): Promise<ItemRow> {
  const [r] = await tx<ItemRow[]>`${ITEM_SELECT(tx)} where c.id = ${id} for update of c`;
  if (!r) throw notFound("Content item");
  return r;
}
async function getManaged(db: Db, p: Principal, id: string) {
  const [r] = await db<ItemRow[]>`${ITEM_SELECT(db)} where c.id = ${id}`;
  if (!r) throw notFound("Content item");
  return toManaged(r, p);
}

// ---------------------------------------------------------------- editing (drafts, publish, archive)
export async function createContent(sql: Sql, p: Principal, year: number, input: ContentCreate): Promise<ManagedContentItem> {
  assertCanEdit(p, input.type);
  const e = await getEdition(sql, year);
  const body = checkBody(input.type, input.body, e);
  const draft = { title: input.title, body, audience: input.audience };
  const id = await sql.begin(async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into content_items (edition_id, type, audience, title, body, draft, draft_by, draft_at, version, state, created_by, updated_by)
      values (${year}, ${input.type}, ${input.audience}, ${input.title}, ${tx.json(body as never)}, ${tx.json(draft as never)},
              ${p.account!.id}, now(), 0, 'draft', ${p.account!.id}, ${p.account!.id})
      returning id`;
    await audit(tx, { actorUserId: p.account!.id, action: "content.created", entityType: "content_item", entityId: row!.id, editionId: year,
      data: { type: input.type, draft } });
    return row!.id;
  });
  return getManaged(sql, p, id);
}

/** Saves pending edits. Users keep seeing the published version until the draft is published. */
export async function updateContent(sql: Sql, p: Principal, id: string, input: ContentUpdate): Promise<ManagedContentItem> {
  await sql.begin(async (tx) => {
    const r = await lockItem(tx, id);
    assertCanEdit(p, r.type);
    if (r.state === "archived") throw new AppError(409, "content_archived", "Archived", "Archived information cannot be edited.");
    const e = await getEdition(tx, r.edition);
    const draft = { title: input.title, body: checkBody(r.type, input.body, e), audience: input.audience };
    await tx`update content_items set draft = ${tx.json(draft as never)}, draft_by = ${p.account!.id}, draft_at = now(),
             updated_by = ${p.account!.id}, updated_at = now() where id = ${id}`;
    await audit(tx, { actorUserId: p.account!.id, action: "content.draft_saved", entityType: "content_item", entityId: id, editionId: r.edition,
      data: { type: r.type, draft } });
  });
  return getManaged(sql, p, id);
}

export async function publishContent(sql: Sql, p: Principal, id: string, changeSummary: string): Promise<ManagedContentItem> {
  await sql.begin(async (tx) => {
    const r = await lockItem(tx, id);
    assertCanEdit(p, r.type);
    if (r.state === "archived") throw new AppError(409, "content_archived", "Archived", "Archived information cannot be published.");
    if (!r.draft) throw new AppError(409, "nothing_to_publish", "Nothing to publish", "There are no pending changes.");
    const e = await getEdition(tx, r.edition);
    const body = checkBody(r.type, r.draft.body, e);   // event days may have changed since the draft was saved
    const version = r.version + 1;
    await tx`
      update content_items set title = ${r.draft.title}, body = ${tx.json(body as never)}, audience = ${r.draft.audience},
        version = ${version}, state = 'published', published_at = now(), change_summary = ${changeSummary},
        draft = null, draft_by = null, draft_at = null, updated_by = ${p.account!.id}, updated_at = now()
      where id = ${id}`;
    await tx`
      insert into content_versions (item_id, version, title, body, audience, change_summary, published_by)
      values (${id}, ${version}, ${r.draft.title}, ${tx.json(body as never)}, ${r.draft.audience}, ${changeSummary}, ${p.account!.id})`;
    await audit(tx, { actorUserId: p.account!.id, action: "content.published", entityType: "content_item", entityId: id, editionId: r.edition,
      data: { type: r.type, version, changeSummary, previous: r.version > 0 ? { title: r.title, body: r.body, audience: r.audience } : null } });
  });
  return getManaged(sql, p, id);
}

export async function discardDraft(sql: Sql, p: Principal, id: string): Promise<ManagedContentItem> {
  await sql.begin(async (tx) => {
    const r = await lockItem(tx, id);
    assertCanEdit(p, r.type);
    if (r.version === 0) throw new AppError(409, "never_published", "Never published", "This item has never been published: archive it instead.");
    if (!r.draft) throw new AppError(409, "nothing_to_discard", "Nothing to discard", "There are no pending changes.");
    await tx`update content_items set draft = null, draft_by = null, draft_at = null, updated_at = now() where id = ${id}`;
    await audit(tx, { actorUserId: p.account!.id, action: "content.draft_discarded", entityType: "content_item", entityId: id, editionId: r.edition,
      data: { discarded: r.draft } });
  });
  return getManaged(sql, p, id);
}

/** Removes an item from every screen. It is kept, with all its versions (never deleted). */
export async function archiveContent(sql: Sql, p: Principal, id: string, reason: string): Promise<ManagedContentItem> {
  await sql.begin(async (tx) => {
    const r = await lockItem(tx, id);
    assertCanEdit(p, r.type);
    if (r.state === "archived") throw new AppError(409, "content_archived", "Already archived", "This item is already archived.");
    await tx`update content_items set state = 'archived', archived_at = now(), archived_by = ${p.account!.id}, updated_at = now() where id = ${id}`;
    await audit(tx, { actorUserId: p.account!.id, action: "content.archived", entityType: "content_item", entityId: id, editionId: r.edition,
      data: { type: r.type, reason, version: r.version } });
  });
  return getManaged(sql, p, id);
}

export async function contentVersions(db: Db, id: string): Promise<ContentVersion[]> {
  const [exists] = await db`select 1 from content_items where id = ${id}`;
  if (!exists) throw notFound("Content item");
  const rows = await db<(Omit<ContentVersion, "publishedAt"> & { publishedAt: Date })[]>`
    select v.version, v.title, v.body, v.audience, v.change_summary as "changeSummary", u.full_name as "publishedBy", v.published_at as "publishedAt"
    from content_versions v left join user_accounts u on u.id = v.published_by where v.item_id = ${id} order by v.version desc`;
  return rows.map((r) => ({ ...r, publishedAt: r.publishedAt.toISOString() }));
}

// ---------------------------------------------------------------- who sees what (FR-EVT-17, FR-NOT-05)
export type Viewer = { kind: "public" } | { kind: "participant"; userId: string };

/** The audience tags this viewer matches in an edition: public, plus "participants" and their roles for that edition. */
export async function viewerTags(db: Db, v: Viewer, year: number): Promise<ContentAudience[]> {
  if (v.kind === "public") return ["public"];
  const roles = await db<{ role: ContentAudience }[]>`
    select distinct g.role from role_grants g join edition_access a on a.user_id = g.user_id and a.edition_id = ${year} and a.revoked_at is null
    join user_accounts u on u.id = g.user_id and u.status <> 'deactivated'
    where g.user_id = ${v.userId} and g.revoked_at is null and (g.edition_id is null or g.edition_id = ${year})
      and g.role in ${db(PARTICIPANT_ROLES as unknown as string[])}`;
  const [access] = await db`select 1 from edition_access where user_id = ${v.userId} and edition_id = ${year} and revoked_at is null`;
  return access ? ["public", "participants", ...roles.map((r) => r.role)] : ["public"];
}

/** Published information for one edition, filtered to what the viewer may see. The same data feeds web and app. */
export async function eventInfo(db: Db, v: Viewer, year: number): Promise<EventInfo> {
  const e = await getEdition(db, year);
  const tags = await viewerTags(db, v, year);
  const items = await db<ItemRow[]>`${ITEM_SELECT(db)} where c.edition_id = ${year} and c.state = 'published' and c.audience && ${tags}
    order by c.body->>'day' nulls last, c.body->>'startTime' nulls first, (c.body->>'order')::int nulls last, c.title`;
  const docs = await db<DocRow[]>`${DOC_SELECT(db)} where d.edition_id = ${year} and d.archived_at is null and d.audience && ${tags} order by d.title`;
  const pub = (r: ItemRow) => ({ id: r.id, title: r.title, version: r.version, updatedAt: r.publishedAt!.toISOString(), body: r.body as never });
  const of = (t: ContentType) => items.filter((r) => r.type === t).map(pub);
  const days = eventDays(e);
  const dated = [...new Set([...days.map((d) => d.date), ...items.map((r) => (r.body as { day?: string }).day).filter(Boolean) as string[]])].sort();
  const schedule = dated.map((date) => {
    const known = days.find((d) => d.date === date);
    return {
      date, label: known?.label ?? date, preEvent: known?.preEvent ?? false,
      items: items.filter((r) => r.type === "schedule_item" && (r.body as { day: string }).day === date).map(pub),
      meals: items.filter((r) => r.type === "meal" && (r.body as { day: string }).day === date).map(pub),
    };
  }).filter((d) => d.items.length || d.meals.length || days.some((x) => x.date === d.date));
  const stamps = [...items.map((r) => r.publishedAt!.getTime()), ...docs.map((d) => d.uploadedAt.getTime())];
  return {
    edition: { year: e.id, name: e.name, days },
    schedule, venues: of("venue"), accommodation: of("accommodation"), travel: of("travel"), safety: of("safety_guideline"),
    emergency: [
      { id: null, title: NATIONAL_EMERGENCY.title, phone: NATIONAL_EMERGENCY.phone },   // always first (TBD-07)
      ...items.filter((r) => r.type === "emergency_contact").map((r) => {
        const b = r.body as { phone: string; available?: string | null; notes?: string | null };
        return { id: r.id, title: r.title, phone: b.phone, available: b.available ?? null, notes: b.notes ?? null };
      }),
    ],
    pages: of("page"), documents: docs.map(toEventDoc),
    lastUpdated: stamps.length ? new Date(Math.max(...stamps)).toISOString() : null,
  };
}

// ---------------------------------------------------------------- documents (TBD-51)
export async function uploadDocument(sql: Sql, p: Principal, year: number, input: DocumentUpload, store: FileStore): Promise<ManagedDocument> {
  assertCanEdit(p, "document");
  await getEdition(sql, year);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.dataBase64)) {
    throw new AppError(400, "validation_failed", "Some fields are invalid", undefined, { errors: [{ path: "dataBase64", message: "Not valid base64" }] });
  }
  const bytes = Buffer.from(input.dataBase64, "base64");
  const fileErr = (message: string) => new AppError(400, "validation_failed", "Some fields are invalid", undefined, { errors: [{ path: "file", message }] });
  if (bytes.length === 0) throw fileErr("The file is empty");
  if (bytes.length > MAX_DOCUMENT_BYTES) throw fileErr("The file is larger than 10 MB");
  if (!sniffMatches(input.contentType, bytes)) throw fileErr("The file's content does not match its type (PDF, PNG or JPEG only)");
  const safeName = input.fileName.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/\s+/g, " ").slice(0, 120) || "file";
  const key = `${year}/${randomUUID()}/${safeName.replace(/ /g, "_")}`;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  // Remote storage first (outside the transaction); the row is only written once the file is stored.
  if (store.name !== "database") await store.put(sql, key, bytes, input.contentType);
  const id = await sql.begin(async (tx) => {
    let version = 1;
    if (input.replacesId) {
      const [old] = await tx<{ edition: number; version: number; archivedAt: Date | null }[]>`
        select edition_id as edition, version, archived_at as "archivedAt" from documents where id = ${input.replacesId} for update`;
      if (!old || old.edition !== year) throw notFound("Document to replace");
      if (old.archivedAt) throw new AppError(409, "document_archived", "Already replaced or archived", "Replace the current version of this document.");
      version = old.version + 1;
      await tx`update documents set archived_at = now(), archived_by = ${p.account!.id} where id = ${input.replacesId}`;
    }
    if (store.name === "database") await store.put(tx, key, bytes, input.contentType);
    const [row] = await tx<{ id: string }[]>`
      insert into documents (edition_id, title, description, storage_key, audience, version, uploaded_by, file_name, content_type, size_bytes, sha256, replaces_id)
      values (${year}, ${input.title}, ${input.description ?? null}, ${key}, ${input.audience}, ${version}, ${p.account!.id}, ${safeName},
              ${input.contentType}, ${bytes.length}, ${sha256}, ${input.replacesId ?? null})
      returning id`;
    await audit(tx, { actorUserId: p.account!.id, action: input.replacesId ? "document.replaced" : "document.uploaded", entityType: "document",
      entityId: row!.id, editionId: year, data: { title: input.title, audience: input.audience, fileName: safeName, sizeBytes: bytes.length, sha256,
        replacesId: input.replacesId ?? null } });
    return row!.id;
  });
  const [d] = await sql<DocRow[]>`${DOC_SELECT(sql)} where d.id = ${id}`;
  return { ...toEventDoc(d!), edition: d!.edition, audience: d!.audience, uploadedBy: d!.uploadedBy, replacesId: d!.replacesId, archivedAt: null, canEdit: true };
}

export async function archiveDocument(sql: Sql, p: Principal, id: string, reason: string): Promise<void> {
  assertCanEdit(p, "document");
  await sql.begin(async (tx) => {
    const [d] = await tx<{ edition: number; archivedAt: Date | null }[]>`select edition_id as edition, archived_at as "archivedAt" from documents where id = ${id} for update`;
    if (!d) throw notFound("Document");
    if (d.archivedAt) throw new AppError(409, "document_archived", "Already archived", "This document is already archived or replaced.");
    await tx`update documents set archived_at = now(), archived_by = ${p.account!.id} where id = ${id}`;
    await audit(tx, { actorUserId: p.account!.id, action: "document.archived", entityType: "document", entityId: id, editionId: d.edition, data: { reason } });
  });
}

/**
 * A short-lived link to a document the viewer may see (SEC-08). A document outside the viewer's audience, archived or
 * from another edition is reported as missing, so its existence is not revealed. Staff (content.read_all) see all.
 */
export async function documentLink(db: Db, who: Viewer | { kind: "staff" }, year: number | null, id: string, store: FileStore, now: Date): Promise<DocumentLink> {
  const [d] = await db<DocRow[]>`${DOC_SELECT(db)} where d.id = ${id}`;
  if (!d) throw notFound("Document");
  if (who.kind !== "staff") {
    if (d.archivedAt || d.edition !== year) throw notFound("Document");
    const tags = await viewerTags(db, who, d.edition);
    if (!d.audience.some((a) => tags.includes(a))) throw notFound("Document");
  }
  return store.link({ id: d.id, key: d.storageKey, fileName: d.fileName }, now);
}
