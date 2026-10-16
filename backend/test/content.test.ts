// Phase 7: event information and documents (FR-EVT-*, AT-24, AT-37; TBD-06, TBD-24, TBD-51).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { supabaseStore } from "../src/modules/content/storage.js";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
const MANAGER = "manager@content.test", ADMIN = "admin@content.test";
const JUROR = "juror@content.test", VOLUNTEER = "vol@content.test", DELEGATE = "delegate@content.test", ONLY27 = "only27@content.test";
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("synthetic test document\n%%EOF\n")]);

beforeAll(async () => {
  t = await createTestApp();
  await t.staff(MANAGER, ["management"]);
  await t.staff(ADMIN, ["admin"]);
  await t.participant(JUROR, "jury_member");
  await t.participant(VOLUNTEER, "volunteer");
  await t.participant(DELEGATE, "delegate");
  await t.participant(ONLY27, "startup_team_leader", 2027);
});
afterAll(async () => { await t.close(); });

const overview = (as = MANAGER) => t.call("GET", "/v1/manage/editions/2026/content", { as });
const create = (as: string, body: unknown) => t.call("POST", "/v1/manage/editions/2026/content", { as, body });
const publish = (as: string, id: string, changeSummary = "First publication") => t.call("POST", `/v1/manage/content/${id}/publish`, { as, body: { changeSummary } });
const publicEvent = () => t.call("GET", "/v1/public/editions/2026/event");
const eventAs = (as: string, year = 2026) => t.call("GET", `/v1/editions/${year}/event`, { as });
const itemNamed = async (title: string) => (await overview()).json.items.find((i: { draft: { title: string } | null; live: { title: string } | null }) =>
  (i.live ?? i.draft)?.title === title);

describe("TBD-06: the tentative programme from RQ §2 is seeded as drafts", () => {
  it("ships 12 schedule drafts and the venue, all unpublished and invisible to everyone", async () => {
    const o = (await overview()).json;
    expect(o.items.filter((i: { type: string }) => i.type === "schedule_item")).toHaveLength(12);
    expect(o.items.every((i: { state: string; version: number }) => i.state === "draft" && i.version === 0)).toBe(true);
    expect(o.items.find((i: { type: string }) => i.type === "venue").draft).toMatchObject({ title: "GIET University", body: { address: "Gunupur, Odisha" } });
    const pre = o.items.find((i: { draft: { body: { day: string } } }) => i.draft?.body.day === "2026-12-17");
    expect(pre.draft).toMatchObject({ title: "Pre-event domain-wise startup activities",
      body: { startTime: "13:30", endTime: "17:30", tentative: true } });
    const pub = (await publicEvent()).json;
    expect(pub.schedule.flatMap((d: { items: unknown[] }) => d.items)).toEqual([]);
    expect(pub.lastUpdated).toBeNull();
  });
});

describe("AT-37 / FR-EVT-03: official dates on every schedule header", () => {
  it("lists 17–20 December 2026 with 17 December as the pre-event day", async () => {
    const days = (await publicEvent()).json.edition.days;
    expect(days.map((d: { date: string }) => d.date)).toEqual(["2026-12-17", "2026-12-18", "2026-12-19", "2026-12-20"]);
    expect(days[0].label).toBe("Thursday, 17 December 2026 · Pre-event day");
    expect(days.slice(1).map((d: { label: string }) => d.label)).toEqual(["Friday, 18 December 2026", "Saturday, 19 December 2026", "Sunday, 20 December 2026"]);
    expect(days.filter((d: { preEvent: boolean }) => d.preEvent)).toHaveLength(1);
  });

  it("refuses a schedule day outside the event days, in the API and in the database", async () => {
    const r = await create(MANAGER, { type: "schedule_item", title: "Late session", audience: ["public"], body: { day: "2026-12-21" } });
    expect(r.status).toBe(400);
    expect(r.json.errors[0]).toMatchObject({ path: "body.day" });
    await expect(t.sql`insert into content_items (edition_id, type, title, body, audience) values (2026, 'schedule_item', 'x', '{"day":"2026-12-25"}', '{public}')`)
      .rejects.toMatchObject({ hint: "EVENT-DAY" });
  });
});

