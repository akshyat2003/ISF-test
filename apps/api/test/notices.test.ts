// Phase 7: notices and push notifications (FR-NOT-01…08, AT-25, AT-09; TBD-29, TBD-52).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkPushReceipts, dispatchOutbox, expoPushSender } from "../src/modules/notifications/outbox.js";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
const MANAGER = "manager@notice.test", ADMIN = "admin@notice.test";
const J1 = "j1@notice.test", J2 = "j2@notice.test", V1 = "v1@notice.test", V2 = "v2@notice.test", D1 = "d1@notice.test";
const ONLY27 = "only27@notice.test", APPLICANT = "applicant@notice.test";
const TOKEN = (n: string) => `ExponentPushToken[${n.padEnd(22, "x")}]`;
const ids: Record<string, string> = {};
let leader: { id: string; leaderId: string };

beforeAll(async () => {
  t = await createTestApp();
  await t.staff(MANAGER, ["management"]);
  await t.staff(ADMIN, ["admin"]);
  for (const [e, r] of [[J1, "jury_member"], [J2, "jury_member"], [V1, "volunteer"], [V2, "volunteer"], [D1, "delegate"]] as const) {
    ids[e] = await t.participant(e, r);
  }
  ids[ONLY27] = await t.participant(ONLY27, "jury_member", 2027);
  leader = await t.startup("Alpha", "lead@notice.test");
  ids[APPLICANT] = await t.staff(APPLICANT, ["startup_team_leader"]);   // a role but no 2026 event access
  // Devices: J1 and V1 have the app with push; J2 has none.
  for (const [e, n] of [[J1, "jone"], [V1, "vone"], [ONLY27, "only27"], [APPLICANT, "applicant"]] as const) {
    expect((await t.call("POST", "/v1/me/push-tokens", { as: e, body: { token: TOKEN(n), platform: "android" } })).status).toBe(200);
  }
});
afterAll(async () => { await t.close(); });

const publish = (body: unknown, as = MANAGER) => t.call("POST", "/v1/manage/editions/2026/notices", { as, body });
const inbox = async (as: string) => (await t.call("GET", "/v1/me/notifications", { as })).json.filter((n: { kind: string }) => n.kind === "notice");
const pushRows = (noticeId: string) => t.sql<{ recipient: string; status: string; title: string; body: string; userId: string; providerRef: string | null }[]>`
  select recipient, status, title, body, user_id as "userId", provider_ref as "providerRef" from notifications
  where notice_id = ${noticeId} and channel = 'push' order by recipient`;

describe("devices (push tokens)", () => {
  it("accepts only Expo push tokens; a device follows the account last signed in on it", async () => {
    expect((await t.call("POST", "/v1/me/push-tokens", { as: J2, body: { token: "not-a-token", platform: "android" } })).status).toBe(400);
    expect((await t.call("POST", "/v1/me/push-tokens", { as: J2, body: { token: TOKEN("shared"), platform: "ios" } })).status).toBe(200);
    await t.call("POST", "/v1/me/push-tokens", { as: V2, body: { token: TOKEN("shared"), platform: "ios" } });
    const [row] = await t.sql<{ userId: string }[]>`select user_id as "userId" from push_tokens where token = ${TOKEN("shared")}`;
    expect(row!.userId).toBe(ids[V2]);
    expect((await t.call("DELETE", "/v1/me/push-tokens", { as: V2, body: { token: TOKEN("shared") } })).json).toEqual({ removed: true });
    expect((await t.call("POST", "/v1/me/push-tokens", { body: { token: TOKEN("anon"), platform: "ios" } })).status).toBe(401);
  });
});

describe("FR-NOT-01: only Management publishes notices", () => {
  it("refuses the Admin, participants and signed-out callers", async () => {
    const body = { title: "x", body: "y", audience: { kind: "everyone" } };
    expect((await publish(body, ADMIN)).status).toBe(403);
    expect((await publish(body, J1)).status).toBe(403);
    expect((await t.call("POST", "/v1/manage/editions/2026/notices", { body })).status).toBe(401);
    expect((await t.call("GET", "/v1/manage/editions/2026/notices", { as: ADMIN })).status).toBe(403);
  });

  it("validates the audience", async () => {
    expect((await publish({ title: "x", body: "y", audience: { kind: "roles", roles: [] } })).status).toBe(400);
    expect((await publish({ title: "x", body: "y", audience: { kind: "roles", roles: ["management"] } })).status).toBe(400);
    expect((await publish({ title: "x", body: "y", audience: { kind: "group", groupId: "00000000-0000-4000-8000-000000000000" } })).json.errors[0].path)
      .toBe("audience.groupId");
  });
});

