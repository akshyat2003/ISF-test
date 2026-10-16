import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AFTER_DEADLINE, AT_DEADLINE, BEFORE_DEADLINE, createTestApp, registration, type TestApp } from "./helpers.js";

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.close(); });

const count = async (sql: TestApp["sql"], where = "true") =>
  Number((await sql.unsafe(`select count(*)::int as n from applications where ${where}`))[0]!.n);

describe("registration access", () => {
  it("requires sign-in", async () => {
    const r = await t.call("POST", "/v1/me/registrations", { body: registration() });
    expect(r.status).toBe(401);
    expect(r.json.code).toBe("unauthenticated");
    expect(r.headers["content-type"]).toContain("application/problem+json");
  });

  it("validates fields and reports each problem", async () => {
    const r = await t.call("POST", "/v1/me/registrations", {
      as: "invalid@example.com",
      body: { yearOption: "2028", startup: { name: "X", description: "short" }, leader: { fullName: "", mobile: "123" }, privacyNoticeAccepted: false },
    });
    expect(r.status).toBe(400);
    const paths = r.json.errors.map((e: { path: string }) => e.path);
    expect(paths).toEqual(expect.arrayContaining(["yearOption", "startup.name", "startup.description", "leader.fullName", "leader.mobile", "privacyNoticeAccepted", "adultDeclaration"]));
    expect(await count(t.sql)).toBe(0);
  });
});

describe("AT-06 year-wise registration", () => {
  it.each([
    ["2026", [2026]],
    ["2027", [2027]],
    ["both", [2026, 2027]],
  ])("option %s creates one application per chosen year with its own status", async (option, years) => {
    const email = `at06-${option}@example.com`;
    const r = await t.call("POST", "/v1/me/registrations", { as: email, body: registration({ yearOption: option, name: `Startup ${option}` }) });
    expect(r.status).toBe(201);
    expect(r.json.applications.map((a: { edition: number }) => a.edition)).toEqual(years);
    expect(r.json.applications.every((a: { status: string }) => a.status === "under_review")).toBe(true);
    expect(new Set(r.json.applications.map((a: { id: string }) => a.id)).size).toBe(years.length);

    const mine = await t.call("GET", "/v1/me/applications", { as: email });
    expect(mine.status).toBe(200);
    expect(mine.json.applications).toHaveLength(years.length);
  });

  it("normalises the leader's mobile number to E.164", async () => {
    await t.call("POST", "/v1/me/registrations", { as: "mobile@example.com", body: registration({ name: "Mobile Co", mobile: "098765-43210" }) });
    const [u] = await t.sql`select mobile_e164 from user_accounts where email = 'mobile@example.com'`;
    expect(u!.mobile_e164).toBe("+919876543210");
  });
});