describe("TBD-24: who maintains which information, enforced on the server", () => {
  it("Management edits operational information but not the Admin's source information, and the reverse", async () => {
    const r1 = await create(MANAGER, { type: "emergency_contact", title: "Campus security", audience: ["public"], body: { phone: "+91 90000 00000" } });
    expect(r1.status).toBe(403);
    expect(r1.json.code).toBe("content_not_yours");
    const r2 = await create(ADMIN, { type: "schedule_item", title: "Extra", audience: ["public"], body: { day: "2026-12-18" } });
    expect(r2.json.code).toBe("content_not_yours");
    const seeded = await itemNamed("Startup pitches");
    expect((await t.call("PUT", `/v1/manage/content/${seeded.id}`, { as: ADMIN, body: { title: "x", audience: ["public"], body: { day: "2026-12-18" } } })).status).toBe(403);
    expect((await publish(ADMIN, seeded.id)).status).toBe(403);
    const o = (await overview(ADMIN)).json;
    expect(o).toMatchObject({ canEditSource: true, canEditOperational: false });
    expect(o.items.find((i: { id: string }) => i.id === seeded.id).canEdit).toBe(false);
  });

  it("participants and signed-out callers cannot reach the console's content", async () => {
    for (const as of [JUROR, VOLUNTEER]) expect((await overview(as)).status).toBe(403);
    expect((await t.call("GET", "/v1/manage/editions/2026/content")).status).toBe(401);
    expect((await create(JUROR, { type: "page", title: "x", audience: ["public"], body: { text: "x" } })).status).toBe(403);
  });

  it("validates every field by type", async () => {
    const bad = [
      { type: "schedule_item", title: "x", audience: ["public"], body: { day: "2026-12-18", startTime: "10:00", endTime: "09:00" } },
      { type: "schedule_item", title: "x", audience: ["public"], body: { day: "2026-12-18", colour: "red" } },
      { type: "venue", title: "Hall", audience: ["public"], body: { mapUrl: "http://maps.example/x" } },
      { type: "meal", title: "Lunch", audience: ["public", "jury_member"], body: { day: "2026-12-18", meal: "lunch" } },
      { type: "accommodation", title: "Hostel", audience: ["public"], body: {} },
    ];
    for (const body of bad) {
      const r = await create(MANAGER, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe("AT-24: a change made once appears on the website and the app, with versions and a last-updated time", () => {
  let pitches: { id: string };

  it("publishing a draft makes it visible everywhere at once", async () => {
    pitches = await itemNamed("Startup pitches");
    const draft = await t.call("PUT", `/v1/manage/content/${pitches.id}`, { as: MANAGER, body: { title: "Startup pitches", audience: ["public"],
      body: { day: "2026-12-18", startTime: "11:00", endTime: "13:00", venue: "Main auditorium", tentative: true, order: 5 } } });
    expect(draft.json).toMatchObject({ state: "draft", version: 0, live: null, draftBy: MANAGER });
    expect((await publicEvent()).json.schedule[1].items).toEqual([]);
    const p = await publish(MANAGER, pitches.id, "Pitch time and venue confirmed with the organisers");
    expect(p.json).toMatchObject({ state: "published", version: 1, draft: null, changeSummary: "Pitch time and venue confirmed with the organisers" });
    const web = (await publicEvent()).json;
    const app = (await eventAs(JUROR)).json;
    for (const v of [web, app]) {
      const day = v.schedule.find((d: { date: string }) => d.date === "2026-12-18");
      expect(day.items).toHaveLength(1);
      expect(day.items[0]).toMatchObject({ title: "Startup pitches", version: 1, body: { startTime: "11:00", venue: "Main auditorium", tentative: true } });
      expect(Date.parse(v.lastUpdated)).toBeGreaterThan(0);
    }
  });

  it("an edit stays a draft until published; then it is version 2 and everyone sees it", async () => {
    await t.call("PUT", `/v1/manage/content/${pitches.id}`, { as: MANAGER, body: { title: "Startup pitches", audience: ["public"],
      body: { day: "2026-12-18", startTime: "14:00", endTime: "16:00", venue: "Seminar hall 2", tentative: false, order: 5 } } });
    const before = (await publicEvent()).json.schedule[1].items[0];
    expect(before.body).toMatchObject({ startTime: "11:00", venue: "Main auditorium" });
    await publish(MANAGER, pitches.id, "Moved to the afternoon in seminar hall 2");
    const after = (await eventAs(VOLUNTEER)).json.schedule[1].items[0];
    expect(after).toMatchObject({ version: 2, body: { startTime: "14:00", venue: "Seminar hall 2", tentative: false } });
    const versions = (await t.call("GET", `/v1/manage/content/${pitches.id}/versions`, { as: ADMIN })).json;
    expect(versions.map((v: { version: number; publishedBy: string }) => [v.version, v.publishedBy])).toEqual([[2, MANAGER], [1, MANAGER]]);
    expect(versions[0].changeSummary).toBe("Moved to the afternoon in seminar hall 2");
    const [a] = await t.sql<{ data: { previous: { body: { startTime: string } } } }[]>`
      select data from audit_events where action = 'content.published' and entity_id = ${pitches.id} order by id desc limit 1`;
    expect(a!.data.previous.body.startTime).toBe("11:00");
  });

  it("a publish needs a change summary; a discarded draft leaves the live version untouched", async () => {
    await t.call("PUT", `/v1/manage/content/${pitches.id}`, { as: MANAGER, body: { title: "Wrong", audience: ["public"], body: { day: "2026-12-18" } } });
    expect((await t.call("POST", `/v1/manage/content/${pitches.id}/publish`, { as: MANAGER, body: {} })).status).toBe(400);
    expect((await t.call("POST", `/v1/manage/content/${pitches.id}/discard-draft`, { as: MANAGER })).json).toMatchObject({ draft: null, version: 2 });
    expect((await publish(MANAGER, pitches.id)).json.code).toBe("nothing_to_publish");
  });

  it("the live version changes only by publishing, and history is never rewritten or deleted (database rules)", async () => {
    await expect(t.sql`update content_items set body = '{"day":"2026-12-18","startTime":"23:00"}' where id = ${pitches.id}`)
      .rejects.toMatchObject({ hint: "CONTENT-PUBLISH" });
    await expect(t.sql`delete from content_items where id = ${pitches.id}`).rejects.toMatchObject({ hint: "CONTENT-HISTORY" });
    await expect(t.sql`update content_versions set title = 'x'`).rejects.toMatchObject({ hint: "APPEND-ONLY" });
    await expect(t.sql`delete from content_versions`).rejects.toMatchObject({ hint: "APPEND-ONLY" });
  });
});

describe("FR-EVT-17: audiences decide who sees what", () => {
  it("a jury-only item reaches jurors only; a participants item reaches participants but not the public", async () => {
    const jury = (await create(MANAGER, { type: "schedule_item", title: "Jury briefing", audience: ["jury_member"],
      body: { day: "2026-12-18", startTime: "09:00", venue: "Board room" } })).json;
    await publish(MANAGER, jury.id);
    const all = (await create(MANAGER, { type: "accommodation", title: "Participant hostels", audience: ["participants"],
      body: { text: "Rooms are in the campus guest houses." } })).json;
    await publish(MANAGER, all.id);
    const titles = (v: { schedule: { items: { title: string }[] }[]; accommodation: { title: string }[] }) =>
      [...v.schedule.flatMap((d) => d.items.map((i) => i.title)), ...v.accommodation.map((a) => a.title)];
    expect(titles((await eventAs(JUROR)).json)).toEqual(expect.arrayContaining(["Jury briefing", "Participant hostels"]));
    expect(titles((await eventAs(VOLUNTEER)).json)).not.toContain("Jury briefing");
    expect(titles((await eventAs(VOLUNTEER)).json)).toContain("Participant hostels");
    expect(titles((await publicEvent()).json)).not.toContain("Jury briefing");
    expect(titles((await publicEvent()).json)).not.toContain("Participant hostels");
  });

  it("a 2027-only participant cannot open the 2026 participant view (AT-09); the public view is open to all", async () => {
    expect((await eventAs(ONLY27)).json.code).toBe("no_edition_access");
    expect((await eventAs(ONLY27, 2027)).status).toBe(200);
    expect((await t.call("GET", "/v1/public/editions/2026/event", { as: ONLY27 })).status).toBe(200);
  });

  it("archived items disappear and cannot be edited again", async () => {
    const all = await itemNamed("Participant hostels");
    expect((await t.call("POST", `/v1/manage/content/${all.id}/archive`, { as: MANAGER, body: { reason: "Moved to the travel page" } })).json.state).toBe("archived");
    expect((await eventAs(VOLUNTEER)).json.accommodation).toEqual([]);
    expect((await t.call("PUT", `/v1/manage/content/${all.id}`, { as: MANAGER, body: { title: "x", audience: ["public"], body: { text: "x" } } })).json.code)
      .toBe("content_archived");
  });
});

describe("TBD-07 / FR-EVT-11: emergency contacts", () => {
  it("always lists 112 first; the Admin adds venue contacts after it", async () => {
    expect((await publicEvent()).json.emergency).toEqual([{ id: null, title: "National emergency number (police, fire, ambulance)", phone: "112" }]);
    const c = (await create(ADMIN, { type: "emergency_contact", title: "Campus medical room", audience: ["participants"],
      body: { phone: "+91 98765 43210", available: "24 hours on 17–20 December" } })).json;
    await publish(ADMIN, c.id, "Added the medical room");
    const e = (await eventAs(DELEGATE)).json.emergency;
    expect(e.map((x: { phone: string }) => x.phone)).toEqual(["112", "+91 98765 43210"]);
    expect((await publicEvent()).json.emergency).toHaveLength(1);
  });
});

describe("TBD-51: documents in private storage, reached only through short-lived links", () => {
  let doc: { id: string };
  const upload = (as: string, extra: Record<string, unknown> = {}) => t.call("POST", "/v1/manage/editions/2026/documents", { as,
    body: { title: "Jury handbook", audience: ["jury_member"], fileName: "jury-handbook.pdf", contentType: "application/pdf",
      dataBase64: PDF.toString("base64"), ...extra } });

  it("only the Admin uploads documents; the content must match its declared type", async () => {
    expect((await upload(MANAGER)).json.code).toBe("content_not_yours");
    expect((await upload(JUROR)).status).toBe(403);
    const fake = await upload(ADMIN, { dataBase64: Buffer.from("MZ\x90\x00 not a pdf").toString("base64") });
    expect(fake.status).toBe(400);
    expect(fake.json.errors[0].path).toBe("file");
    expect((await upload(ADMIN, { contentType: "application/x-msdownload" })).status).toBe(400);
    expect((await upload(ADMIN, { dataBase64: "@@@not-base64@@@" })).status).toBe(400);
    const r = await upload(ADMIN);
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ title: "Jury handbook", version: 1, sizeBytes: PDF.length, uploadedBy: ADMIN, audience: ["jury_member"] });
    doc = r.json;
  });

  it("a document restricted to jurors is listed and opened by jurors only (AT-24)", async () => {
    expect((await eventAs(JUROR)).json.documents.map((d: { id: string }) => d.id)).toEqual([doc.id]);
    expect((await eventAs(VOLUNTEER)).json.documents).toEqual([]);
    expect((await publicEvent()).json.documents).toEqual([]);
    expect((await t.call("GET", `/v1/editions/2026/documents/${doc.id}/link`, { as: VOLUNTEER })).status).toBe(404);
    expect((await t.call("GET", `/v1/public/editions/2026/documents/${doc.id}/link`)).status).toBe(404);
    const link = (await t.call("GET", `/v1/editions/2026/documents/${doc.id}/link`, { as: JUROR })).json;
    expect(link.url).toMatch(/^\/v1\/files\//);
    const file = await t.app.inject({ method: "GET", url: link.url });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("application/pdf");
    expect(file.headers["cache-control"]).toContain("no-store");
    expect(file.rawPayload.equals(PDF)).toBe(true);
  });

  it("links expire after 60 seconds and cannot be forged", async () => {
    const link = (await t.call("GET", `/v1/editions/2026/documents/${doc.id}/link`, { as: JUROR })).json;
    const [id, exp] = link.url.replace("/v1/files/", "").split(".");
    expect((await t.app.inject({ method: "GET", url: `/v1/files/${id}.${exp}.AAAAAAAAAAAAAAAAAAAAAA` })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "GET", url: `/v1/files/${id}.${Number(exp) + 3600}.${link.url.split(".")[2]}` })).statusCode).toBe(404);
    const start = t.now();
    t.setNow(new Date(start.getTime() + 61_000));
    expect((await t.app.inject({ method: "GET", url: link.url })).json().code).toBe("link_expired");
    t.setNow(start);
  });

  it("a replacement is version 2; the old file is archived and kept; documents are never edited (database)", async () => {
    const r = await upload(ADMIN, { replacesId: doc.id, fileName: "jury-handbook-v2.pdf" });
    expect(r.json).toMatchObject({ version: 2, replacesId: doc.id });
    expect((await eventAs(JUROR)).json.documents.map((d: { version: number }) => d.version)).toEqual([2]);
    expect((await t.call("GET", `/v1/editions/2026/documents/${doc.id}/link`, { as: JUROR })).status).toBe(404);
    expect((await upload(ADMIN, { replacesId: doc.id })).json.code).toBe("document_archived");
    await expect(t.sql`update documents set audience = '{public}' where id = ${r.json.id}`).rejects.toMatchObject({ hint: "CONTENT-HISTORY" });
    await expect(t.sql`delete from documents`).rejects.toMatchObject({ hint: "CONTENT-HISTORY" });
    const actions = await t.sql<{ action: string }[]>`select action from audit_events where entity_type = 'document' order by id`;
    expect(actions.map((a) => a.action)).toEqual(["document.uploaded", "document.replaced"]);
  });

  it("Management and the Admin can open any document from the console", async () => {
    const all = (await overview()).json.documents;
    expect(all).toHaveLength(2);
    expect((await t.call("GET", `/v1/manage/documents/${all[0].id}/link`, { as: MANAGER })).status).toBe(200);
    expect((await t.call("GET", `/v1/manage/documents/${all[0].id}/link`, { as: JUROR })).status).toBe(403);
  });
});

describe("Supabase Storage adapter (request format; live bucket not yet verified)", () => {
  it("uploads with the service key to a private bucket and signs 60-second download links", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(url.includes("/sign/") ? JSON.stringify({ signedURL: "/object/sign/event-documents/2026/abc/file.pdf?token=t" }) : "{}", { status: 200 });
    }) as unknown as typeof fetch;
    const s = supabaseStore({ url: "https://ref.supabase.co/", serviceRoleKey: "service-key", bucket: "event-documents", fetchImpl });
    await s.put(t.sql, "2026/abc/file.pdf", PDF, "application/pdf");
    const link = await s.link({ id: "00000000-0000-4000-8000-000000000001", key: "2026/abc/file.pdf", fileName: "file.pdf" }, new Date("2026-12-18T04:30:00Z"));
    expect(calls[0]!.url).toBe("https://ref.supabase.co/storage/v1/object/event-documents/2026/abc/file.pdf");
    expect(calls[0]!.init.headers).toMatchObject({ authorization: "Bearer service-key", "content-type": "application/pdf", "x-upsert": "false" });
    expect(calls[1]!.url).toBe("https://ref.supabase.co/storage/v1/object/sign/event-documents/2026/abc/file.pdf");
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ expiresIn: 60, download: "file.pdf" });
    expect(link).toEqual({ url: "https://ref.supabase.co/storage/v1/object/sign/event-documents/2026/abc/file.pdf?token=t", expiresAt: "2026-12-18T04:31:00.000Z" });
  });
});
