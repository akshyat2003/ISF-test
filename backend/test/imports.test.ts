// Phase 3 — bulk import of predefined participants (PRD §5, FR-IMP-01…11, AT-01…05).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, registration, type TestApp } from "./helpers.js";

const ADMIN = "admin@jathara.test";
const MANAGER = "manager@jathara.test";
const csv = (...lines: string[]) => lines.join("\r\n") + "\r\n";

const STARTUPS = csv(
  "startup_name,position,full_name,email,mobile,description,website,city,state",
  "Sal Leaf Studio,leader,Rina Majhi,rina@sal.test,98765 11111,Leaf plates,https://sal.test,Koraput,Odisha",
  "Sal Leaf Studio,member,Bapi Gond,bapi@sal.test,98765 22222,,,,",
  "  sal leaf   studio ,member,Mita Gond,,98765 33333,,,,",
  "Hill Honey,leader,Arun Sabar,arun@honey.test,,,,,",
  "Hill Honey,leader,Second Leader,second@honey.test,,,,,",
  "No Leader Co,member,Lone Member,lone@noleader.test,,,,,",
  "Bad Row Co,leader,,bad-email,123,,not-a-url,,",
  "Dup Email Co,leader,Repeat Person,rina@sal.test,,,,,",
);

describe("bulk import: validate → preview → commit", () => {
  let t: TestApp;
  let previewId: string;
  beforeAll(async () => {
    t = await createTestApp();
    await t.staff(ADMIN, ["admin"]);
    await t.staff(MANAGER, ["management"]);
  });
  afterAll(async () => { await t.close(); });

  const preview = (category: string, body: string, fileName = "file.csv", as = ADMIN) =>
    t.call("POST", "/v1/admin/imports", { as, body: { category, edition: 2026, fileName, csv: body } });

  it("only Admin can import (Management and participants are refused)", async () => {
    expect((await preview("jury", csv("full_name,email", "J One,j1@jury.test"), "x.csv", MANAGER)).status).toBe(403);
    expect((await t.call("GET", "/v1/admin/imports", { as: "someone@example.com" })).status).toBe(403);
    expect((await t.call("GET", "/v1/admin/imports", { as: ADMIN })).status).toBe(200);
  });

  it("serves a template with no password column (FR-IMP-07)", async () => {
    const r = await t.app.inject({ method: "GET", url: "/v1/admin/imports/templates/startups", headers: { authorization: `Bearer ${await t.token(ADMIN)}` } });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/csv");
    expect(r.body.trim()).toBe("startup_name,position,full_name,email,mobile,description,website,city,state");
  });

  it("rejects files with password-like columns and stores nothing (FR-IMP-07)", async () => {
    for (const col of ["password", "Temp Password", "pwd", "pin"]) {
      const r = await preview("jury", csv(`full_name,email,${col}`, "A,a@x.test,secret1"));
      expect(r.status).toBe(422);
      expect(r.json.code).toBe("import_password_column");
    }
    expect((await t.sql`select count(*)::int as n from import_batches`)[0]!.n).toBe(0);
  });

  it("rejects files whose columns do not match the template, naming what is wrong", async () => {
    const r = await preview("startups", csv("full_name,email,favourite_colour", "A,a@x.test,blue"));
    expect(r.status).toBe(422);
    expect(r.json.code).toBe("import_bad_columns");
    expect(r.json.missing).toEqual(["startup_name", "position"]);
    expect(r.json.unknown).toEqual(["favourite_colour"]);
    expect((await preview("jury", "full_name\r\n")).json.code).toBe("import_empty");
    expect((await preview("jury", 'full_name\r\n"unclosed')).json.code).toBe("import_unreadable");
  });

  it("previews per-row outcomes with row, field and reason, without creating accounts (FR-IMP-02…04, -09)", async () => {
    const before = (await t.sql`select count(*)::int as n from user_accounts`)[0]!.n;
    const r = await preview("startups", STARTUPS, "startups.csv");
    expect(r.status).toBe(201);
    previewId = r.json.id;
    const row = (n: number) => r.json.rows.find((x: { rowNumber: number }) => x.rowNumber === n);

    expect(row(2)).toMatchObject({ outcome: "valid", action: "create", errors: [] });
    expect(row(3)).toMatchObject({ outcome: "valid", action: "create" });
    expect(row(4)).toMatchObject({ outcome: "valid", action: "create" });            // same startup despite spacing/case
    expect(row(5)).toMatchObject({ outcome: "valid" });
    expect(row(6).outcome).toBe("invalid");
    expect(row(6).errors).toContainEqual({ field: "position", reason: "This startup already has a leader in row 5" });
    expect(row(7).errors).toContainEqual({ field: "position", reason: "No valid leader row for this startup" });
    expect(row(8).outcome).toBe("invalid");
    expect(row(8).errors.map((e: { field: string }) => e.field).sort()).toEqual(["email", "full_name", "mobile", "website"]);
    expect(row(9)).toMatchObject({ outcome: "duplicate", errors: [{ field: "email", reason: "Same email as row 2" }] });

    expect(r.json).toMatchObject({ state: "previewed", category: "startups", edition: 2026, rowCount: 8, errorCount: 4 });
    expect(r.json.summary).toMatchObject({ total: 8, valid: 4, invalid: 3, duplicate: 1, will_create: 4 });
    expect(r.json.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await t.sql`select count(*)::int as n from user_accounts`)[0]!.n).toBe(before);
    expect((await t.sql`select count(*)::int as n from audit_events where action = 'import.previewed'`)[0]!.n).toBe(1);
  });

  it("commits only valid rows: pending accounts, edition-scoped roles, predefined startups and access (FR-IMP-05/08, FR-IAM-12/13)", async () => {
    const r = await t.call("POST", `/v1/admin/imports/${previewId}/commit`, { as: ADMIN, body: {} });
    expect(r.status).toBe(200);
    expect(r.json.state).toBe("committed");
    expect(r.json.summary).toMatchObject({ total: 8, created: 4, invalid: 3, duplicate: 1 });

    const people = await t.sql`
      select u.email, u.mobile_e164, u.status, u.auth_subject, g.role, g.edition_id, a.source, s.name, s.origin, m.position
      from user_accounts u
      join role_grants g on g.user_id = u.id
      join edition_access a on a.user_id = u.id and a.edition_id = 2026
      join startup_memberships m on m.user_id = u.id join startups s on s.id = m.startup_id
      order by s.name, m.position, u.full_name`;
    expect(people).toEqual([
      { email: "arun@honey.test", mobile_e164: null, status: "pending_activation", auth_subject: null, role: "startup_team_leader", edition_id: 2026, source: "predefined", name: "Hill Honey", origin: "predefined", position: "leader" },
      { email: "rina@sal.test", mobile_e164: "+919876511111", status: "pending_activation", auth_subject: null, role: "startup_team_leader", edition_id: 2026, source: "predefined", name: "Sal Leaf Studio", origin: "predefined", position: "leader" },
      { email: "bapi@sal.test", mobile_e164: "+919876522222", status: "pending_activation", auth_subject: null, role: "startup_team_member", edition_id: 2026, source: "predefined", name: "Sal Leaf Studio", origin: "predefined", position: "member" },
      { email: null, mobile_e164: "+919876533333", status: "pending_activation", auth_subject: null, role: "startup_team_member", edition_id: 2026, source: "predefined", name: "Sal Leaf Studio", origin: "predefined", position: "member" },
    ]);
    const [s] = await t.sql`select description, website, city, state from startups where name = 'Sal Leaf Studio'`;
    expect(s).toEqual({ description: "Leaf plates", website: "https://sal.test", city: "Koraput", state: "Odisha" });
    expect((await t.sql`select count(*)::int as n from startups where name in ('No Leader Co', 'Bad Row Co', 'Dup Email Co')`)[0]!.n).toBe(0);
    expect((await t.sql`select count(*)::int as n from audit_events where action = 'account.created'`)[0]!.n).toBe(4);
  });

  it("cannot commit or discard twice", async () => {
    expect((await t.call("POST", `/v1/admin/imports/${previewId}/commit`, { as: ADMIN, body: {} })).json.code).toBe("import_not_open");
    expect((await t.call("POST", `/v1/admin/imports/${previewId}/discard`, { as: ADMIN })).json.code).toBe("import_not_open");
  });

  it("detects duplicates against existing records on a second import (FR-IMP-03)", async () => {
    const r = await preview("startups", csv("startup_name,position,full_name,email", "SAL LEAF STUDIO,leader,Rina Majhi,rina@sal.test"));
    expect(r.json.rows[0]).toMatchObject({ outcome: "duplicate", errors: [{ field: "startup_name", reason: "This startup was already imported" }] });
  });

  it("imported startups are predefined: their leader is told no application is needed (FR-IMP-08)", async () => {
    // Simulate the leader's first verified sign-in and activation by linking and activating directly.
    await t.sql`update user_accounts set auth_subject = 'dev|arun@honey.test', status = 'active' where email = 'arun@honey.test'`;
    const r = await t.call("POST", "/v1/me/registrations", { as: "arun@honey.test", body: registration({ name: "Hill Honey" }) });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("predefined_startup");
  });

  it("links existing accounts instead of duplicating them, and flags shared or unsafe mobile numbers (FR-IMP-05, -10)", async () => {
    await t.staff("existing.judge@jury.test", []);
    await t.sql`update user_accounts set mobile_e164 = '+919811100000' where email = 'existing.judge@jury.test'`;
    await t.sql`insert into user_accounts (email, full_name, status) values ('gone@jury.test', 'Gone', 'deactivated')`;
    const r = await preview("jury", csv(
      "full_name,email,mobile",
      "Existing Judge,EXISTING.JUDGE@jury.test,",
      "New Judge,new.judge@jury.test,9811100000",
      "Phone Only,,9811100000",
      "Gone Judge,gone@jury.test,",
      "Twin A,twin.a@jury.test,9822200000",
      "Twin B,twin.b@jury.test,9822200000",
    ));
    const rows = r.json.rows;
    expect(rows[0]).toMatchObject({ outcome: "valid", action: "link" });
    expect(rows[1]).toMatchObject({ outcome: "valid", action: "create" });
    expect(rows[1].warnings[0].reason).toContain("shared number");
    expect(rows[2]).toMatchObject({ outcome: "duplicate", action: null });
    expect(rows[3].outcome).toBe("invalid");
    expect(rows[3].errors[0].reason).toContain("deactivated");
    expect(rows[5].warnings).toContainEqual({ field: "mobile", reason: "Mobile number also used in row 6 (shared number, FR-IMP-10)" });

    const c = await t.call("POST", `/v1/admin/imports/${r.json.id}/commit`, { as: ADMIN, body: {} });
    expect(c.json.summary).toMatchObject({ linked: 1, created: 3, duplicate: 1, invalid: 1 });
    const [judge] = await t.sql`
      select u.status, (select count(*)::int from user_accounts where lower(email) = 'existing.judge@jury.test') as copies,
             exists (select 1 from role_grants g where g.user_id = u.id and g.role = 'jury_member' and g.edition_id = 2026) as juror
      from user_accounts u where email = 'existing.judge@jury.test'`;
    expect(judge).toEqual({ status: "active", copies: 1, juror: true });   // linked account keeps its status
  });

  it("re-validates at commit time and honours excluded rows (excluding a leader excludes the startup)", async () => {
    const r = await preview("startups", csv(
      "startup_name,position,full_name,email",
      "Bamboo Works,leader,Late Leader,late@bamboo.test",
      "Bamboo Works,member,Late Member,member@bamboo.test",
      "River Fish,leader,Fish Leader,fish@river.test",
    ));
    // Between preview and commit, someone registers with the River Fish leader's email.
    await t.call("POST", "/v1/me/registrations", { as: "fish@river.test", body: registration({ name: "Totally Different" }) });
    const c = await t.call("POST", `/v1/admin/imports/${r.json.id}/commit`, { as: ADMIN, body: { excludeRows: [2] } });
    const rows = c.json.rows;
    expect(rows.map((x: { outcome: string }) => x.outcome)).toEqual(["excluded", "excluded", "invalid"]);
    expect(rows[2].errors[0].reason).toContain('already leads "Totally Different"');
    expect((await t.sql`select count(*)::int as n from startups where name in ('Bamboo Works', 'River Fish')`)[0]!.n).toBe(0);
  });

  it("can discard a preview", async () => {
    const r = await preview("delegates", csv("full_name,email", "D One,d1@delegates.test"));
    const d = await t.call("POST", `/v1/admin/imports/${r.json.id}/discard`, { as: ADMIN });
    expect(d.json.state).toBe("discarded");
    expect((await t.call("POST", `/v1/admin/imports/${r.json.id}/commit`, { as: ADMIN, body: {} })).status).toBe(409);
    expect((await t.sql`select count(*)::int as n from user_accounts where email = 'd1@delegates.test'`)[0]!.n).toBe(0);
  });

  it("lists batches with uploader, time, checksum and outcomes (FR-IMP-11)", async () => {
    const r = await t.call("GET", "/v1/admin/imports", { as: ADMIN });
    expect(r.json.length).toBe(5);
    expect(r.json.map((b: { state: string }) => b.state).sort()).toEqual(["committed", "committed", "committed", "discarded", "previewed"]);
    for (const b of r.json) expect(b).toMatchObject({ uploadedBy: expect.any(String), uploadedAt: expect.any(String), fileSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });
});

describe("malformed rows are reported per row and never imported", () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); await t.staff(ADMIN, ["admin"]); });
  afterAll(async () => { await t.close(); });
  const preview = (category: string, body: string) =>
    t.call("POST", "/v1/admin/imports", { as: ADMIN, body: { category, edition: 2026, fileName: "m.csv", csv: body } });

  it("flags column-count mismatches, control characters, unreadable text, oversized cells and formula prefixes", async () => {
    const r = await preview("jury", csv(
      "full_name,email,mobile",
      "Extra Values,extra@jury.test,9811100001,surprise",          // 2: value beyond the header (unquoted comma)
      "Trailing Commas,trail@jury.test,9811100002,,",              // 3: empty extras are harmless
      "Short Row,short@jury.test",                                 // 4: fewer values → warning only
      "Bell\u0007Name,bell@jury.test,",                             // 5: control character
      "Mojibake �,moji@jury.test,",                            // 6: unreadable byte
      "=HYPERLINK(\"http://x\"),formula@jury.test,",               // 7: formula injection
      `${"A".repeat(5001)},long@jury.test,`,                        // 8: oversized cell
      "@SUM(1),at@jury.test,",                                      // 9: formula injection
      "Fine Person,fine@jury.test,",                                // 10: valid
    ));
    expect(r.status).toBe(201);
    const row = (n: number) => r.json.rows.find((x: { rowNumber: number }) => x.rowNumber === n);
    expect(row(2)).toMatchObject({ outcome: "invalid", errors: [{ field: "row", reason: expect.stringContaining("Has 4 values but the header has 3 columns") }] });
    expect(row(3)).toMatchObject({ outcome: "valid", errors: [], warnings: [] });
    expect(row(4)).toMatchObject({ outcome: "valid", warnings: [{ field: "row", reason: expect.stringContaining("treated as empty") }] });
    expect(row(5).errors).toContainEqual({ field: "full_name", reason: "Contains hidden control characters" });
    expect(row(6).errors[0].reason).toContain("Save the file as CSV UTF-8");
    expect(row(7).errors).toContainEqual({ field: "full_name", reason: expect.stringContaining("formula") });
    expect(row(8).errors).toContainEqual({ field: "full_name", reason: "Longer than 5000 characters" });
    expect(row(9).outcome).toBe("invalid");
    expect(row(10)).toMatchObject({ outcome: "valid", errors: [] });

    // Commit re-checks: structural problems recorded at preview still block the row.
    const c = await t.call("POST", `/v1/admin/imports/${r.json.id}/commit`, { as: ADMIN, body: {} });
    expect(c.json.rows.filter((x: { outcome: string }) => x.outcome === "created").map((x: { rowNumber: number }) => x.rowNumber)).toEqual([3, 4, 10]);
    expect((await t.sql`select count(*)::int as n from user_accounts where email = 'extra@jury.test'`)[0]!.n).toBe(0);
  });

  it("rejects minus-prefixed and full-width formula-like values in exportable text fields (regression)", async () => {
    const r = await preview("startups", csv(
      "startup_name,position,full_name,email,description,city",
      "-2+3+cmd|' /C calc'!A0,leader,Minus Name,minus1@startup.test,,",
      "Fine Startup,leader,-Leading Dash,minus2@startup.test,,",
      "Desc Startup,leader,Desc Person,minus3@startup.test,- bullet that Excel would evaluate,",
      "City Startup,leader,City Person,minus4@startup.test,,\uFF1DSUM(1)",
      "Clean Startup,leader,Hyphen-ated Name,clean@startup.test,Low-cost sensors,Gunupur",
    ));
    const fields = (n: number) => r.json.rows.find((x: { rowNumber: number }) => x.rowNumber === n).errors.map((e: { field: string }) => e.field);
    expect(fields(2)).toContain("startup_name");
    expect(fields(3)).toContain("full_name");
    expect(fields(4)).toContain("description");
    expect(fields(5)).toContain("city");
    expect(r.json.rows.find((x: { rowNumber: number }) => x.rowNumber === 6)).toMatchObject({ outcome: "valid", errors: [] });   // inner hyphens are fine
  });

  it("does not treat a leading + in a mobile number as a formula", async () => {
    const r = await preview("delegates", csv("full_name,mobile", "Plus Number,+44 7700 900123"));
    expect(r.json.rows[0]).toMatchObject({ outcome: "valid", errors: [] });
  });
});
