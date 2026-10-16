// Phase 8: support tickets, emergency alerts, acknowledgement tracking and overdue escalation (FR-SUP-*, FR-HD-10/11,
// AT-31, AT-32; DC-08; TBD-27 windows as configured defaults, awaiting organisers).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sweepSupport } from "../src/modules/support/sweep.js";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
const S1 = "s1@sup.test", S2 = "s2@sup.test", MANAGER = "manager@sup.test", ADMIN = "admin@sup.test";
const P1 = "p1@sup.test", P2 = "p2@sup.test", P3 = "p3@sup.test", P27 = "p27@sup.test";
const ids: Record<string, string> = {};
const min = (n: number) => n * 60_000;
const at = (base: Date, minutes: number) => new Date(base.getTime() + min(minutes));

const emergency = (as: string, clientRequestId = randomUUID(), year = 2026, message?: string) =>
  t.call("POST", `/v1/editions/${year}/emergency`, { as, body: { clientRequestId, ...(message ? { message } : {}) } });
const ownTicket = (as: string, subject: string) => t.call("POST", "/v1/me/tickets", { as, body: { edition: 2026, subject } });
const act = (as: string, id: string, path: string, body?: unknown) => t.call("POST", `/v1/support/tickets/${id}/${path}`, { as, body });
const ticketRow = async (id: string) => (await t.sql<Record<string, any>[]>`select * from support_tickets where id = ${id}`)[0]!;
const alertsFor = (ticketId: string) => t.sql<{ recipient: string; reason: string; round: number }[]>`
  select recipient_id as recipient, reason, round from support_alerts where ticket_id = ${ticketId} order by id`;

beforeAll(async () => {
  t = await createTestApp();
  ids[S1] = await t.staff(S1, ["customer_support"]);
  ids[S2] = await t.staff(S2, ["customer_support"]);
  ids[MANAGER] = await t.staff(MANAGER, ["management"]);
  ids[ADMIN] = await t.staff(ADMIN, ["admin"]);
  ids[P1] = await t.participant(P1, "delegate", 2026, { name: "Delegate One", mobile: "+919100000001" });
  ids[P2] = await t.participant(P2, "volunteer", 2026, { name: "Volunteer Two" });
  ids[P3] = await t.participant(P3, "delegate", 2026, { name: "Delegate Three" });
  ids[P27] = await t.participant(P27, "delegate", 2027, { name: "Only 2027" });
});
afterAll(async () => { await t.close(); });

