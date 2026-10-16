// TBD-39 (application form as edition configuration) and TBD-45 (18+ declaration). See docs/DECISIONS.md.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FORM_ANSWERS, createTestApp, registration, type TestApp } from "./helpers.js";

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.close(); });

const KEYS = ["problem", "solution", "stage", "market", "impact", "team"];
const edition = async (year: number) =>
  (await t.call("GET", "/v1/public/editions")).json.find((e: { year: number }) => e.year === year);
const count = async () => Number((await t.sql`select count(*)::int as n from applications`)[0]!.n);
const paths = (r: { json: { errors?: { path: string }[] } }) => (r.json.errors ?? []).map((e) => e.path);

describe("TBD-39 application form is edition configuration", () => {
  it("serves the seeded questions for both editions on the public endpoint", async () => {
    for (const year of [2026, 2027]) {
      const e = await edition(year);
      expect(e.applicationForm.version).toBe("2026-10-15");
      expect(e.applicationForm.questions.map((q: { key: string }) => q.key)).toEqual(KEYS);
      expect(e.applicationForm.questions.every((q: { minLength: number; maxLength: number }) => q.minLength === 20 && q.maxLength === 1500)).toBe(true);
    }
  });

  it("a wording change is data: clients receive it from the API without a release", async () => {
    const original = (await t.sql<{ f: unknown }[]>`select application_form as f from event_editions where id = 2026`)[0]!.f;
    const changed = structuredClone(original) as { questions: { key: string; label: string }[] };
    changed.questions[0]!.label = "Which problem do you solve?";
    await t.sql`update event_editions set application_form = ${t.sql.json(changed as never)} where id = 2026`;
    expect((await edition(2026)).applicationForm.questions[0].label).toBe("Which problem do you solve?");
    await t.sql`update event_editions set application_form = ${t.sql.json(original as never)} where id = 2026`;
  });

  it("a malformed form configuration fails closed: nothing is served", async () => {
    const original = (await t.sql<{ f: unknown }[]>`select application_form as f from event_editions where id = 2027`)[0]!.f;
    await t.sql`update event_editions set application_form = ${t.sql.json({ version: "bad", questions: [{ key: "Not A Key" }] } as never)} where id = 2027`;
    const r = await t.call("GET", "/v1/public/editions");
    expect(r.status).toBe(500);
    const reg = await t.call("POST", "/v1/me/registrations", { as: "bad-form@example.com", body: registration({ name: "Bad Form Co", yearOption: "2027" }) });
    expect(reg.status).toBe(500);
    expect(await count()).toBe(0);
    await t.sql`update event_editions set application_form = ${t.sql.json(original as never)} where id = 2027`;
  });

  it("rejects missing, too-short, too-long and unknown answers, each with its own field path", async () => {
    const { problem: _omitted, ...rest } = FORM_ANSWERS;
    const r = await t.call("POST", "/v1/me/registrations", {
      as: "answers@example.com",
      body: registration({
        name: "Answers Co",
        formAnswers: { ...rest, solution: "too short", stage: "x".repeat(1501), pitch_deck_url: "https://example.com/deck.pdf" },
      }),
    });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("validation_failed");
    expect(paths(r)).toEqual(expect.arrayContaining(["formAnswers.problem", "formAnswers.solution", "formAnswers.stage", "formAnswers.pitch_deck_url"]));
    expect(await count()).toBe(0);
  });

  it("stores trimmed answers with the form version they answered", async () => {
    const r = await t.call("POST", "/v1/me/registrations", {
      as: "stored@example.com",
      body: registration({ name: "Stored Co", formAnswers: { ...FORM_ANSWERS, team: `   ${FORM_ANSWERS.team}   ` } }),
    });
    expect(r.status).toBe(201);
    const [app] = await t.sql<{ formVersion: string; answers: Record<string, string> }[]>`
      select form_version as "formVersion", form_answers as answers from applications where id = ${r.json.applications[0].id}`;
    expect(app!.formVersion).toBe("2026-10-15");
    expect(app!.answers).toEqual(FORM_ANSWERS);
  });

  it("freezes an edition's form once it has applications, but not another edition's", async () => {
    const original = (await t.sql<{ f: unknown }[]>`select application_form as f from event_editions where id = 2026`)[0]!.f;
    await expect(t.sql`update event_editions set application_form = ${t.sql.json({ version: "x", questions: [] } as never)} where id = 2026`)
      .rejects.toMatchObject({ hint: "FORM-FROZEN" });
    const [still] = await t.sql<{ f: unknown }[]>`select application_form as f from event_editions where id = 2026`;
    expect(still!.f).toEqual(original);
    // 2027 has no applications in this file yet, so its form can still change.
    await t.sql`update event_editions set application_form = jsonb_set(application_form, '{version}', '"2027-a"') where id = 2027`;
    expect((await edition(2027)).applicationForm.version).toBe("2027-a");
  });

  it("'both' years: answers must satisfy the union of both forms, and each application keeps its own version", async () => {
    const form27 = (await t.sql<{ f: { version: string; questions: unknown[] } }[]>`select application_form as f from event_editions where id = 2027`)[0]!.f;
    const extra = { key: "region", label: "Which district do you work in?", minLength: 3, maxLength: 100 };
    await t.sql`update event_editions set application_form = ${t.sql.json({ ...form27, questions: [...form27.questions, extra] } as never)} where id = 2027`;

    const missing = await t.call("POST", "/v1/me/registrations", { as: "union@example.com", body: registration({ name: "Union Co", yearOption: "both" }) });
    expect(missing.status).toBe(400);
    expect(paths(missing)).toEqual(["formAnswers.region"]);

    const ok = await t.call("POST", "/v1/me/registrations", {
      as: "union@example.com", body: registration({ name: "Union Co", yearOption: "both", formAnswers: { ...FORM_ANSWERS, region: "Rayagada" } }),
    });
    expect(ok.status).toBe(201);
    const versions = await t.sql<{ edition: number; formVersion: string }[]>`
      select edition_id as edition, form_version as "formVersion" from applications
      where startup_id = (select id from startups where name = 'Union Co') order by edition_id`;
    expect(versions).toEqual([{ edition: 2026, formVersion: "2026-10-15" }, { edition: 2027, formVersion: "2027-a" }]);
  });
});

describe("TBD-45 adults only: the registering leader confirms they are 18 or older", () => {
  it.each([[false], [undefined]])("refuses a registration when the declaration is %s", async (value) => {
    const body = registration({ name: `Minor Check ${String(value)}`, adultDeclaration: value });
    if (value === undefined) delete (body as Record<string, unknown>).adultDeclaration;
    const before = await count();
    const r = await t.call("POST", "/v1/me/registrations", { as: `minor-${String(value)}@example.com`, body });
    expect(r.status).toBe(400);
    expect(paths(r)).toContain("adultDeclaration");
    expect(await count()).toBe(before);
  });

  it("records the declaration and the form version in the audited submission", async () => {
    await t.call("POST", "/v1/me/registrations", { as: "adult@example.com", body: registration({ name: "Adult Co" }) });
    const [ev] = await t.sql<{ data: Record<string, unknown> }[]>`
      select e.data from audit_events e join startups s on s.id::text = e.entity_id::text
      where e.action = 'registration.submitted' and s.name = 'Adult Co'`;
    expect(ev!.data).toMatchObject({ adultDeclaration: true, formVersions: { 2026: "2026-10-15" } });
  });
});
