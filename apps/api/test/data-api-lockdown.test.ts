// Supabase exposes the public schema over its Data API to the `anon` and `authenticated` roles. Migration 0005
// must leave those roles with no access, and every table must have row-level security on (no policies).
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers.js";

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
let db: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  // Recreate Supabase's API roles locally (cluster-wide, idempotent) before migrating a fresh database.
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  for (const r of ["anon", "authenticated"]) {
    await admin.unsafe(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${r}') then create role ${r} nologin; end if; end $$`);
  }
  await admin.end();
  db = await createTestDb();
  // Simulate Supabase's default grants that 0005 must undo for tables created later, too.
  await db.sql.unsafe("grant usage on schema public to anon, authenticated");
});
afterAll(async () => { await db.drop(); });

describe("Data API lockdown (migration 0005)", () => {
  it("enables row-level security on every table in public", async () => {
    const off = await db.sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                             where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`;
    expect(off.map((r) => r.relname)).toEqual([]);
  });

  it("pins search_path on every function in public (migration 0006, Supabase advisor 0011)", async () => {
    const loose = await db.sql`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') order by 1`;
    expect(loose.map((r) => r.proname)).toEqual([]);
  });

  for (const role of ["anon", "authenticated"]) {
    it(`${role} can neither read nor write any table`, async () => {
      const tables = await db.sql`select tablename from pg_tables where schemaname = 'public'`;
      expect(tables.length).toBeGreaterThan(30);
      for (const { tablename } of tables) {
        const [p] = await db.sql`select has_table_privilege(${role}, ${`public.${tablename}`}, 'select') as r,
                                        has_table_privilege(${role}, ${`public.${tablename}`}, 'insert,update,delete') as w`;
        expect({ tablename, ...p }).toEqual({ tablename, r: false, w: false });
      }
      await expect(db.sql.begin(async (tx) => {
        await tx.unsafe(`set local role ${role}`);
        await tx`select * from user_accounts limit 1`;
      })).rejects.toThrow(/permission denied/);
    });
  }
});
