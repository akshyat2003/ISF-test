// TBD-13 / TBD-14: the email/SMS outbox. Messages are queued with the event that causes them, delivered with retries,
// never reported as sent without a provider, and activation codes are scrubbed once delivered (SEC-09).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { backoffMs, dispatchOutbox, enqueue, MAX_ATTEMPTS, msg91Sender, type MessageSender, type OutgoingMessage } from "../src/modules/notifications/outbox.js";
import { createTestApp, type TestApp } from "./helpers.js";

let t: TestApp;
const ADMIN = "admin@jathara.test";
const NOW = new Date("2026-11-10T10:00:00+05:30");

function capture(channel: "email" | "sms", failWith?: () => Error): MessageSender & { sent: OutgoingMessage[] } {
  const sent: OutgoingMessage[] = [];
  return { channel, name: "capture", sent, async send(m) { if (failWith) throw failWith(); sent.push(m); } };
}

async function pendingAccount(email: string | null, mobile: string | null) {
  const [u] = await t.sql<{ id: string }[]>`
    insert into user_accounts (email, mobile_e164, full_name, status) values (${email}, ${mobile}, 'Imported Person', 'pending_activation') returning id`;
  return u!.id;
}

beforeAll(async () => {
  // Email delivery is "configured" for this app; SMS is not.
  t = await createTestApp({ automated: { email: true, sms: false } });
  await t.staff(ADMIN, ["admin"]);
});
afterAll(async () => { await t.close(); });

describe("enqueue: the contact on file decides the channel (email first)", () => {
  it("uses email when present, SMS for mobile-only accounts, nothing without a contact; idempotent", async () => {
    const u = await pendingAccount("x@example.com", "+919876500001");
    const m = { userId: u, editionId: 2026, kind: "selection_result" as const, subject: "S", emailBody: "E", smsBody: "T", idempotencyKey: "k1" };
    expect(await enqueue(t.sql, { ...m, email: "x@example.com", mobile: "+919876500001" }, NOW)).toBe("email");
    expect(await enqueue(t.sql, { ...m, email: "x@example.com", mobile: "+919876500001" }, NOW)).toBe("email");   // same key: no duplicate
    expect(await enqueue(t.sql, { ...m, email: null, mobile: "+919876500001", idempotencyKey: "k2" }, NOW)).toBe("sms");
    expect(await enqueue(t.sql, { ...m, email: null, mobile: null, idempotencyKey: "k3" }, NOW)).toBeNull();
    const rows = await t.sql`select channel, recipient, body from notifications where user_id = ${u} order by channel`;
    expect(rows).toEqual([{ channel: "email", recipient: "x@example.com", body: "E" }, { channel: "sms", recipient: "+919876500001", body: "T" }]);
  });
});

describe("dispatchOutbox", () => {
  it("without a provider for a channel, its messages stay queued and are never reported as sent", async () => {
    const r = await dispatchOutbox(t.sql, [], NOW);
    expect(r).toEqual({ sent: 0, retrying: 0, failed: 0 });
    const email = capture("email");
    await dispatchOutbox(t.sql, [email], NOW);
    const [sms] = await t.sql`select status, attempts from notifications where channel = 'sms'`;
    expect(sms).toEqual({ status: "queued", attempts: 0 });
  });

  it("delivers and records status; failures retry with backoff, then fail after the last attempt", async () => {
    const sentRow = await t.sql`select status, sent_at from notifications where channel = 'email'`;
    expect(sentRow[0]!.status).toBe("sent");
    const failing = capture("sms", () => new Error("gateway timeout"));
    let at = NOW;
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      const r = await dispatchOutbox(t.sql, [failing], at);
      expect(r).toEqual(i < MAX_ATTEMPTS ? { sent: 0, retrying: 1, failed: 0 } : { sent: 0, retrying: 0, failed: 1 });
      if (i < MAX_ATTEMPTS) {
        // Not retried before the backoff has passed.
        expect((await dispatchOutbox(t.sql, [failing], new Date(at.getTime() + backoffMs(i) - 1000))).retrying).toBe(0);
        at = new Date(at.getTime() + backoffMs(i));
      }
    }
    const [row] = await t.sql`select status, attempts, last_error from notifications where channel = 'sms'`;
    expect(row).toEqual({ status: "failed", attempts: MAX_ATTEMPTS, last_error: "gateway timeout" });
  });
});

