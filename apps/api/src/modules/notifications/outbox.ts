// Email/SMS outbox (TBD-13, TBD-14, FR-SEL-03). Messages are written to `notifications` in the same transaction as the
// event that causes them, then delivered by the dispatcher with retries. Delivery status is recorded per message, so
// Management can see whether each result actually went out. Without a configured provider a message simply stays
// queued: it is never reported as sent.
import type { Db, Sql } from "../../db/client.js";

export type ContactChannel = "email" | "sms";
/** Channels the dispatcher delivers: email/SMS (Phase 5) and push (Phase 7, TBD-52). In-app needs no delivery. */
export type OutboxChannel = ContactChannel | "push";

/**
 * Fixed message templates. DRAFT COPY: the wording needs Management approval (TBD-14), and every SMS template must be
 * registered on the DLT platform before it can be delivered in India (TBD-35). SMS texts carry no outcome: the
 * applicant signs in to read it.
 */
export const TEMPLATES = {
  result: {
    sms: (v: { year: number; url: string }) => `Startup Jathara ${v.year}: a decision on your application is now available. Sign in at ${v.url} to see it.`,
  },
  correction: {
    sms: (v: { year: number; url: string }) => `Startup Jathara ${v.year}: the decision on your application has been updated. Sign in at ${v.url} to see it.`,
  },
  /** Phase 6 (FR-VOL-08). No contact details in the message itself: the app shows them to the authorised person. */
  assignment: {
    sms: (v: { year: number; url: string }) => `Startup Jathara ${v.year}: your volunteer assignment has changed. Open the app or ${v.url} to see the details.`,
  },
  activation: {
    subject: "Your Startup Jathara activation code",
    email: (v: { code: string; hours: number }) =>
      `Your activation code for the Startup Jathara platform is:\n\n${v.code}\n\nSign in with this email address, then enter the code. ` +
      `It works once and is valid for ${v.hours} hours. Never share it; the event team will never ask you for it.`,
    sms: (v: { code: string; hours: number }) => `Your Startup Jathara activation code is ${v.code}. It is valid for ${v.hours} hours. Do not share it.`,
  },
} as const;

/** Phase 6 volunteer messages (FR-VOL-08). One DLT template covers them all: MSG91_TEMPLATE_ASSIGNMENT. */
export const VOLUNTEER_MESSAGE_KINDS = ["volunteer_assigned", "volunteer_for_you", "volunteer_assignment_ended", "volunteer_removed"] as const;
export type VolunteerMessageKind = (typeof VOLUNTEER_MESSAGE_KINDS)[number];

export type OutboxMessage = {
  userId: string;
  editionId: number | null;
  kind: "selection_result" | "decision_corrected" | "activation" | VolunteerMessageKind;
  /** The account's contact on file. Email wins when present (TBD-13, TBD-14). */
  email: string | null;
  mobile: string | null;
  subject: string;
  emailBody: string;
  smsBody: string;
  /** Template variables (SMS providers send DLT templates by id plus variables). */
  payload?: Record<string, string | number>;
  idempotencyKey: string;
  /** Carries a secret: the body is scrubbed after delivery or final failure. */
  sensitive?: boolean;
};

export function channelFor(contact: { email: string | null; mobile: string | null }): ContactChannel | null {
  return contact.email ? "email" : contact.mobile ? "sms" : null;
}

/** Queues one message to the user's contact on file. Returns the channel, or null when the account has no contact. */
export async function enqueue(db: Db, m: OutboxMessage, now: Date): Promise<ContactChannel | null> {
  const channel = channelFor(m);
  if (!channel) return null;
  const recipient = channel === "email" ? m.email! : m.mobile!;
  await db`
    insert into notifications (user_id, edition_id, kind, channel, recipient, title, body, payload, status, sensitive,
                               next_attempt_at, idempotency_key)
    values (${m.userId}, ${m.editionId}, ${m.kind}, ${channel}, ${recipient}, ${m.subject},
            ${channel === "email" ? m.emailBody : m.smsBody}, ${db.json((m.payload ?? {}) as never)}, 'queued',
            ${m.sensitive ?? false}, ${now}, ${`${m.idempotencyKey}:${channel}`})
    on conflict (idempotency_key) do nothing`;
  return channel;
}

// ---------------------------------------------------------------- dispatcher
export type OutgoingMessage = { id: string; kind: string; to: string; subject: string; body: string; payload: Record<string, unknown> };
export interface MessageSender {
  readonly channel: OutboxChannel;
  readonly name: string;
  /** Resolves when the provider has ACCEPTED the message (recorded as "sent"; not proof of delivery, FR-NOT-04). */
  send(m: OutgoingMessage): Promise<void | { providerRef?: string }>;
}

/** A failure that retrying cannot fix (for example a device that no longer exists): the message fails at once. */
export class PermanentFailure extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

export const MAX_ATTEMPTS = 6;
const SCRUBBED = "[removed after delivery]";

