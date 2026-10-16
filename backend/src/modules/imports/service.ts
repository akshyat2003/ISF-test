// Bulk import of predefined participants (PRD §5, FR-IMP-01…11): validate → preview → commit.
// CSV column set v1 (TBD-41, docs/DECISIONS.md), awaiting the organisers' sign-off on a real sample; see IMPORT_COLUMNS.
import { createHash } from "node:crypto";
import {
  IMPORT_COLUMNS,
  normaliseMobile,
  type ImportBatch,
  type ImportBatchDetail,
  type ImportCategory,
  type ImportIssue,
  type ImportPreviewRequest,
  type ImportRow,
  type Role,
} from "@sj/contracts";
import { z } from "zod";
import type { Db, Sql } from "../../db/client.js";
import { audit } from "../../platform/audit.js";
import { AppError, notFound } from "../../platform/errors.js";
import type { Principal } from "../../platform/principal.js";
import { parseCsv } from "./csv.js";

const MAX_ROWS = 5000;
const MAX_CELL = 5000;
/** Structural problems found while reading the file; kept with the row so they still apply at commit. */
const ROW_FIELD = "row";
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
/**
 * Text that a spreadsheet would run as a formula if these records are ever exported again (CSV injection):
 * = + - @, tab and carriage return, and their full-width forms. Checked on exportable free-text fields only;
 * mobile numbers (+91…) and emails are validated by their own rules. Exports also escape (platform/csv-export.ts).
 */
const FORMULA_START = /^[=+\-@\t\r\uFF1D\uFF0B\uFF0D\uFF20]/;
const FORMULA_CHECKED = ["full_name", "startup_name", "description", "website", "city", "state", "position"];

type RawRow = { rowNumber: number; data: Record<string, string>; issues?: { errors: ImportIssue[]; warnings: ImportIssue[] } };
/** FR-IMP-07: spreadsheets must never carry passwords. Any password-like column rejects the whole file. */
const PASSWORD_LIKE = /(pass(word)?|passwd|pwd|secret|\bpin\b|otp)/i;
const normName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const isEmail = (s: string) => z.string().email().max(254).safeParse(s).success;
const isUrl = (s: string) => z.string().url().max(300).safeParse(s).success;

type Outcome = "valid" | "invalid" | "duplicate";
type Analysed = {
  rowNumber: number;
  data: Record<string, string>;
  outcome: Outcome;
  action: "create" | "link" | null;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  /** Existing account to link (action = "link"). */
  userId: string | null;
  email: string | null;
  mobile: string | null;
  role: Role;
  startupKey: string | null;
};

function roleFor(category: ImportCategory, data: Record<string, string>): Role {
  switch (category) {
    case "startups": return data.position === "leader" ? "startup_team_leader" : "startup_team_member";
    case "jury": return "jury_member";
    case "volunteers": return "volunteer";
    case "delegates": return "delegate";
  }
}

