// Migration runner: forward-only with checksums, tolerant of CRLF/LF line-ending differences only.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate.js";
import { createTestDb } from "./helpers.js";

describe("migration checksums", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  const dir = mkdtempSync(path.join(tmpdir(), "sj-migr-"));
  const file = path.join(dir, "9001_probe.sql");
  const LF = "create table probe_t (id int);\ncomment on table probe_t is 'probe';\n";
  beforeAll(async () => { db = await createTestDb(); });
  afterAll(async () => { await db.drop(); });

  it("applies once, then treats a CRLF copy of the same file as unchanged", async () => {
    writeFileSync(file, LF);
    expect(await migrate(db.sql, dir)).toEqual(["9001_probe.sql"]);
    writeFileSync(file, LF.replace(/\n/g, "\r\n"));
    expect(await migrate(db.sql, dir)).toEqual([]);
  });

  it("accepts a checksum recorded from a CRLF copy by an older runner, and re-records it normalised", async () => {
    const crlf = createHash("sha256").update(LF.replace(/\n/g, "\r\n")).digest("hex");
    await db.sql`update schema_migrations set checksum = ${crlf} where version = '9001_probe.sql'`;
    writeFileSync(file, LF);
    expect(await migrate(db.sql, dir)).toEqual([]);
    const [r] = await db.sql`select checksum from schema_migrations where version = '9001_probe.sql'`;
    expect(r!.checksum).toBe(createHash("sha256").update(LF).digest("hex"));
  });

  it("still refuses a real edit to an applied migration", async () => {
    writeFileSync(file, LF.replace("probe'", "edited'"));
    await expect(migrate(db.sql, dir)).rejects.toThrow(/was modified after being applied/);
  });
});