describe("AT-25: a jury-only notice reaches jurors in-app and by push, and no other role", () => {
  let notice: { id: string };

  it("previews the recipients before publishing", async () => {
    const p = await t.call("POST", "/v1/manage/editions/2026/notices/preview", { as: MANAGER, body: { audience: { kind: "roles", roles: ["jury_member"] } } });
    expect(p.json).toEqual({ recipients: 2, withDevice: 1, devices: 1 });   // the 2027-only juror is not counted (FR-NOT-05)
  });

  it("publishes: both 2026 jurors get it in-app; J1's device gets one queued push; nobody else gets anything", async () => {
    const r = await publish({ title: "Jury briefing moved", body: "The jury briefing is now at 09:00 in the board room.",
      audience: { kind: "roles", roles: ["jury_member"] }, sendPush: true });
    expect(r.status).toBe(201);
    notice = r.json;
    expect(r.json).toMatchObject({ recipients: 2, audienceLabel: "Jury members", sendPush: true,
      delivery: { inApp: { total: 2, read: 0 }, push: { queued: 1, sent: 0, failed: 0, cancelled: 0 } } });
    for (const e of [J1, J2]) expect((await inbox(e)).map((n: { title: string }) => n.title)).toEqual(["Jury briefing moved"]);
    for (const e of [V1, V2, D1, ONLY27, APPLICANT, leader.leaderId && "lead@notice.test"]) expect(await inbox(e)).toEqual([]);
    const rows = await pushRows(notice.id);
    expect(rows).toEqual([expect.objectContaining({ recipient: TOKEN("jone"), status: "queued", userId: ids[J1] })]);
  });

  it("delivery is tracked truthfully: the push goes out through the outbox and is recorded as handed to Expo", async () => {
    const sent: unknown[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ data: { status: "ok", id: "ticket-1" } }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await dispatchOutbox(t.sql, [expoPushSender({ fetchImpl })], t.now());
    expect(r).toEqual({ sent: 1, retrying: 0, failed: 0 });
    expect(sent).toEqual([{ to: TOKEN("jone"), title: "Jury briefing moved", body: "The jury briefing is now at 09:00 in the board room.",
      data: { noticeId: notice.id, year: 2026 }, sound: "default", priority: "high" }]);
    expect((await pushRows(notice.id))[0]).toMatchObject({ status: "sent", providerRef: "ticket-1" });
    const view = (await t.call("GET", "/v1/manage/editions/2026/notices", { as: MANAGER })).json.notices[0];
    expect(view.delivery.push).toEqual({ queued: 0, sent: 1, failed: 0, cancelled: 0 });
  });

  it("opening the notice counts as read", async () => {
    const [n] = await inbox(J2);
    expect((await t.call("POST", `/v1/me/notifications/${n.id}/read`, { as: J2 })).json).toEqual({ read: true });
    expect((await t.call("POST", `/v1/me/notifications/${n.id}/read`, { as: J1 })).status).toBe(404);   // not J1's message
    const view = (await t.call("GET", "/v1/manage/editions/2026/notices", { as: MANAGER })).json.notices[0];
    expect(view.delivery.inApp).toEqual({ total: 2, read: 1 });
  });

  it("a receipt error marks the push failed and disables a device that no longer exists", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ data: { "ticket-1": { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } } } }),
      { status: 200 })) as unknown as typeof fetch;
    const later = new Date(t.now().getTime() + 20 * 60_000);
    expect(await checkPushReceipts(t.sql, { fetchImpl }, later)).toEqual({ checked: 1, failed: 1 });
    expect((await pushRows(notice.id))[0]!.status).toBe("failed");
    const [tok] = await t.sql<{ disabledReason: string }[]>`select disabled_reason as "disabledReason" from push_tokens where token = ${TOKEN("jone")}`;
    expect(tok!.disabledReason).toBe("DeviceNotRegistered");
    // Re-registering the device (the app does this at sign-in) enables it again.
    await t.call("POST", "/v1/me/push-tokens", { as: J1, body: { token: TOKEN("jone"), platform: "android" } });
    const [again] = await t.sql<{ disabledAt: Date | null }[]>`select disabled_at as "disabledAt" from push_tokens where token = ${TOKEN("jone")}`;
    expect(again!.disabledAt).toBeNull();
  });
});

