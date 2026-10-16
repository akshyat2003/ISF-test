// Document file storage (TBD-51, SEC-08). Files live in a PRIVATE store and are only ever reached through a
// short-lived link that the API issues after checking the viewer's audience. Two adapters:
// - supabase: Supabase Storage private bucket; links are Supabase signed URLs (staging and production);
// - database: bytes in `document_blobs`, links signed by the API itself. Development and tests only: the launch
//   gate refuses it in production.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "../../db/client.js";

export const LINK_TTL_SECONDS = 60;

export interface FileStore {
  readonly name: "database" | "supabase";
  put(db: Db, key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** A link valid for LINK_TTL_SECONDS: absolute (Supabase) or an API path starting with "/" (database adapter). */
  link(doc: { id: string; key: string; fileName: string }, now: Date): Promise<{ url: string; expiresAt: string }>;
}

// ---------------------------------------------------------------- database adapter (development only)
/** Token = "<document id>.<expiry, unix seconds>.<HMAC-SHA256, first 128 bits, base64url>" (short enough for a path). */
export type FileToken = { id: string; exp: number };

export function databaseStore(secret = randomBytes(32).toString("hex")): FileStore & {
  verify(token: string, now: Date): FileToken | null;
  read(db: Db, id: string): Promise<{ bytes: Buffer; contentType: string; fileName: string } | null>;
} {
  const sign = (payload: string) => createHmac("sha256", secret).update(payload).digest().subarray(0, 16).toString("base64url");
  return {
    name: "database",
    async put(db, key, bytes) {
      await db`insert into document_blobs (storage_key, bytes) values (${key}, ${bytes})`;
    },
    async link(doc, now) {
      const exp = Math.floor(now.getTime() / 1000) + LINK_TTL_SECONDS;
      const payload = `${doc.id}.${exp}`;
      return { url: `/v1/files/${payload}.${sign(payload)}`, expiresAt: new Date(exp * 1000).toISOString() };
    },
    verify(token, now) {
      const m = /^([0-9a-f-]{36})\.(\d{10})\.([A-Za-z0-9_-]{22})$/.exec(token);
      if (!m) return null;
      const expected = Buffer.from(sign(`${m[1]}.${m[2]}`));
      const given = Buffer.from(m[3]!);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
      const exp = Number(m[2]);
      return exp >= Math.floor(now.getTime() / 1000) ? { id: m[1]!, exp } : null;
    },
    async read(db, id) {
      const [r] = await db<{ bytes: Buffer; contentType: string; fileName: string }[]>`
        select b.bytes, d.content_type as "contentType", d.file_name as "fileName"
        from documents d join document_blobs b on b.storage_key = d.storage_key where d.id = ${id}`;
      return r ?? null;
    },
  };
}

// ---------------------------------------------------------------- Supabase Storage (staging and production)
export type SupabaseStoreOptions = { url: string; serviceRoleKey: string; bucket: string; fetchImpl?: typeof fetch };

/**
 * Supabase Storage REST API with the server-side service-role key (never sent to clients). The bucket must be
 * PRIVATE (LAUNCH_CHECKLIST). Not yet verified against the live staging project.
 */
export function supabaseStore(o: SupabaseStoreOptions): FileStore {
  const f = o.fetchImpl ?? fetch;
  const base = o.url.replace(/\/$/, "");
  const headers = { authorization: `Bearer ${o.serviceRoleKey}`, apikey: o.serviceRoleKey };
  const path = (key: string) => `${encodeURIComponent(o.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
  return {
    name: "supabase",
    async put(_db, key, bytes, contentType) {
      const res = await f(`${base}/storage/v1/object/${path(key)}`, {
        method: "POST", headers: { ...headers, "content-type": contentType, "x-upsert": "false" }, body: new Uint8Array(bytes),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Supabase Storage upload failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    },
    async link(doc, now) {
      const { key, fileName } = doc;
      const res = await f(`${base}/storage/v1/object/sign/${path(key)}`, {
        method: "POST", headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ expiresIn: LINK_TTL_SECONDS, download: fileName }), signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Supabase Storage signing failed: HTTP ${res.status} ${text.slice(0, 200)}`);
      const j = JSON.parse(text) as { signedURL?: string; signedUrl?: string };
      const rel = j.signedURL ?? j.signedUrl;
      if (!rel) throw new Error("Supabase Storage returned no signed URL");
      return { url: rel.startsWith("http") ? rel : `${base}/storage/v1${rel}`, expiresAt: new Date(now.getTime() + LINK_TTL_SECONDS * 1000).toISOString() };
    },
  };
}

/** Checks a file's first bytes against its declared type, so a renamed executable is not stored as a "PDF". */
export function sniffMatches(contentType: string, bytes: Buffer): boolean {
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  switch (contentType) {
    case "application/pdf": return starts([0x25, 0x50, 0x44, 0x46, 0x2d]);                    // %PDF-
    case "image/png": return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg": return starts([0xff, 0xd8, 0xff]);
    default: return false;
  }
}