/** File-level checks and row extraction. Problems with the file itself are a 422, not row errors. */
export function readFile(category: ImportCategory, csv: string): { rowNumber: number; data: Record<string, string> }[] {
  let table: string[][];
  try {
    table = parseCsv(csv);
  } catch (e) {
    throw new AppError(422, "import_unreadable", "File could not be read", `The CSV is malformed: ${(e as Error).message}.`);
  }
  const [header, ...body] = table;
  if (!header || header.every((h) => !h.trim())) throw new AppError(422, "import_no_header", "Missing header row", "The first row must contain column names.");
  const cols = header.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const passwordCols = cols.filter((c) => PASSWORD_LIKE.test(c));
  if (passwordCols.length) {
    throw new AppError(422, "import_password_column", "Passwords are not allowed in import files",
      `Remove the column(s) ${passwordCols.join(", ")}. Participants set their own sign-in through secure activation.`, { columns: passwordCols });
  }
  const spec = IMPORT_COLUMNS[category];
  const allowed = new Set([...spec.required, ...spec.optional]);
  const unknown = cols.filter((c) => c && !allowed.has(c));
  const missing = spec.required.filter((c) => !cols.includes(c));
  const dupCols = cols.filter((c, i) => c && cols.indexOf(c) !== i);
  if (unknown.length || missing.length || dupCols.length) {
    throw new AppError(422, "import_bad_columns", "Columns do not match the template",
      [missing.length && `Missing: ${missing.join(", ")}.`, unknown.length && `Not recognised: ${unknown.join(", ")}.`,
        dupCols.length && `Repeated: ${[...new Set(dupCols)].join(", ")}.`, `Allowed columns: ${[...allowed].join(", ")}.`]
        .filter(Boolean).join(" "), { missing, unknown, repeated: [...new Set(dupCols)] });
  }
  const rows = body
    .map((cells, i) => ({ rowNumber: i + 2, cells }))   // row 1 is the header, as the Admin sees it in a spreadsheet
    .filter(({ cells }) => cells.some((c) => c.trim() !== ""))
    .map(({ rowNumber, cells }): RawRow => {
      const errors: ImportIssue[] = [];
      const warnings: ImportIssue[] = [];
      // Values beyond the header shift data into the wrong columns: never import such a row.
      const extra = cells.slice(cols.length).filter((c) => c.trim() !== "");
      if (extra.length) {
        errors.push({ field: ROW_FIELD, reason: `Has ${cols.length + extra.length} values but the header has ${cols.length} columns. Check for unquoted commas.` });
      } else if (cells.length < cols.length) {
        warnings.push({ field: ROW_FIELD, reason: `Has ${cells.length} values but the header has ${cols.length} columns; the missing ones are treated as empty.` });
      }
      return {
        rowNumber,
        data: Object.fromEntries(cols.map((c, i) => [c, (cells[i] ?? "").trim()]).filter(([c]) => c)) as Record<string, string>,
        issues: { errors, warnings },
      };
    });
  if (!rows.length) throw new AppError(422, "import_empty", "No data rows", "The file has a header but no data rows.");
  if (rows.length > MAX_ROWS) throw new AppError(422, "import_too_large", "Too many rows", `Split the file: at most ${MAX_ROWS} rows per import.`);
  return rows;
}