/** Retry delay after the n-th failed attempt: 1, 2, 4, 8, 16 minutes (capped at an hour). */
export const backoffMs = (attempts: number) => Math.min(60, 2 ** (attempts - 1)) * 60_000;

export type DispatchResult = { sent: number; retrying: number; failed: number };

export async function dispatchOutbox(sql: Sql, senders: MessageSender[], now: Date, limit = 20): Promise<DispatchResult> {
  const result: DispatchResult = { sent: 0, retrying: 0, failed: 0 };
  const channels = senders.map((s) => s.channel);
  if (!channels.length) return result;
  await sql.begin(async (tx) => {
    const rows = await tx<{ id: string; kind: string; channel: OutboxChannel; recipient: string; title: string; body: string;
                            payload: Record<string, unknown>; attempts: number; sensitive: boolean }[]>`
      select id, kind, channel, recipient, title, body, payload, attempts, sensitive from notifications
      where status = 'queued' and channel in ${tx(channels)} and (next_attempt_at is null or next_attempt_at <= ${now})
      order by created_at limit ${limit} for update skip locked`;
    for (const n of rows) {
      const sender = senders.find((s) => s.channel === n.channel)!;
      const attempts = n.attempts + 1;
      try {
        const accepted = await sender.send({ id: n.id, kind: n.kind, to: n.recipient, subject: n.title, body: n.body, payload: n.payload });
        await tx`
          update notifications set status = 'sent', sent_at = ${now}, attempts = ${attempts}, last_error = null,
            provider_ref = ${(accepted && accepted.providerRef) || null},
            body = case when sensitive then ${SCRUBBED} else body end,
            payload = case when sensitive then '{}'::jsonb else payload end
          where id = ${n.id}`;
        result.sent += 1;
      } catch (err) {
        const message = String((err as Error).message ?? err).slice(0, 500);
        if (err instanceof PermanentFailure && err.code === "DeviceNotRegistered" && n.channel === "push") {
          await tx`update push_tokens set disabled_at = ${now}, disabled_reason = 'DeviceNotRegistered' where token = ${n.recipient}`;
        }
        if (attempts >= MAX_ATTEMPTS || err instanceof PermanentFailure) {
          await tx`
            update notifications set status = 'failed', attempts = ${attempts}, last_error = ${message},
              body = case when sensitive then ${SCRUBBED} else body end,
              payload = case when sensitive then '{}'::jsonb else payload end
            where id = ${n.id}`;
          result.failed += 1;
        } else {
          await tx`update notifications set attempts = ${attempts}, last_error = ${message},
                   next_attempt_at = ${new Date(now.getTime() + backoffMs(attempts))} where id = ${n.id}`;
          result.retrying += 1;
        }
      }
    }
  });
  return result;
}

// ---------------------------------------------------------------- providers
export type SmtpOptions = { host: string; port: number; user?: string; pass?: string; from: string };

/** Email over SMTP (decision TBD-35: Amazon SES, ap-south-1). */
export async function smtpSender(o: SmtpOptions): Promise<MessageSender> {
  const { default: nodemailer } = await import("nodemailer");
  const transport = nodemailer.createTransport({
    host: o.host, port: o.port, secure: o.port === 465, requireTLS: o.port !== 465,
    auth: o.user ? { user: o.user, pass: o.pass } : undefined,
  });
  return {
    channel: "email",
    name: "smtp",
    async send(m) {
      await transport.sendMail({ from: o.from, to: m.to, subject: m.subject, text: m.body });
    },
  };
}

export type Msg91Options = { authKey: string; templates: Partial<Record<string, string>>; fetchImpl?: typeof fetch };

/**
 * SMS through MSG91's Flow API with DLT-registered templates (decision TBD-35, default aggregator, subject to
 * quotation). The template id is chosen by message kind and the variables come from the message payload.
 * Not yet verified against a live MSG91 account: see LAUNCH_CHECKLIST §B (real SMS delivery).
 */
export function msg91Sender(o: Msg91Options): MessageSender {
  const f = o.fetchImpl ?? fetch;
  return {
    channel: "sms",
    name: "msg91",
    async send(m) {
      const templateId = o.templates[m.kind];
      if (!templateId) throw new Error(`no DLT template id configured for ${m.kind}`);
      const res = await f("https://control.msg91.com/api/v5/flow", {
        method: "POST",
        headers: { authkey: o.authKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ template_id: templateId, short_url: "0", recipients: [{ mobiles: m.to.replace(/^\+/, ""), ...m.payload }] }),
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`MSG91 HTTP ${res.status}: ${text.slice(0, 200)}`);
      try {
        const j = JSON.parse(text) as { type?: string; message?: string };
        if (j.type && j.type !== "success") throw new Error(`MSG91: ${j.message ?? j.type}`);
      } catch (e) {
        if (e instanceof SyntaxError) return;
        throw e;
      }
    },
  };
}