describe("AT-07 duplicate prevention", () => {
  const email = "dup@example.com";
  it("blocks a second application for the same startup and year, allows the other year", async () => {
    expect((await t.call("POST", "/v1/me/registrations", { as: email, body: registration({ name: "Dup Labs" }) })).status).toBe(201);

    const again = await t.call("POST", "/v1/me/registrations", { as: email, body: registration({ name: "Dup Labs" }) });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe("duplicate_application");
    expect(again.json.editions).toEqual([2026]);

    const both = await t.call("POST", "/v1/me/registrations", { as: email, body: registration({ name: "Dup Labs", yearOption: "both" }) });
    expect(both.status).toBe(409);   // all-or-nothing: 2027 is not created by a request that also asked for 2026

    const later = await t.call("POST", "/v1/me/registrations", { as: email, body: registration({ name: "Dup Labs", yearOption: "2027" }) });
    expect(later.status).toBe(201);
    expect(later.json.startupReused).toBe(true);
    expect(later.json.applications.map((a: { edition: number }) => a.edition)).toEqual([2026, 2027]);
    expect(await count(t.sql, `startup_id = '${later.json.startup.id}'`)).toBe(2);
  });

  it("rejects applying under a different startup name from the same leader account", async () => {
    const r = await t.call("POST", "/v1/me/registrations", { as: email, body: registration({ name: "Another Startup", yearOption: "2027" }) });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("startup_mismatch");
  });

  it("flags (does not block) a same-named startup from a different account (TBD-15)", async () => {
    const r = await t.call("POST", "/v1/me/registrations", { as: "other@example.com", body: registration({ name: "  dup   LABS " }) });
    expect(r.status).toBe(201);
    const [a] = await t.sql`select flags from applications where id = ${r.json.applications[0].id}`;
    expect(a!.flags).toEqual(["possible_duplicate_name"]);
  });

  it("is safe under concurrent double submission", async () => {
    const body = registration({ name: "Race Co", yearOption: "both" });
    const results = await Promise.all([1, 2, 3].map(() => t.call("POST", "/v1/me/registrations", { as: "race@example.com", body })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    const [s] = await t.sql`select id from startups where name = 'Race Co'`;
    expect(await count(t.sql, `startup_id = '${s!.id}'`)).toBe(2);
  });

  it("tells predefined startups they do not need to apply (FR-REG-10)", async () => {
    const [u] = await t.sql`insert into user_accounts (auth_subject, email, full_name) values ('dev|pre@example.com', 'pre@example.com', 'Pre Leader') returning id`;
    const [s] = await t.sql`insert into startups (name, origin) values ('Imported Startup', 'predefined') returning id`;
    await t.sql`insert into startup_memberships (startup_id, user_id, position) values (${s!.id}, ${u!.id}, 'leader')`;
    const r = await t.call("POST", "/v1/me/registrations", { as: "pre@example.com", body: registration({ name: "Imported Startup" }) });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("predefined_startup");
  });
});

describe("AT-08 server-enforced 2026 deadline", () => {
  it("accepts 2026 applications up to the cut-off second", async () => {
    t.setNow(AT_DEADLINE);
    const r = await t.call("POST", "/v1/me/registrations", { as: "edge@example.com", body: registration({ name: "Edge Co" }) });
    expect(r.status).toBe(201);
  });

  it("rejects 2026 (alone or with 2027) after the deadline and creates nothing, but keeps 2027 open", async () => {
    t.setNow(AFTER_DEADLINE);
    const editions = await t.call("GET", "/v1/public/editions");
    expect(editions.json.find((e: { year: number }) => e.year === 2026).registration.open).toBe(false);
    expect(editions.json.find((e: { year: number }) => e.year === 2027).registration.open).toBe(true);

    const before = await count(t.sql);
    for (const yearOption of ["2026", "both"]) {
      const r = await t.call("POST", "/v1/me/registrations", { as: `late-${yearOption}@example.com`, body: registration({ name: `Late ${yearOption}`, yearOption }) });
      expect(r.status).toBe(422);
      expect(r.json.code).toBe("registration_closed");
      expect(r.json.editions).toEqual([2026]);
    }
    expect(await count(t.sql)).toBe(before);

    const ok = await t.call("POST", "/v1/me/registrations", { as: "late-2027@example.com", body: registration({ name: "Late 2027", yearOption: "2027" }) });
    expect(ok.status).toBe(201);
    t.setNow(BEFORE_DEADLINE);
  });

  it("publishes the cut-off as unconfirmed until the organisers confirm TBD-11", async () => {
    const e = (await t.call("GET", "/v1/public/editions")).json.find((x: { year: number }) => x.year === 2026);
    expect(e.registration.closesAt).toBe("2026-11-05T18:29:59.000Z");
    expect(e.registration.closesAtConfirmed).toBe(false);
    expect([e.preEventOn, e.eventStartsOn, e.eventEndsOn]).toEqual(["2026-12-17", "2026-12-18", "2026-12-20"]);
  });
});

describe("AT-09 edition access", () => {
  it("a 2027-only applicant cannot open 2026 participant features", async () => {
    await t.call("POST", "/v1/me/registrations", { as: "only27@example.com", body: registration({ name: "Only 27", yearOption: "2027" }) });
    const r = await t.call("GET", "/v1/editions/2026/me", { as: "only27@example.com" });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("no_edition_access");
  });
});