/** Validates rows against each other and against the database. Pure read: nothing is written. */
export async function analyse(db: Db, category: ImportCategory, rows: RawRow[]): Promise<Analysed[]> {
  const out: Analysed[] = rows.map(({ rowNumber, data, issues }) => {
    const errors: ImportIssue[] = [...(issues?.errors ?? [])];
    const warnings: ImportIssue[] = [...(issues?.warnings ?? [])];
    // Malformed values (FR-IMP-02/04): unreadable encoding, control characters, oversized cells, formula prefixes.
    for (const [field, value] of Object.entries(data)) {
      if (value.includes("\uFFFD")) errors.push({ field, reason: "Contains characters that could not be read. Save the file as CSV UTF-8 and try again" });
      else if (CONTROL_CHARS.test(value)) errors.push({ field, reason: "Contains hidden control characters" });
      if (value.length > MAX_CELL) errors.push({ field, reason: `Longer than ${MAX_CELL} characters` });
      if (FORMULA_CHECKED.includes(field) && FORMULA_START.test(value)) {
        errors.push({ field, reason: "Starts with =, +, - or @, which spreadsheets treat as a formula. Remove that character" });
      }
    }
    const fullName = data.full_name ?? "";
    if (!fullName) errors.push({ field: "full_name", reason: "Required" });
    else if (fullName.length > 200) errors.push({ field: "full_name", reason: "Longer than 200 characters" });
    const email = data.email ? data.email.toLowerCase() : null;
    if (email && !isEmail(email)) errors.push({ field: "email", reason: "Not a valid email address" });
    let mobile: string | null = null;
    if (data.mobile) {
      mobile = normaliseMobile(data.mobile);
      if (!mobile) errors.push({ field: "mobile", reason: "Not a valid mobile number" });
    }
    if (!data.email && !data.mobile) errors.push({ field: "email", reason: "Provide an email or a mobile number: one is needed to sign in and activate" });
    let startupKey: string | null = null;
    if (category === "startups") {
      const name = data.startup_name ?? "";
      if (name.length < 2 || name.length > 200) errors.push({ field: "startup_name", reason: "Required, 2 to 200 characters" });
      else startupKey = normName(name);
      const position = (data.position ?? "").toLowerCase();
      if (position !== "leader" && position !== "member") errors.push({ field: "position", reason: "Must be leader or member" });
      data.position = position;
      if (data.website && !isUrl(data.website)) errors.push({ field: "website", reason: "Not a valid URL (include https://)" });
      if (data.description && data.description.length > 5000) errors.push({ field: "description", reason: "Longer than 5000 characters" });
    }
    return {
      rowNumber, data, outcome: errors.length ? "invalid" : "valid", action: null, errors, warnings,
      userId: null, email: email && isEmail(email) ? email : null, mobile, role: roleFor(category, data), startupKey,
    };
  });

  // ---- within the file (FR-IMP-03)
  const firstByEmail = new Map<string, Analysed>();
  const firstByMobile = new Map<string, Analysed>();
  for (const r of out) {
    if (r.email) {
      const first = firstByEmail.get(r.email);
      if (first) { r.outcome = "duplicate"; r.errors.push({ field: "email", reason: `Same email as row ${first.rowNumber}` }); }
      else firstByEmail.set(r.email, r);
    }
    if (r.mobile) {
      const first = firstByMobile.get(r.mobile);
      if (first && first.email !== r.email) r.warnings.push({ field: "mobile", reason: `Mobile number also used in row ${first.rowNumber} (shared number, FR-IMP-10)` });
      else if (!first) firstByMobile.set(r.mobile, r);
    }
  }

  // ---- against existing records
  const emails = [...firstByEmail.keys()];
  const mobiles = [...new Set(out.map((r) => r.mobile).filter((m): m is string => !!m))];
  const byEmail = new Map(
    (emails.length ? await db<{ id: string; email: string; status: string }[]>`
      select id, lower(email) as email, status from user_accounts where lower(email) in ${db(emails)}` : []).map((u) => [u.email, u]));
  const mobileOwners = mobiles.length ? await db<{ id: string; mobile: string; email: string | null }[]>`
    select id, mobile_e164 as mobile, lower(email) as email from user_accounts where mobile_e164 in ${db(mobiles)}` : [];

  for (const r of out) {
    if (r.outcome !== "valid") continue;
    const existing = r.email ? byEmail.get(r.email) : undefined;
    if (existing) {
      if (existing.status === "deactivated") {
        r.outcome = "invalid";
        r.errors.push({ field: "email", reason: "An existing account with this email is deactivated: reactivate it first or remove the row" });
        continue;
      }
      r.action = "link";
      r.userId = existing.id;
    } else {
      r.action = "create";
    }
    if (r.mobile) {
      const others = mobileOwners.filter((o) => o.mobile === r.mobile && o.id !== r.userId);
      if (others.length && !r.email) {
        // Linking by mobile alone is unsafe (shared numbers); creating would duplicate a person.
        r.outcome = "duplicate";
        r.action = null;
        r.errors.push({ field: "mobile", reason: "This mobile number belongs to an existing account. Add the person's email to link it, or resolve manually" });
      } else if (others.length) {
        r.warnings.push({ field: "mobile", reason: "Mobile number is also used by an existing account (shared number, FR-IMP-10)" });
      }
    }
  }

  if (category === "startups") await analyseStartups(db, out);
  return out;
}