// ---------------------------------------------------------------- push (Phase 7, TBD-52)
export type ExpoPushOptions = { accessToken?: string; fetchImpl?: typeof fetch };
const EXPO_SEND = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS = "https://exp.host/--/api/v2/push/getReceipts";

function expoHeaders(o: ExpoPushOptions) {
  return { "content-type": "application/json", accept: "application/json", ...(o.accessToken ? { authorization: `Bearer ${o.accessToken}` } : {}) };
}

/**
 * Push through the Expo push service, which forwards to FCM (Android) and APNs (iOS). "sent" means Expo accepted the
 * message (a ticket); the receipt check later records failures. Not yet verified against live credentials.
 */
export function expoPushSender(o: ExpoPushOptions = {}): MessageSender {
  const f = o.fetchImpl ?? fetch;
  return {
    channel: "push",
    name: "expo",
    async send(m) {
      const res = await f(EXPO_SEND, {
        method: "POST", headers: expoHeaders(o), signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ to: m.to, title: m.subject, body: m.body, data: m.payload, sound: "default", priority: "high" }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Expo push HTTP ${res.status}: ${text.slice(0, 200)}`);
      const j = JSON.parse(text) as { data?: { status: string; id?: string; message?: string; details?: { error?: string } } | { status: string }[] };
      const ticket = (Array.isArray(j.data) ? j.data[0] : j.data) as { status: string; id?: string; message?: string; details?: { error?: string } } | undefined;
      if (!ticket) throw new Error("Expo push returned no ticket");
      if (ticket.status !== "ok") {
        const code = ticket.details?.error ?? "error";
        const msg = `Expo push: ${code}${ticket.message ? `: ${ticket.message}` : ""}`.slice(0, 300);
        if (code === "DeviceNotRegistered" || code === "InvalidCredentials") throw new PermanentFailure(msg, code);
        throw new Error(msg);
      }
      return { providerRef: ticket.id };
    },
  };
}

export type ReceiptResult = { checked: number; failed: number };

/**
 * Expo receipts arrive some minutes after a ticket. A receipt error turns a "sent" push into "failed" (and disables a
 * device that no longer exists); an "ok" receipt only means FCM/APNs accepted it, so the status stays "sent".
 */
export async function checkPushReceipts(sql: Sql, o: ExpoPushOptions, now: Date, opts: { minAgeMs?: number; limit?: number } = {}): Promise<ReceiptResult> {
  const f = o.fetchImpl ?? fetch;
  const cutoff = new Date(now.getTime() - (opts.minAgeMs ?? 15 * 60_000));
  const rows = await sql<{ id: string; ref: string; token: string; sentAt: Date }[]>`
    select id, provider_ref as ref, recipient as token, sent_at as "sentAt" from notifications
    where channel = 'push' and status = 'sent' and receipt_checked_at is null and provider_ref is not null and sent_at <= ${cutoff}
    order by sent_at limit ${opts.limit ?? 300}`;
  if (!rows.length) return { checked: 0, failed: 0 };
  const res = await f(EXPO_RECEIPTS, { method: "POST", headers: expoHeaders(o), body: JSON.stringify({ ids: rows.map((r) => r.ref) }),
    signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Expo receipts HTTP ${res.status}`);
  const receipts = ((await res.json()) as { data?: Record<string, { status: string; message?: string; details?: { error?: string } }> }).data ?? {};
  const out: ReceiptResult = { checked: 0, failed: 0 };
  for (const r of rows) {
    const rc = receipts[r.ref];
    if (!rc) {
      // Expo keeps receipts for about a day; after that, stop asking and leave the status as recorded.
      if (now.getTime() - r.sentAt.getTime() > 24 * 3600_000) await sql`update notifications set receipt_checked_at = ${now} where id = ${r.id}`;
      continue;
    }
    out.checked += 1;
    if (rc.status === "ok") {
      await sql`update notifications set receipt_checked_at = ${now} where id = ${r.id}`;
    } else {
      const code = rc.details?.error ?? "error";
      await sql`update notifications set status = 'failed', receipt_checked_at = ${now},
                last_error = ${`Expo receipt: ${code}${rc.message ? `: ${rc.message}` : ""}`.slice(0, 500)} where id = ${r.id}`;
      if (code === "DeviceNotRegistered") await sql`update push_tokens set disabled_at = ${now}, disabled_reason = 'DeviceNotRegistered' where token = ${r.token}`;
      out.failed += 1;
    }
  }
  return out;
}

/** Development only: logs instead of sending (refused in production by the launch gate). Never logs sensitive bodies. */
export function logSender(channel: OutboxChannel, log: (msg: string) => void): MessageSender {
  return {
    channel,
    name: "log",
    async send(m) {
      log(`[outbox:${channel}] to=${m.to} kind=${m.kind} subject=${JSON.stringify(m.subject)}${m.kind === "activation" ? "" : ` body=${JSON.stringify(m.body)}`}`);
    },
  };
}