describe("FR-NOT-05 / AT-09: audiences never cross editions", () => {
  it("a notice to everyone in 2026 reaches 2026 participants only: not the 2027-only juror, staff or an applicant without access", async () => {
    const r = await publish({ title: "Welcome to Startup Jathara 2026", body: "Programme details are in the app.", audience: { kind: "everyone" }, sendPush: true });
    expect(r.json.recipients).toBe(6);   // J1, J2, V1, V2, D1 and the startup leader
    for (const e of [ONLY27, APPLICANT, MANAGER]) expect(await inbox(e)).toEqual([]);
    const devices = (await pushRows(r.json.id)).map((x) => x.recipient);
    expect(devices.sort()).toEqual([TOKEN("jone"), TOKEN("vone")].sort());
  });

  it("refuses to publish to an audience with nobody in it", async () => {
    const r = await publish({ title: "x", body: "y", audience: { kind: "roles", roles: ["startup_team_member"] } });
    expect(r.json.code).toBe("no_recipients");
  });
});

describe("FR-NOT-08: named authorised groups", () => {
  let groupId: string;

  it("Management creates a group and adds members who take part in the edition only", async () => {
    const g = await t.call("POST", "/v1/manage/editions/2026/notice-groups", { as: MANAGER, body: { name: "Transport desk", description: "Volunteers at the bus stand" } });
    expect(g.status).toBe(201);
    groupId = g.json.groups.find((x: { name: string }) => x.name === "Transport desk").id;
    expect((await t.call("POST", "/v1/manage/editions/2026/notice-groups", { as: MANAGER, body: { name: "transport DESK" } })).json.code).toBe("group_exists");
    const bad = await t.call("POST", `/v1/manage/notice-groups/${groupId}/members`, { as: MANAGER, body: { userIds: [ids[V1], ids[ONLY27]] } });
    expect(bad.json.code).toBe("not_a_participant");
    const ok = await t.call("POST", `/v1/manage/notice-groups/${groupId}/members`, { as: MANAGER, body: { userIds: [ids[V1], ids[D1]] } });
    expect(ok.json.groups.find((x: { id: string }) => x.id === groupId).members.map((m: { id: string }) => m.id).sort()).toEqual([ids[V1], ids[D1]].sort());
    expect((await t.call("POST", `/v1/manage/notice-groups/${groupId}/members`, { as: ADMIN, body: { userIds: [ids[V2]] } })).status).toBe(403);
  });

  it("a notice to the group reaches only its members", async () => {
    await t.call("DELETE", `/v1/manage/notice-groups/${groupId}/members/${ids[D1]}`, { as: MANAGER });
    const r = await publish({ title: "Bus stand shift", body: "Report at 07:00 at the bus stand.", audience: { kind: "group", groupId } });
    expect(r.json).toMatchObject({ recipients: 1, audienceLabel: "Group: Transport desk" });
    expect((await inbox(V1)).map((n: { title: string }) => n.title)).toContain("Bus stand shift");
    for (const e of [V2, D1, J1]) expect((await inbox(e)).map((n: { title: string }) => n.title)).not.toContain("Bus stand shift");
  });
});