async function analyseStartups(db: Db, out: Analysed[]) {
  const groups = new Map<string, Analysed[]>();
  for (const r of out) if (r.startupKey) groups.set(r.startupKey, [...(groups.get(r.startupKey) ?? []), r]);
  const keys = [...groups.keys()];
  const existing = keys.length ? await db<{ key: string; origin: string }[]>`
    select name_normalized as key, origin from startups where name_normalized in ${db(keys)}` : [];
  const linkIds = out.filter((r) => r.userId).map((r) => r.userId!);
  const memberships = linkIds.length ? await db<{ userId: string; position: string; name: string }[]>`
    select m.user_id as "userId", m.position, s.name from startup_memberships m join startups s on s.id = m.startup_id
    where m.user_id in ${db(linkIds)}` : [];

  for (const [key, rows] of groups) {
    if (existing.some((e) => e.key === key && e.origin === "predefined")) {
      for (const r of rows) if (r.outcome === "valid") {
        r.outcome = "duplicate"; r.action = null;
        r.errors.push({ field: "startup_name", reason: "This startup was already imported" });
      }
      continue;
    }
    if (existing.some((e) => e.key === key && e.origin === "applicant")) {
      for (const r of rows) r.warnings.push({ field: "startup_name", reason: "A newly registered (applicant) startup has the same name: check it is a different organisation" });
    }
    for (const r of rows) {
      if (r.outcome !== "valid" || !r.userId) continue;
      const m = memberships.filter((x) => x.userId === r.userId);
      const leads = m.find((x) => x.position === "leader");
      if (r.data.position === "leader" && leads) {
        r.outcome = "invalid"; r.action = null;
        r.errors.push({ field: "email", reason: `This person already leads "${leads.name}" (one startup per leader, TBD-15)` });
      } else if (m.length) {
        r.warnings.push({ field: "email", reason: `This person is already part of ${m.map((x) => `"${x.name}"`).join(", ")}` });
      }
    }
    const leaders = rows.filter((r) => r.data.position === "leader" && r.errors.every((e) => e.field !== "position"));
    for (const extra of leaders.slice(1)) {
      if (extra.outcome === "valid") { extra.outcome = "invalid"; extra.action = null; }
      extra.errors.push({ field: "position", reason: `This startup already has a leader in row ${leaders[0]!.rowNumber}` });
    }
    const leader = leaders[0];
    const leaderOk = leader && leader.outcome === "valid";
    for (const r of rows) {
      if (r === leader || r.outcome !== "valid") continue;
      if (!leaderOk) {
        r.outcome = "invalid"; r.action = null;
        r.errors.push({ field: "position", reason: leader ? `The leader row (${leader.rowNumber}) for this startup has problems` : "No valid leader row for this startup" });
      }
    }
  }
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const toRow = (r: Analysed | ImportRowDb): ImportRow => ({
  rowNumber: r.rowNumber, data: r.data, outcome: r.outcome, action: r.action, errors: r.errors, warnings: r.warnings,
});
type ImportRowDb = Omit<ImportRow, "outcome"> & { outcome: ImportRow["outcome"]; userId: string | null };

function summarise(rows: { outcome: string; action?: string | null }[]): Record<string, number> {
  const s: Record<string, number> = { total: rows.length };
  for (const r of rows) {
    s[r.outcome] = (s[r.outcome] ?? 0) + 1;
    if (r.outcome === "valid" && r.action) s[`will_${r.action}`] = (s[`will_${r.action}`] ?? 0) + 1;
  }
  return s;
}

export async function previewImport(sql: Sql, p: Principal, input: ImportPreviewRequest): Promise<ImportBatchDetail> {
  const [edition] = await sql`select 1 from event_editions where id = ${input.edition}`;
  if (!edition) throw notFound("Edition");
  const rows = readFile(input.category, input.csv);
  const analysed = await analyse(sql, input.category, rows);
  const summary = summarise(analysed);
  const errorCount = analysed.filter((r) => r.outcome !== "valid").length;
  const id = await sql.begin(async (tx) => {
    const [b] = await tx<{ id: string }[]>`
      insert into import_batches (category, edition_id, file_name, file_sha256, uploaded_by, row_count, error_count, summary)
      values (${input.category}, ${input.edition}, ${input.fileName}, ${sha256(input.csv)}, ${p.account!.id},
              ${analysed.length}, ${errorCount}, ${tx.json(summary)})
      returning id`;
    for (let i = 0; i < analysed.length; i += 500) {
      const chunk = analysed.slice(i, i + 500).map((r) => ({
        row_number: r.rowNumber, data: r.data, outcome: r.outcome, action: r.action, errors: r.errors, warnings: r.warnings, user_id: r.userId,
      }));
      await tx`
        insert into import_rows (batch_id, row_number, data, outcome, action, errors, warnings, user_id)
        select ${b!.id}, x.row_number, x.data, x.outcome, x.action, x.errors, x.warnings, x.user_id
        from jsonb_to_recordset(${tx.json(chunk as never)}) as x(row_number int, data jsonb, outcome text, action text,
                                                               errors jsonb, warnings jsonb, user_id uuid)`;
    }
    await audit(tx, { actorUserId: p.account!.id, action: "import.previewed", entityType: "import_batch", entityId: b!.id,
      editionId: input.edition, data: { category: input.category, fileName: input.fileName, summary } });
    return b!.id;
  });
  return getBatch(sql, id);
}

type BatchDb = Omit<ImportBatch, "uploadedAt" | "committedAt"> & { uploadedAt: Date; committedAt: Date | null };
const BATCH_COLS = (db: Db) => db`id, category, edition_id as edition, file_name as "fileName", file_sha256 as "fileSha256", state,
  uploaded_by as "uploadedBy", uploaded_at as "uploadedAt", committed_at as "committedAt", row_count as "rowCount",
  error_count as "errorCount", summary`;
const batchDto = (b: BatchDb): ImportBatch => ({ ...b, uploadedAt: b.uploadedAt.toISOString(), committedAt: b.committedAt?.toISOString() ?? null });

export async function listBatches(db: Db): Promise<ImportBatch[]> {
  return (await db<BatchDb[]>`select ${BATCH_COLS(db)} from import_batches order by uploaded_at desc limit 100`).map(batchDto);
}

export async function getBatch(db: Db, id: string): Promise<ImportBatchDetail> {
  const [b] = await db<BatchDb[]>`select ${BATCH_COLS(db)} from import_batches where id = ${id}`;
  if (!b) throw notFound("Import");
  const rows = await db<ImportRowDb[]>`
    select row_number as "rowNumber", data, outcome, action, errors, warnings, user_id as "userId"
    from import_rows where batch_id = ${id} order by row_number`;
  return { ...batchDto(b), rows: rows.map(toRow) };
}

export async function discardBatch(sql: Sql, p: Principal, id: string): Promise<ImportBatch> {
  const [b] = await sql<BatchDb[]>`
    update import_batches set state = 'discarded' where id = ${id} and state = 'previewed' returning ${BATCH_COLS(sql)}`;
  if (!b) throw new AppError(409, "import_not_open", "Import is not open", "Only a previewed import can be discarded.");
  await audit(sql, { actorUserId: p.account!.id, action: "import.discarded", entityType: "import_batch", entityId: id, editionId: b.edition });
  return batchDto(b);
}

/**
 * Commits a previewed import. Rows are validated again against the database at commit time (things may have changed
 * since the preview); only rows that are still valid and not excluded are applied. Accounts are created as
 * pending_activation and get the import's edition access and role (FR-IMP-05, FR-IAM-12/13).
 */
export async function commitBatch(sql: Sql, p: Principal, id: string, excludeRows: number[]): Promise<ImportBatchDetail> {
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('sj.imports.commit', 0))`;   // one commit at a time
    const [b] = await tx<{ category: ImportCategory; edition: number; state: string }[]>`
      select category, edition_id as edition, state from import_batches where id = ${id} for update`;
    if (!b) throw notFound("Import");
    if (b.state !== "previewed") throw new AppError(409, "import_not_open", "Import is not open", `This import is already ${b.state}.`);
    const stored = await tx<{ rowNumber: number; data: Record<string, string>; errors: ImportIssue[]; warnings: ImportIssue[] }[]>`
      select row_number as "rowNumber", data, errors, warnings from import_rows where batch_id = ${id} order by row_number`;
    // Value checks are re-run from the stored data; structural (column-count) findings come from the original file.
    const rows = await analyse(tx, b.category, stored.map((r) => ({
      rowNumber: r.rowNumber, data: r.data,
      issues: { errors: r.errors.filter((e) => e.field === ROW_FIELD), warnings: r.warnings.filter((w) => w.field === ROW_FIELD) },
    })));

    // Excluding a startup's leader excludes the whole startup (members cannot be imported without their leader).
    const excluded = new Set(excludeRows);
    if (b.category === "startups") {
      for (const r of rows) if (excluded.has(r.rowNumber) && r.data.position === "leader") {
        for (const m of rows) if (m.startupKey === r.startupKey) excluded.add(m.rowNumber);
      }
    }

    const final: (Analysed & { finalOutcome: ImportRow["outcome"] })[] = [];
    const startupIds = new Map<string, string>();
    const ordered = [...rows].sort((a, z) => (a.data.position === "leader" ? 0 : 1) - (z.data.position === "leader" ? 0 : 1) || a.rowNumber - z.rowNumber);
    for (const r of ordered) {
      if (excluded.has(r.rowNumber)) { final.push({ ...r, finalOutcome: "excluded" }); continue; }
      if (r.outcome !== "valid") { final.push({ ...r, finalOutcome: r.outcome }); continue; }
      let userId = r.userId;
      if (r.action === "create") {
        const [u] = await tx<{ id: string }[]>`
          insert into user_accounts (email, mobile_e164, full_name, status)
          values (${r.email}, ${r.mobile}, ${r.data.full_name!}, 'pending_activation') returning id`;
        userId = u!.id;
        await audit(tx, { actorUserId: p.account!.id, action: "account.created", entityType: "user_account", entityId: userId,
          editionId: b.edition, data: { via: "import", batchId: id, row: r.rowNumber } });
      } else if (r.mobile) {
        await tx`update user_accounts set mobile_e164 = ${r.mobile} where id = ${userId} and mobile_e164 is null`;
      }
      await tx`
        insert into role_grants (user_id, role, edition_id, granted_by)
        select ${userId}, ${r.role}, ${b.edition}, ${p.account!.id}
        where not exists (select 1 from role_grants where user_id = ${userId} and role = ${r.role}
                          and coalesce(edition_id, 0) = ${b.edition} and revoked_at is null)`;
      await tx`insert into edition_access (user_id, edition_id, source, granted_by)
               values (${userId}, ${b.edition}, 'predefined', ${p.account!.id}) on conflict (user_id, edition_id) do nothing`;
      if (b.category === "startups") {
        let startupId = startupIds.get(r.startupKey!);
        if (!startupId) {
          const [s] = await tx<{ id: string }[]>`
            insert into startups (name, description, website, city, state, origin, created_by)
            values (${r.data.startup_name!}, ${r.data.description || null}, ${r.data.website || null},
                    ${r.data.city || null}, ${r.data.state || null}, 'predefined', ${p.account!.id})
            returning id`;
          startupId = s!.id;
          startupIds.set(r.startupKey!, startupId);
        }
        await tx`insert into startup_memberships (startup_id, user_id, position) values (${startupId}, ${userId}, ${r.data.position!})
                 on conflict (startup_id, user_id) do nothing`;
      }
      final.push({ ...r, userId, finalOutcome: r.action === "create" ? "created" : "linked" });
    }

    const updates = final.map((r) => ({ row_number: r.rowNumber, outcome: r.finalOutcome, action: r.action, errors: r.errors, warnings: r.warnings, user_id: r.userId }));
    await tx`
      update import_rows t set outcome = x.outcome, action = x.action, errors = x.errors, warnings = x.warnings, user_id = x.user_id
      from jsonb_to_recordset(${tx.json(updates as never)}) as x(row_number int, outcome text, action text, errors jsonb, warnings jsonb, user_id uuid)
      where t.batch_id = ${id} and t.row_number = x.row_number`;
    const summary = summarise(final.map((r) => ({ outcome: r.finalOutcome })));
    await tx`update import_batches set state = 'committed', committed_at = now(), summary = ${tx.json(summary)},
               error_count = ${final.filter((r) => ["invalid", "duplicate"].includes(r.finalOutcome)).length}
             where id = ${id}`;
    await audit(tx, { actorUserId: p.account!.id, action: "import.committed", entityType: "import_batch", entityId: id,
      editionId: b.edition, data: { category: b.category, summary } });
  });
  return getBatch(sql, id);
}

export function templateCsv(category: ImportCategory): string {
  const s = IMPORT_COLUMNS[category];
  return `${[...s.required, ...s.optional].join(",")}\n`;
}
