// Database-level enforcement of PRD integrity rules (PRD §10.3). These hold even if application code has a bug.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate.js";
import { createTestDb } from "./helpers.js";

let db: Awaited<ReturnType<typeof createTestDb>>;
let manager: string, plain: string, vol1: string, vol2: string, jury: string, startupA: string, startupB: string;

const user = async (email: string) =>
  (await db.sql`insert into user_accounts (email, full_name) values (${email}, ${email}) returning id`)[0]!.id as string;

beforeAll(async () => {
  db = await createTestDb();
  manager = await user("m@x.test");
  plain = await user("p@x.test");
  vol1 = await user("v1@x.test");
  vol2 = await user("v2@x.test");
  jury = await user("j@x.test");
  await db.sql`insert into role_grants (user_id, role) values (${manager}, 'management')`;
  startupA = (await db.sql`insert into startups (name, origin) values ('Alpha', 'applicant') returning id`)[0]!.id;
  startupB = (await db.sql`insert into startups (name, origin) values ('Beta', 'predefined') returning id`)[0]!.id;
});
afterAll(async () => { await db.drop(); });

const app = async (startup: string, year: number) =>
  (await db.sql`insert into applications (startup_id, edition_id, privacy_notice_version, submitted_by)
                values (${startup}, ${year}, 'v', ${plain}) returning id`)[0]!.id as string;

describe("migrations", () => {
  it("are idempotent and detect edited files", async () => {
    expect(await migrate(db.sql)).toEqual([]);
    await db.sql`update schema_migrations set checksum = 'tampered' where version = '0001_foundation.sql'`;
    await expect(migrate(db.sql)).rejects.toThrow(/modified after being applied/);
  });
});

describe("DC-01 one application per startup per edition", () => {
  it("rejects a second application for the same year, allows the other year", async () => {
    await app(startupA, 2026);
    await expect(app(startupA, 2026)).rejects.toMatchObject({ code: "23505", constraint_name: "one_application_per_startup_per_edition" });
    await expect(app(startupA, 2027)).resolves.toBeTruthy();
  });

  it("allows only one leader per startup", async () => {
    await db.sql`insert into startup_memberships (startup_id, user_id, position) values (${startupA}, ${vol1}, 'leader')`;
    await expect(db.sql`insert into startup_memberships (startup_id, user_id, position) values (${startupA}, ${vol2}, 'leader')`)
      .rejects.toMatchObject({ code: "23505" });
  });
});

describe("DC-02 decisions are made by Management only, and released decisions are frozen", () => {
  it("rejects a decision by someone without an active management grant", async () => {
    const id = await app(startupB, 2026);
    await expect(db.sql`insert into selection_decisions (application_id, outcome, status_before_decision, decided_by)
                        values (${id}, 'selected', 'submitted', ${plain})`).rejects.toMatchObject({ code: "P0001", hint: "DC-02" });
    await db.sql`insert into selection_decisions (application_id, outcome, status_before_decision, decided_by)
                 values (${id}, 'selected', 'submitted', ${manager})`;
    await db.sql`update selection_decisions set released_at = now(), released_by = ${manager} where application_id = ${id}`;
    await expect(db.sql`update selection_decisions set outcome = 'not_selected' where application_id = ${id}`)
      .rejects.toMatchObject({ hint: "TBD-37" });
    await expect(db.sql`delete from selection_decisions where application_id = ${id}`).rejects.toMatchObject({ hint: "TBD-37" });
  });
});

describe("DC-04/05/06 volunteers are strictly one-to-one", () => {
  // Since migration 0010 the database also requires real participants: volunteers and jury members of the edition, and
  // startups whose leader takes part in it. The fixtures say so explicitly; the one-to-one assertions are unchanged.
  beforeAll(async () => {
    for (const [u, role] of [[vol1, "volunteer"], [vol2, "volunteer"], [jury, "jury_member"]] as const) {
      await db.sql`insert into role_grants (user_id, role, edition_id) values (${u}, ${role}, 2026)`;
    }
    await db.sql`insert into startup_memberships (startup_id, user_id, position) values (${startupB}, ${plain}, 'leader')`;
    for (const u of [vol1, vol2, jury, plain]) {
      await db.sql`insert into edition_access (user_id, edition_id, source) values (${u}, 2026, 'predefined') on conflict do nothing`;
    }
  });
  const assign = (volunteer: string, target: { startup?: string; jury?: string }, state = "active") => db.sql`
    insert into volunteer_assignments (edition_id, volunteer_user_id, target_startup_id, target_jury_user_id, state, created_by,
                                       closed_at, reason)
    values (2026, ${volunteer}, ${target.startup ?? null}, ${target.jury ?? null}, ${state}, ${manager},
            ${state === "closed" ? new Date() : null}, 'Assigned by hand (test)')
    returning id`;

  it("rejects an assignment to both a startup and a jury member, or to neither", async () => {
    await expect(assign(vol1, { startup: startupA, jury })).rejects.toMatchObject({ code: "23514", constraint_name: "exactly_one_target" });
    await expect(assign(vol1, {})).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects a second open assignment for a volunteer and a second volunteer for a target", async () => {
    await assign(vol1, { startup: startupA });
    await expect(assign(vol1, { jury })).rejects.toMatchObject({ code: "23505", constraint_name: "volunteer_one_open_assignment" });
    await expect(assign(vol2, { startup: startupA })).rejects.toMatchObject({ code: "23505", constraint_name: "startup_one_open_volunteer" });
    await assign(vol2, { jury });
    await expect(assign(vol1, { jury })).rejects.toMatchObject({ code: "23505" });
  });

  it("allows reassignment once the old assignment is closed, keeping history (DC-07)", async () => {
    await db.sql`update volunteer_assignments set state = 'closed', closed_at = now(), closed_by = ${manager}, close_reason = 'Reassigned'
                 where volunteer_user_id = ${vol1} and state = 'active'`;
    await expect(assign(vol1, { startup: startupB })).resolves.toBeTruthy();
    const [n] = await db.sql`select count(*)::int as n from volunteer_assignments where volunteer_user_id = ${vol1}`;
    expect(n!.n).toBe(2);
  });
});

describe("DC-08 support tickets", () => {
  it("accepts only the four confirmed statuses and keeps emergencies high priority", async () => {
    await expect(db.sql`insert into support_tickets (status) values ('Escalated')`).rejects.toMatchObject({ code: "23514" });
    await expect(db.sql`insert into support_tickets (is_emergency, priority) values (true, 'normal')`).rejects.toMatchObject({ code: "23514" });
    await expect(db.sql`insert into support_tickets (is_emergency, priority) values (true, 'high') returning id`).resolves.toHaveLength(1);
  });
});

describe("DC-13 audit trail is append-only", () => {
  it("rejects updates and deletes", async () => {
    await db.sql`insert into audit_events (actor_type, action, entity_type) values ('system', 'test', 'x')`;
    await expect(db.sql`update audit_events set action = 'changed'`).rejects.toMatchObject({ hint: "DC-13" });
    await expect(db.sql`delete from audit_events`).rejects.toMatchObject({ hint: "DC-13" });
  });
});

describe("DC-11 WhatsApp identity", () => {
  it("maps a verified number to at most one active account", async () => {
    await db.sql`insert into phone_identities (user_id, number_e164, verified_at) values (${vol1}, '+919000000001', now())`;
    await expect(db.sql`insert into phone_identities (user_id, number_e164, verified_at) values (${vol2}, '+919000000001', now())`)
      .rejects.toMatchObject({ code: "23505" });
  });
});