describe("FR-NOT-06: corrections and withdrawals are audited, never deletions", () => {
  let n: { id: string };

  it("a correction reaches every inbox and any push not yet sent; the audit keeps the previous text and the reason", async () => {
    n = (await publish({ title: "Dinner at 19:00", body: "Networking dinner at 19:00 in the main lawn.", audience: { kind: "roles", roles: ["volunteer", "delegate"] },
      sendPush: true })).json;
    expect((await t.call("PUT", `/v1/manage/notices/${n.id}`, { as: MANAGER, body: { title: "Dinner at 19:30" } })).status).toBe(400);   // no reason
    const e = await t.call("PUT", `/v1/manage/notices/${n.id}`, { as: MANAGER,
      body: { title: "Dinner at 19:30", body: "Networking dinner at 19:30 in the main lawn.", reason: "Time changed by the organisers" } });
    expect(e.json).toMatchObject({ title: "Dinner at 19:30", editedBy: MANAGER });
    expect((await inbox(D1)).find((x: { id: string; title: string }) => x.title.startsWith("Dinner")).body).toBe("Networking dinner at 19:30 in the main lawn.");
    expect((await pushRows(n.id))[0]).toMatchObject({ status: "queued", title: "Dinner at 19:30", body: "Networking dinner at 19:30 in the main lawn." });
    const [a] = await t.sql<{ data: { reason: string; previous: { title: string } } }[]>`select data from audit_events where action = 'notice.edited' and entity_id = ${n.id}`;
    expect(a!.data).toMatchObject({ reason: "Time changed by the organisers", previous: { title: "Dinner at 19:00" } });
  });

  it("withdrawing hides it from every inbox and cancels pushes not yet sent; it cannot change afterwards", async () => {
    const w = await t.call("POST", `/v1/manage/notices/${n.id}/withdraw`, { as: MANAGER, body: { reason: "Published twice" } });
    expect(w.json).toMatchObject({ withdrawnBy: MANAGER, withdrawReason: "Published twice", delivery: { push: { queued: 0, cancelled: 1 } } });
    expect((await inbox(D1)).map((x: { title: string }) => x.title)).not.toContain("Dinner at 19:30");
    expect((await t.call("PUT", `/v1/manage/notices/${n.id}`, { as: MANAGER, body: { title: "x", reason: "y" } })).json.code).toBe("notice_withdrawn");
    expect((await dispatchOutbox(t.sql, [expoPushSender({ fetchImpl: (async () => { throw new Error("must not send"); }) as unknown as typeof fetch })], t.now()))
      .sent).toBe(0);
    const actions = (await t.sql<{ action: string }[]>`select action from audit_events where entity_id = ${n.id} order by id`).map((x) => x.action);
    expect(actions).toEqual(["notice.published", "notice.edited", "notice.withdrawn"]);
  });

  it("the database refuses deleting a notice or changing its audience", async () => {
    const [any] = await t.sql<{ id: string }[]>`select id from notices where withdrawn_at is null limit 1`;
    await expect(t.sql`delete from notices where id = ${any!.id}`).rejects.toMatchObject({ hint: "NOTICE-HISTORY" });
    await expect(t.sql`update notices set audience = '{"kind":"everyone"}' where id = ${any!.id}`).rejects.toMatchObject({ hint: "NOTICE-HISTORY" });
    await expect(t.sql`update notices set title = 'x' where id = ${n.id}`).rejects.toMatchObject({ hint: "NOTICE-HISTORY" });
  });
});

describe("Expo push adapter: failures", () => {
  it("a DeviceNotRegistered ticket fails at once (no retries) and disables the device; other errors are retried", async () => {
    await t.call("POST", "/v1/me/push-tokens", { as: V2, body: { token: TOKEN("vtwo"), platform: "ios" } });
    const r = (await publish({ title: "Shift change", body: "New shifts are posted.", audience: { kind: "roles", roles: ["volunteer"] }, sendPush: true })).json;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      const to = JSON.parse(String(init.body)).to as string;
      if (to === TOKEN("vtwo")) return new Response(JSON.stringify({ data: { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } } }), { status: 200 });
      return new Response("upstream down", { status: 503 });
    }) as unknown as typeof fetch;
    expect(await dispatchOutbox(t.sql, [expoPushSender({ fetchImpl })], t.now())).toEqual({ sent: 0, retrying: 1, failed: 1 });
    const rows = await pushRows(r.id);
    expect(rows.find((x) => x.recipient === TOKEN("vtwo"))!.status).toBe("failed");
    expect(rows.find((x) => x.recipient === TOKEN("vone"))!.status).toBe("queued");
    const [tok] = await t.sql<{ disabledAt: Date | null }[]>`select disabled_at as "disabledAt" from push_tokens where token = ${TOKEN("vtwo")}`;
    expect(tok!.disabledAt).not.toBeNull();
  });

  it("every notice action is audited", async () => {
    // Sorted here, not in SQL: "." and "_" order differently under different database collations (CI uses en_US).
    const rows = await t.sql<{ action: string }[]>`select distinct action from audit_events where action like 'notice%'`;
    expect(rows.map((r) => r.action).sort()).toEqual(["notice.edited", "notice.published", "notice.withdrawn", "notice_group.created",
      "notice_group.member_removed", "notice_group.members_added"]);
  });
});
