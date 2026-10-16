// Migration 0009: the API's database user must be able to SET ROLE sj_ranking_worker even when it is NOT a superuser.
// Reproduces what Supabase (PostgreSQL 17, `postgres` with CREATEROLE, createrole_self_grant empty) does to a role's
// creator: a membership WITH ADMIN OPTION but without SET. Superuser test databases would otherwise hide the problem,
// as they did for migration 0008 until it was applied to the staging project.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_0009 = readFileSync(path.join(here, "../../../db/migrations/0009_ranking_worker_set_role.sql"), "utf8");

let db: Awaited<ReturnType<typeof createTestDb>>;
let apiUser: postgres.Sql;
const user = `sj_api_${randomBytes(4).toString("hex")}`;
const password = randomBytes(12).toString("hex");

beforeAll(async () => {
  db = await createTestDb();
  // A non-superuser API login holding the membership exactly as Supabase leaves it for the creator: ADMIN only.
  await db.sql.unsafe(`create role ${user} login createrole password '${password}'`);
  await db.sql.unsafe(`grant sj_ranking_worker to ${user} with admin true, inherit false, set false`);
  const u = new URL(db.url);
  u.username = user;
  u.password = password;
  apiUser = postgres(u.toString(), { max: 1, onnotice: () => {} });
});

afterAll(async () => {
  await apiUser?.end({ timeout: 5 });
  await db.sql.unsafe(`revoke sj_ranking_worker from ${user}`).catch(() => {});
  await db.drop();
  const admin = postgres(process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres", { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop role if exists ${user}`);
  await admin.end();
});

const canSetRole = async () => {
  try {
    await apiUser.begin(async (tx) => { await tx`set local role sj_ranking_worker`; });
    return true;
  } catch (e) {
    return (e as { code?: string }).code === "42501" ? false : Promise.reject(e);
  }
};

describe("0009: the ranking worker role can be assumed by a non-superuser API user", () => {
  it("reproduces the staging failure: ADMIN membership alone cannot SET ROLE (42501)", async () => {
    expect(await canSetRole()).toBe(false);
  });

  it("after 0009, run as that user, SET ROLE works without inheriting the worker's privileges", async () => {
    await apiUser.unsafe(MIGRATION_0009);
    expect(await canSetRole()).toBe(true);
    const [m] = await apiUser`select pg_has_role(current_user, 'sj_ranking_worker', 'SET') as set,
                                     pg_has_role(current_user, 'sj_ranking_worker', 'USAGE') as inherits`;
    expect(m).toEqual({ set: true, inherits: false });
    // Running it again is a no-op.
    await apiUser.unsafe(MIGRATION_0009);
  });

  it("inside the worker role, decisions stay out of reach (FR-RNK-04)", async () => {
    await expect(apiUser.begin(async (tx) => {
      await tx`set local role sj_ranking_worker`;
      await tx`select 1 from selection_decisions limit 1`;
    })).rejects.toMatchObject({ code: "42501" });
  });
});

describe("worker start-up check", () => {
  it("reports whether this database user can assume the ranking role", async () => {
    const { rankingRoleUsable } = await import("../src/workers.js");
    expect(await rankingRoleUsable(apiUser as never)).toBe(true);
    const other = `${user}_n`;
    await db.sql.unsafe(`create role ${other} login password '${password}'`);
    const u = new URL(db.url);
    u.username = other;
    u.password = password;
    const outsider = postgres(u.toString(), { max: 1, onnotice: () => {} });
    try {
      expect(await rankingRoleUsable(outsider as never)).toBe(false);   // a login without the membership
    } finally {
      await outsider.end({ timeout: 5 });
      await db.sql.unsafe(`drop role ${other}`);
    }
  });
});