describe("TBD-13 automated activation delivery", () => {
  it("sends the code to the participant's own email; the Admin never sees it; the stored copy is scrubbed after delivery", async () => {
    const u = await pendingAccount("participant@example.com", null);
    const r = await t.call("POST", `/v1/admin/users/${u}/activation`, { as: ADMIN });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ token: null, delivery: "email" });
    const [queued] = await t.sql<{ body: string; sensitive: boolean; recipient: string }[]>`
      select body, sensitive, recipient from notifications where user_id = ${u} and kind = 'activation'`;
    expect(queued).toMatchObject({ sensitive: true, recipient: "participant@example.com" });
    const email = capture("email");
    await dispatchOutbox(t.sql, [email], NOW);
    const code = /\n\n(\S+)\n\n/.exec(email.sent[0]!.body)![1]!;
    expect(code.length).toBeGreaterThan(20);
    const [after] = await t.sql<{ body: string; payload: object; status: string }[]>`
      select body, payload, status from notifications where user_id = ${u} and kind = 'activation'`;
    expect(after).toEqual({ body: "[removed after delivery]", payload: {}, status: "sent" });
    // The delivered code works for that participant (signed in with the address the organisers hold).
    await t.sql`update user_accounts set auth_subject = 'dev|participant@example.com' where id = ${u}`;
    const redeem = await t.call("POST", "/v1/me/activation", { as: "participant@example.com", body: { token: code } });
    expect(redeem.json.account.status).toBe("active");
    const [audit] = await t.sql`select data->>'delivery' as d from audit_events where action = 'activation.issued' and entity_id = ${u}`;
    expect(audit!.d).toBe("email");
  });

  it("falls back to manual hand-over when the participant's channel has no provider (mobile-only, SMS not configured)", async () => {
    const u = await pendingAccount(null, "+919876500002");
    const r = await t.call("POST", `/v1/admin/users/${u}/activation`, { as: ADMIN });
    expect(r.json.delivery).toBe("manual");
    expect(typeof r.json.token).toBe("string");
    expect((await t.sql`select count(*)::int as n from notifications where user_id = ${u}`)[0]!.n).toBe(0);
  });

  it("a failed activation message is scrubbed as well", async () => {
    const u = await pendingAccount("bounce@example.com", null);
    await t.call("POST", `/v1/admin/users/${u}/activation`, { as: ADMIN });
    await t.sql`update notifications set attempts = ${MAX_ATTEMPTS - 1} where user_id = ${u}`;
    await dispatchOutbox(t.sql, [capture("email", () => new Error("mailbox unavailable"))], NOW);
    const [row] = await t.sql`select status, body from notifications where user_id = ${u}`;
    expect(row).toEqual({ status: "failed", body: "[removed after delivery]" });
  });
});

describe("MSG91 adapter (DLT templates by message kind)", () => {
  it("sends the template id and variables, and treats an error response as a failure", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = msg91Sender({ authKey: "k", templates: { selection_result: "tmpl-1" }, fetchImpl: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ type: "success" }), { status: 200 });
    }) as typeof fetch });
    await ok.send({ id: "1", kind: "selection_result", to: "+919876500003", subject: "", body: "text", payload: { year: 2026, url: "https://w" } });
    expect(calls[0]!.url).toBe("https://control.msg91.com/api/v5/flow");
    expect((calls[0]!.init.headers as Record<string, string>).authkey).toBe("k");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ template_id: "tmpl-1", short_url: "0", recipients: [{ mobiles: "919876500003", year: 2026, url: "https://w" }] });
    await expect(ok.send({ id: "2", kind: "activation", to: "+91", subject: "", body: "", payload: {} })).rejects.toThrow(/no DLT template id/);
    const bad = msg91Sender({ authKey: "k", templates: { selection_result: "t" }, fetchImpl: (async () =>
      new Response(JSON.stringify({ type: "error", message: "Invalid template" }), { status: 200 })) as unknown as typeof fetch });
    await expect(bad.send({ id: "3", kind: "selection_result", to: "+919876500003", subject: "", body: "", payload: {} })).rejects.toThrow(/Invalid template/);
  });
});