describe("the emergency control (FR-HD-10/11, AT-31)", () => {
  let ticketId: string;
  const first = randomUUID();

  it("returns 112 first, raises a high-priority emergency ticket and alerts every active support person", async () => {
    const r = await emergency(P1, first, 2026, "Fell on the stairs near hall B");
    expect(r.status).toBe(200);
    expect(r.json.contacts[0]).toEqual({ title: "National emergency number (police, fire, ambulance)", phone: "112" });
    expect(r.json).toMatchObject({ alerted: 2, reportedAgain: false, ticket: { ref: expect.stringMatching(/^SJ-\d{6}$/) } });
    ticketId = r.json.ticket.id;
    const row = await ticketRow(ticketId);
    expect(row).toMatchObject({ status: "Open", priority: "high", is_emergency: true, source: "emergency_control", requester_id: ids[P1],
      description: "Fell on the stairs near hall B" });
    expect(row.ack_due_at.getTime() - row.created_at.getTime()).toBe(min(5));   // TBD-27 default, awaiting organisers
    expect((await alertsFor(ticketId)).map((a) => [a.reason, a.round])).toEqual([["emergency", 0], ["emergency", 0]]);
  });

  it("a retry of the same tap returns the same ticket and alerts nobody again", async () => {
    const r = await emergency(P1, first);
    expect(r.json).toMatchObject({ ticket: { id: ticketId }, alerted: 0, reportedAgain: false });
    expect(await alertsFor(ticketId)).toHaveLength(2);
  });

  it("pressing again while the emergency is open adds to that ticket and re-alerts at once (TBD-55)", async () => {
    const r = await emergency(P1, randomUUID(), 2026, "Still waiting, the pain is worse");
    expect(r.json).toMatchObject({ ticket: { id: ticketId }, reportedAgain: true, alerted: 2 });
    expect((await alertsFor(ticketId)).filter((a) => a.reason === "reported_again").map((a) => a.round)).toEqual([1, 1]);
    const { n } = (await t.sql<{ n: number }[]>`select count(*)::int as n from support_tickets where requester_id = ${ids[P1]!}`)[0]!;
    expect(n).toBe(1);
  });

  it("two simultaneous emergency reports from one person open exactly one ticket", async () => {
    const [a, b] = await Promise.all([emergency(P2), emergency(P2)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.json.ticket.id).toBe(b.json.ticket.id);
    expect([a.json.reportedAgain, b.json.reportedAgain].sort()).toEqual([false, true]);
    const { n } = (await t.sql<{ n: number }[]>`select count(*)::int as n from support_tickets where requester_id = ${ids[P2]!}`)[0]!;
    expect(n).toBe(1);
  });

  it("is never gated on a role or edition access, and an unknown edition still returns the contacts", async () => {
    const r = await emergency(P27, randomUUID(), 2026);
    expect(r.json.ticket).not.toBeNull();
    const u = await emergency(P1, randomUUID(), 2099);
    expect(u.status).toBe(200);
    expect(u.json).toMatchObject({ ticket: null, alerted: 0, contacts: [{ phone: "112" }] });
    expect((await t.call("POST", "/v1/editions/2026/emergency", { body: { clientRequestId: randomUUID() } })).status).toBe(401);
  });

  it("the requester sees their emergency under My requests; others never see it", async () => {
    const mine = (await t.call("GET", "/v1/me/tickets", { as: P1 })).json;
    expect(mine[0]).toMatchObject({ id: ticketId, isEmergency: true, status: "Open" });
    expect(mine[0].updates.map((u: { kind: string }) => u.kind)).toEqual(["created", "requester_note"]);
    expect((await t.call("GET", "/v1/me/tickets", { as: P3 })).json.map((x: { id: string }) => x.id)).not.toContain(ticketId);
    expect((await t.call("POST", `/v1/me/tickets/${ticketId}/notes`, { as: P3, body: { text: "hi" } })).status).toBe(404);
  });
});

describe("with no active support staff, Management is alerted instead", () => {
  it("an emergency is never unseen", async () => {
    const t2 = await createTestApp();
    try {
      const m = await t2.staff("m@nostaff.test", ["management"]);
      await t2.participant("d@nostaff.test", "delegate");
      const r = await t2.call("POST", "/v1/editions/2026/emergency", { as: "d@nostaff.test", body: { clientRequestId: randomUUID() } });
      expect(r.json.alerted).toBe(1);
      const rows = await t2.sql`select recipient_id as recipient, reason from support_alerts`;
      expect(rows).toEqual([{ recipient: m, reason: "no_support_staff" }]);
    } finally {
      await t2.close();
    }
  });
});

describe("alerts for staff and acknowledgement tracking", () => {
  it("support staff see their unseen alerts and mark them seen once; others cannot", async () => {
    const r = (await t.call("GET", "/v1/support/alerts", { as: S1 })).json;
    expect(r.unacknowledgedEmergencies).toBeGreaterThanOrEqual(2);
    const a = r.alerts.find((x: { isEmergency: boolean }) => x.isEmergency);
    expect(a).toMatchObject({ ref: expect.stringMatching(/^SJ-/), reason: expect.any(String) });
    expect((await t.call("POST", `/v1/support/alerts/${a.id}/seen`, { as: S1 })).json).toEqual({ seen: true });
    expect((await t.call("POST", `/v1/support/alerts/${a.id}/seen`, { as: S1 })).status).toBe(200);
    expect((await t.call("POST", `/v1/support/alerts/${a.id}/seen`, { as: S2 })).status).toBe(404);
    expect((await t.call("GET", "/v1/support/alerts", { as: P1 })).status).toBe(403);
    expect((await t.call("GET", "/v1/support/alerts", { as: ADMIN })).status).toBe(403);
    await expect(t.sql`update support_alerts set seen_at = now() where id = ${a.id}`).rejects.toMatchObject({ hint: "APPEND-ONLY" });
    await expect(t.sql`delete from support_alerts`).rejects.toMatchObject({ hint: "APPEND-ONLY" });
  });
});

describe("AT-32: the ticket lifecycle (DC-08)", () => {
  let id: string;

  it("a requester raises a normal ticket; support sees it in the queue with the authorised requester details, and the view is audited", async () => {
    const r = await ownTicket(P3, "My delegate badge has the wrong name");
    expect(r.status).toBe(201);
    id = r.json.id;
    expect(r.json).toMatchObject({ status: "Open", priority: "normal", isEmergency: false });
    const q = (await t.call("GET", "/v1/support/tickets?edition=2026", { as: S1 })).json;
    expect(q.tickets.map((x: { id: string }) => x.id)).toContain(id);
    expect(q.tickets[0].isEmergency).toBe(true);   // emergencies first
    const d = (await t.call("GET", `/v1/support/tickets/${id}`, { as: S1 })).json;
    expect(d.requester).toMatchObject({ id: ids[P3], name: "Delegate Three", email: P3, roles: ["delegate"] });
    expect(Object.keys(d.requester).sort()).toEqual(["email", "id", "mobile", "name", "roles", "startup"]);
    expect(d.canEdit).toBe(true);
    const { n } = (await t.sql<{ n: number }[]>`select count(*)::int as n from audit_events where action = 'support.ticket_viewed' and entity_id = ${id}`)[0]!;
    expect(n).toBe(1);
  });

  it("the status cannot skip acknowledgement, in the API and in the database", async () => {
    expect((await act(S1, id, "status", { status: "In Progress" })).json.code).toBe("invalid_transition");
    await expect(t.sql`update support_tickets set status = 'In Progress', acknowledged_at = now() where id = ${id}`)
      .rejects.toMatchObject({ hint: "TICKET-LIFECYCLE" });
  });

  it("two people acknowledging at once: exactly one succeeds, the other is told", async () => {
    const [a, b] = await Promise.all([act(S1, id, "acknowledge"), act(S2, id, "acknowledge")]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.json.code).toBe("already_acknowledged");
    const row = await ticketRow(id);
    expect(row.status).toBe("Acknowledged");
    expect([ids[S1], ids[S2]]).toContain(row.acknowledged_by);
    expect(row.assignee_id).toBe(row.acknowledged_by);
    const evs = await t.sql`select 1 from ticket_events where ticket_id = ${id} and kind = 'status'`;
    expect(evs).toHaveLength(1);
  });

  it("the requester is told about status changes and replies, never about internal notes", async () => {
    await act(S1, id, "notes", { text: "Badge printer is in the registration tent", visibility: "internal" });
    await act(S1, id, "notes", { text: "Please collect a reprinted badge at the registration desk.", visibility: "requester" });
    await act(S1, id, "contact", { method: "phone", outcome: "Called; will collect at 2 pm" });
    const mine = (await t.call("GET", "/v1/me/tickets", { as: P3 })).json.find((x: { id: string }) => x.id === id);
    const texts = mine.updates.map((u: { text: string }) => u.text);
    expect(texts).toContain("Please collect a reprinted badge at the registration desk.");
    expect(texts.join(" ")).not.toContain("Badge printer");
    expect(texts.join(" ")).not.toContain("Called;");
    const inbox = (await t.call("GET", "/v1/me/notifications", { as: P3 })).json.filter((n: { kind: string }) => n.kind === "support_update");
    expect(inbox.map((n: { body: string }) => n.body)).toEqual(expect.arrayContaining([
      "A member of the support team has acknowledged your request.", "Please collect a reprinted badge at the registration desk.",
    ]));
  });

  it("assignment is only to active support staff, in the API and in the database", async () => {
    expect((await act(S1, id, "assign", { assigneeId: ids[MANAGER] })).json.code).toBe("not_support_staff");
    await expect(t.sql`update support_tickets set assignee_id = ${ids[MANAGER]!} where id = ${id}`).rejects.toMatchObject({ hint: "SUPPORT-STAFF" });
    expect((await act(S1, id, "assign", { assigneeId: ids[S2] })).json.assignee).toEqual({ id: ids[S2], name: S2 });
  });

  it("manual escalation is an attribute: the status stays, Management is alerted, and it cannot be repeated or withdrawn", async () => {
    const r = await act(S2, id, "escalate", { reason: "Requester is a keynote speaker" });
    expect(r.json).toMatchObject({ status: "Acknowledged", escalation: { to: "management", level: 1, reason: "Requester is a keynote speaker", by: S2 } });
    expect((await alertsFor(id)).filter((a) => a.reason === "escalation").map((a) => a.recipient)).toContain(ids[MANAGER]);
    expect((await act(S2, id, "escalate", { reason: "again" })).json.code).toBe("already_escalated");
    await expect(t.sql`update support_tickets set escalated_to = null, escalation_level = 0, escalated_at = null, escalation_reason = null, escalated_by = null where id = ${id}`)
      .rejects.toMatchObject({ hint: "TICKET-HISTORY" });
  });

  it("resolution needs notes; a resolved ticket is final, in the API and in the database", async () => {
    expect((await act(S2, id, "status", { status: "In Progress" })).json.status).toBe("In Progress");
    expect((await act(S2, id, "status", { status: "Resolved" })).status).toBe(400);
    const r = await act(S2, id, "status", { status: "Resolved", note: "Reprinted badge collected." });
    expect(r.json).toMatchObject({ status: "Resolved", resolutionNote: "Reprinted badge collected.", resolvedBy: S2, canEdit: false });
    for (const [path, body] of [["notes", { text: "x", visibility: "internal" }], ["assign", { assigneeId: null }], ["escalate", { reason: "x" }], ["priority", undefined]] as const) {
      expect((await act(S1, id, path, body)).status, path).toBe(409);
    }
    await expect(t.sql`update support_tickets set resolution_note = 'rewritten' where id = ${id}`).rejects.toMatchObject({ hint: "TICKET-LIFECYCLE" });
    await expect(t.sql`delete from support_tickets where id = ${id}`).rejects.toMatchObject({ hint: "TICKET-HISTORY" });
    await expect(t.sql`update ticket_events set detail = '{}' where ticket_id = ${id}`).rejects.toMatchObject({ hint: "APPEND-ONLY" });
    expect((await t.call("POST", `/v1/me/tickets/${id}/notes`, { as: P3, body: { text: "thanks" } })).json.code).toBe("ticket_resolved");
  });

  it("priority can be raised (tightening the window of an unacknowledged ticket) but never lowered", async () => {
    const r = await ownTicket(P3, "Lost my room key");
    const before = await ticketRow(r.json.id);
    expect(before.ack_due_at.getTime() - before.created_at.getTime()).toBe(min(120));
    expect((await act(S1, r.json.id, "priority")).json.priority).toBe("high");
    const after = await ticketRow(r.json.id);
    expect(after.ack_due_at.getTime() - after.created_at.getTime()).toBe(min(30));
    await expect(t.sql`update support_tickets set priority = 'normal' where id = ${r.json.id}`).rejects.toMatchObject({ hint: "TICKET-LIFECYCLE" });
    await expect(t.sql`update support_tickets set is_emergency = false where is_emergency`).rejects.toMatchObject({ hint: "TICKET-LIFECYCLE" });
  });

  it("support raises tickets for callers and walk-ins (FR-SUP-14); account lookup is exact only", async () => {
    expect((await t.call("GET", "/v1/support/requesters?q=sup.test", { as: S1 })).json).toEqual([]);
    expect((await t.call("GET", `/v1/support/requesters?q=${encodeURIComponent(P1)}`, { as: S1 })).json).toEqual([{ id: ids[P1], name: "Delegate One", roles: ["delegate"] }]);
    expect((await t.call("GET", "/v1/support/requesters?q=9100000001", { as: S1 })).json[0].id).toBe(ids[P1]);
    const walkIn = await t.call("POST", "/v1/support/tickets", { as: S1, body: { edition: 2026, subject: "Visitor lost a bag", contact: { name: "Ravi", phone: "+91 98111 22222" } } });
    expect(walkIn.status).toBe(201);
    expect(walkIn.json).toMatchObject({ source: "support_staff", requester: null, contact: { name: "Ravi", phone: "+91 98111 22222" }, requesterName: "Ravi" });
    const both = await t.call("POST", "/v1/support/tickets", { as: S1, body: { edition: 2026, subject: "x", requesterId: ids[P1], contact: { name: "y" } } });
    expect(both.status).toBe(400);
    const em = await t.call("POST", "/v1/support/tickets", { as: S1, body: { edition: 2026, subject: "Called in: fainted at gate", priority: "high", isEmergency: true, requesterId: ids[P1] } });
    expect(em.json).toMatchObject({ isEmergency: true, priority: "high", source: "support_staff" });
    expect((await t.call("POST", "/v1/support/tickets", { as: S1, body: { edition: 2026, subject: "x", isEmergency: true, contact: { name: "y" } } })).status).toBe(400);
  });

  it("Management reviews read-only; the Admin and participants have no access", async () => {
    const q = await t.call("GET", "/v1/support/tickets", { as: MANAGER });
    expect(q.status).toBe(200);
    expect(q.json.canEdit).toBe(false);
    const any = q.json.tickets[0].id;
    expect((await t.call("GET", `/v1/support/tickets/${any}`, { as: MANAGER })).json.canEdit).toBe(false);
    expect((await act(MANAGER, any, "acknowledge")).status).toBe(403);
    expect((await act(MANAGER, any, "notes", { text: "x", visibility: "internal" })).status).toBe(403);
    for (const as of [ADMIN, P1]) {
      expect((await t.call("GET", "/v1/support/tickets", { as })).status, as).toBe(403);
      expect((await t.call("GET", `/v1/support/tickets/${any}`, { as })).status, as).toBe(403);
      expect((await act(as, any, "acknowledge")).status, as).toBe(403);
    }
  });

  it("every support action is audited", async () => {
    const rows = await t.sql<{ action: string }[]>`select distinct action from audit_events where action like 'support.%'`;
    expect(rows.map((r) => r.action).sort()).toEqual(expect.arrayContaining([
      "support.emergency_reported", "support.emergency_reported_again", "support.requester_contacted", "support.ticket_acknowledged",
      "support.ticket_assigned", "support.ticket_created", "support.ticket_escalated", "support.ticket_note", "support.ticket_priority_raised",
      "support.ticket_reply", "support.ticket_status", "support.ticket_viewed",
    ]));
  });
});

describe("overdue escalation and re-alerts (FR-SUP-13, TBD-27 defaults)", () => {
  it("an unacknowledged emergency: re-alerted every minute, escalated to Management at 5 minutes, quiet once acknowledged", async () => {
    const base = t.now();
    const r = await emergency(P3);
    const id = r.json.ticket.id;
    expect(await sweepSupport(t.sql, at(base, 0.5))).toMatchObject({ escalated: 0 });
    let rounds = (await alertsFor(id)).filter((a) => a.reason === "reminder");
    expect(rounds).toHaveLength(0);
    await sweepSupport(t.sql, at(base, 1));
    rounds = (await alertsFor(id)).filter((a) => a.reason === "reminder");
    expect(rounds.map((a) => a.round)).toEqual([1, 1]);
    for (const m of [2, 3, 4]) await sweepSupport(t.sql, at(base, m));
    expect((await ticketRow(id)).escalation_level).toBe(0);
    await sweepSupport(t.sql, at(base, 5));
    const row = await ticketRow(id);
    expect(row).toMatchObject({ status: "Open", escalated_to: "management", escalation_level: 1, escalated_by: null, escalation_reason: "Not acknowledged within 5 minutes" });
    const esc = (await alertsFor(id)).filter((a) => a.reason === "escalation").map((a) => a.recipient);
    expect(esc.sort()).toEqual([ids[S1], ids[S2], ids[MANAGER]].sort());
    const [ev] = await t.sql<{ actor: string | null; detail: { automatic: boolean } }[]>`
      select actor_id as actor, detail from ticket_events where ticket_id = ${id} and kind = 'escalated'`;
    expect(ev).toMatchObject({ actor: null, detail: { automatic: true } });
    await sweepSupport(t.sql, at(base, 6));
    const after = (await alertsFor(id)).filter((a) => a.reason === "reminder" && a.round === 5).map((a) => a.recipient);
    expect(after).toContain(ids[MANAGER]);   // once escalated, Management is in every re-alert
    await act(S1, id, "acknowledge");
    const count = (await alertsFor(id)).length;
    await sweepSupport(t.sql, at(base, 30));
    expect(await alertsFor(id)).toHaveLength(count);
  });

  it("re-alerts stop after the configured maximum", async () => {
    await t.call("PUT", "/v1/manage/editions/2026/support-policy", { as: MANAGER, body: {
      emergencyAckMinutes: 5, highAckMinutes: 30, normalAckMinutes: 120, emergencyRealertMinutes: 1, highRealertMinutes: 10, maxRealerts: 2 } });
    const base = t.now();
    const id = (await t.call("POST", "/v1/support/tickets", { as: S1, body: { edition: 2026, subject: "Call: chest pain", priority: "high", isEmergency: true, contact: { name: "Caller" } } })).json.id;
    for (let m = 1; m <= 10; m += 1) await sweepSupport(t.sql, at(base, m));
    expect(Math.max(...(await alertsFor(id)).map((a) => a.round))).toBe(2);
    await t.call("PUT", "/v1/manage/editions/2026/support-policy", { as: MANAGER, body: {
      emergencyAckMinutes: 5, highAckMinutes: 30, normalAckMinutes: 120, emergencyRealertMinutes: 1, highRealertMinutes: 10, maxRealerts: 20 } });
  });

  it("high priority: escalated at 30 minutes; normal priority: flagged once as overdue at 120 minutes, without Management", async () => {
    const base = t.now();
    const high = (await t.call("POST", "/v1/support/tickets", { as: S1, body: { edition: 2026, subject: "Generator failed in hall A", priority: "high", contact: { name: "Hall A" } } })).json.id;
    const normal = (await ownTicket(P1, "Wi-Fi password please")).json.id;
    await sweepSupport(t.sql, at(base, 29));
    expect((await ticketRow(high)).escalation_level).toBe(0);
    await sweepSupport(t.sql, at(base, 30));
    expect((await ticketRow(high)).escalation_level).toBe(1);
    await sweepSupport(t.sql, at(base, 119));
    expect((await alertsFor(normal))).toHaveLength(0);
    await sweepSupport(t.sql, at(base, 120));
    await sweepSupport(t.sql, at(base, 180));
    const n = await alertsFor(normal);
    expect(n.map((a) => a.reason)).toEqual(["overdue", "overdue"]);   // once, to each support person
    expect(n.map((a) => a.recipient)).not.toContain(ids[MANAGER]);
    expect((await ticketRow(normal)).escalation_level).toBe(0);
  });

  it("two sweeps at once escalate once and never duplicate alerts", async () => {
    const base = t.now();
    // A fresh ticket: earlier sweeps have already escalated every older open ticket.
    const id = (await t.call("POST", "/v1/support/tickets", { as: S1, body: { edition: 2026, subject: "Concurrent sweep", priority: "high", isEmergency: true, contact: { name: "z" } } })).json.id;
    expect((await ticketRow(id)).escalation_level).toBe(0);
    const results = await Promise.all([1, 2, 3, 4].map(() => sweepSupport(t.sql, at(base, 6))));
    expect(results.reduce((n, r) => n + r.escalated, 0)).toBeGreaterThanOrEqual(1);
    const evs = await t.sql`select 1 from ticket_events where ticket_id = ${id} and kind = 'escalated'`;
    expect(evs).toHaveLength(1);
    const { n } = (await t.sql<{ n: number }[]>`select count(*)::int as n from audit_events where action = 'support.ticket_escalated_automatically' and entity_id = ${id}`)[0]!;
    expect(n).toBe(1);
    const a = await alertsFor(id);
    expect(new Set(a.map((x) => `${x.recipient}|${x.reason}|${x.round}`)).size).toBe(a.length);
  });

  it("acknowledging at the moment the window closes: either escalated before the acknowledgement, or not at all", async () => {
    const base = t.now();
    const id = (await t.call("POST", "/v1/support/tickets", { as: S1, body: { edition: 2026, subject: "Race", priority: "high", isEmergency: true, contact: { name: "q" } } })).json.id;
    t.setNow(at(base, 5));
    const [, ack] = await Promise.all([sweepSupport(t.sql, at(base, 5)), act(S2, id, "acknowledge")]);
    t.setNow(base);
    expect(ack.status).toBe(200);
    const row = await ticketRow(id);
    expect(row.status).toBe("Acknowledged");
    if (row.escalation_level === 1) expect(row.escalated_at.getTime()).toBeLessThanOrEqual(row.acknowledged_at.getTime());
    await sweepSupport(t.sql, at(base, 60));
    expect((await ticketRow(id)).escalation_level).toBe(row.escalation_level);
  });
});

describe("the acknowledgement windows are per-edition configuration (TBD-27, awaiting organisers)", () => {
  it("Management changes them without a code change; it is audited; support staff and invalid values are refused", async () => {
    const get = await t.call("GET", "/v1/support/editions/2026/policy", { as: S1 });
    expect(get.json).toMatchObject({ emergencyAckMinutes: 5, highAckMinutes: 30, normalAckMinutes: 120 });
    const body = { ...get.json, emergencyAckMinutes: 2 };
    expect((await t.call("PUT", "/v1/manage/editions/2026/support-policy", { as: S1, body })).status).toBe(403);
    expect((await t.call("PUT", "/v1/manage/editions/2026/support-policy", { as: MANAGER, body: { ...body, emergencyAckMinutes: 60 } })).status).toBe(400);
    expect((await t.call("PUT", "/v1/manage/editions/2026/support-policy", { as: MANAGER, body: { ...body, extra: 1 } })).status).toBe(400);
    expect((await t.call("PUT", "/v1/manage/editions/2026/support-policy", { as: MANAGER, body })).json.emergencyAckMinutes).toBe(2);
    const id = (await emergency(P3, randomUUID(), 2026)).json.ticket.id;
    const row = await ticketRow(id);
    expect([2, 5]).toContain(Math.round((row.ack_due_at.getTime() - row.created_at.getTime()) / 60_000));   // P3 may still have an open emergency
    const [a] = await t.sql`select data from audit_events where action = 'support.policy_changed' order by id desc limit 1`;
    expect(a!.data.next.emergencyAckMinutes).toBe(2);
    await expect(t.sql`update event_editions set support_policy = '{"emergencyAckMinutes": 0}' where id = 2026`).rejects.toMatchObject({ code: "23514" });
  });

  it("a new emergency from someone without an open one gets the new window", async () => {
    const p = await t.participant("fresh@sup.test", "delegate");
    expect(p).toBeTruthy();
    const id = (await emergency("fresh@sup.test")).json.ticket.id;
    const row = await ticketRow(id);
    expect(row.ack_due_at.getTime() - row.created_at.getTime()).toBe(min(2));
  });
});
