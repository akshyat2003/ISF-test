// Forward-only SQL migration runner. Applies db/migrations/*.sql in order, each in its own transaction,
// and refuses to run if an already-applied file has been edited (checksum mismatch).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSql, type Sql } from "./client.js";

/** Finds <repo>/db/migrations by walking up from this file (works from src/ and from the bundled dist/). */
export function findMigrationsDir(start = path.dirname(fileURLToPath(import.meta.url))): string {
  for (let dir = start; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "db", "migrations");
    if (existsSync(candidate)) return candidate;
    if (path.dirname(dir) === dir) throw new Error("db/migrations not found; set MIGRATIONS_DIR");
  }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function migrate(sql: Sql, dir = process.env.MIGRATIONS_DIR ?? findMigrationsDir()): Promise<string[]> {
  await sql`create table if not exists schema_migrations (
    version text primary key, checksum text not null, applied_at timestamptz not null default now())`;
  const applied = new Map((await sql<{ version: string; checksum: string }[]>`select version, checksum from schema_migrations`).map((r) => [r.version, r.checksum]));
  const files = readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const ran: string[] = [];
  for (const file of files) {
    // Line endings are normalised so a checkout with CRLF endings (Windows, git autocrlf) is not mistaken for an edit.
    const body = readFileSync(path.join(dir, file), "utf8").replace(/\r\n/g, "\n");
    const checksum = sha256(body);
    const prev = applied.get(file);
    if (prev) {
      if (prev === checksum) continue;
      if (prev === sha256(body.replace(/\n/g, "\r\n"))) {
        // Recorded from a CRLF copy of the same content by an earlier runner: same migration, re-record normalised.
        await sql`update schema_migrations set checksum = ${checksum} where version = ${file}`;
        continue;
      }
      throw new Error(`Migration ${file} was modified after being applied; add a new migration instead`);
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (version, checksum) values (${file}, ${checksum})`;
    });
    ran.push(file);
  }
  return ran;
}

// CLI: `pnpm db:migrate`
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const sql = createSql(url, { max: 1 });
  migrate(sql)
    .then((ran) => console.log(ran.length ? `applied: ${ran.join(", ")}` : "database is up to date"))
    .finally(() => sql.end());
}
