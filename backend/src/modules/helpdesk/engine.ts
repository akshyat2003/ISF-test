// The Help Desk engine (RQ §11.1–11.5, FR-HD-*; TBD-54, TBD-55). Channel-agnostic: a channel adapter supplies an
// authenticated identity and the text, and gets a reply back. Today the only adapter is the mobile app
// (app.ts, channel "app"). WhatsApp is a separate workstream; it would add its own adapter (webhook, number
// verification) and call `ask` with the identity it has verified — nothing here needs to change for that.
//
// Order of handling for every message:
//   1. emergency gate (deterministic, no model): contacts with 112 first, a high-priority ticket, staff alerted;
//   2. "I want a person" (deterministic): a ticket with this conversation attached;
//   3. attempts to change the rules or pull other people's data (deterministic): refused, logged;
//   4. scoped tools run on the server for this requester only; the model answers from their results;
//   5. the answer is validated and checked for contact details it was not given; on any failure the person gets
//      official links and the option to ask a person — never a guess.
import { randomUUID } from "node:crypto";
import { ticketRef, type HelpDeskConversation, type HelpDeskMessage, type HelpDeskReply, type TicketRef } from "@sj/contracts";
import type { Db, Sql } from "../../db/client.js";
import { audit } from "../../platform/audit.js";
import { AppError, notFound } from "../../platform/errors.js";
import { getEdition } from "../editions/service.js";
import { createTicket, emergencyContacts, reportEmergency } from "../support/service.js";
import { classifyEmergency, looksLikeInjection, wantsHuman } from "./detect.js";
import { checkAnswer } from "./guard.js";
import { buildPrompt, HELPDESK_PROMPT_VERSION, RESPONSE_SCHEMA, SYSTEM_INSTRUCTION, validateAnswer, type HelpDeskModel } from "./model.js";
import { runTools, type HelpDeskIdentity } from "./tools.js";

export type { HelpDeskIdentity };
export type Channel = "app";
type Kind = HelpDeskMessage["kind"];
type Meta = Record<string, unknown> & { kind: NonNullable<Kind> };

export type HelpDeskDeps = { sql: Sql; model: HelpDeskModel | null; now: Date; onError?: (err: unknown, where: string) => void };

const providerOf = (m: HelpDeskModel | null): HelpDeskReply["provider"] => (m ? m.kind : "none");

// ---------------------------------------------------------------- conversations (FR-HD-16, -18)
async function conversationFor(tx: Db, who: HelpDeskIdentity, year: number, channel: Channel, id: string | undefined, now: Date): Promise<string> {
  if (id) {
    const [c] = await tx<{ id: string }[]>`
      select id from helpdesk_conversations where id = ${id} and user_id = ${who.userId} and edition_id = ${year} and channel = ${channel}`;
    if (!c) throw notFound("Conversation");   // someone else's, or another edition's: indistinguishable from missing
    return c.id;
  }
  const [latest] = await tx<{ id: string }[]>`
    select id from helpdesk_conversations where user_id = ${who.userId} and edition_id = ${year} and channel = ${channel}
    order by last_message_at desc limit 1`;
  if (latest) return latest.id;
  const [c] = await tx<{ id: string }[]>`
    insert into helpdesk_conversations (channel, user_id, edition_id, started_at, last_message_at)
    values (${channel}, ${who.userId}, ${year}, ${now}, ${now}) returning id`;
  return c!.id;
}

async function save(db: Db, conversationId: string, role: "user" | "assistant" | "tool", content: string, now: Date, meta: object = {}, toolName: string | null = null) {
  const [m] = await db<{ id: string }[]>`
    insert into helpdesk_messages (conversation_id, role, content, tool_name, at, meta)
    values (${conversationId}, ${role}, ${content.slice(0, 8000)}, ${toolName}, ${now}, ${db.json(meta as never)}) returning id::text`;
  await db`update helpdesk_conversations set last_message_at = ${now} where id = ${conversationId}`;
  return m!.id;
}

/** The latest conversation of this person for this edition and channel: questions and answers only. */
export async function getConversation(db: Db, who: HelpDeskIdentity, year: number, channel: Channel = "app"): Promise<HelpDeskConversation> {
  const [c] = await db<{ id: string }[]>`
    select id from helpdesk_conversations where user_id = ${who.userId} and edition_id = ${year} and channel = ${channel}
    order by last_message_at desc limit 1`;
  if (!c) return { conversationId: null, messages: [] };
  const rows = await db<{ id: string; role: "user" | "assistant"; content: string; at: Date; meta: { kind?: Kind } }[]>`
    select id::text, role, content, at, meta from helpdesk_messages where conversation_id = ${c.id} and role in ('user', 'assistant')
    order by id desc limit 100`;
  return { conversationId: c.id, messages: rows.reverse().map((r) => ({ id: r.id, role: r.role, text: r.content, at: r.at.toISOString(), kind: r.role === "assistant" ? r.meta.kind ?? null : null })) };
}

async function openTicketFor(db: Db, conversationId: string): Promise<TicketRef | null> {
  const [t] = await db<{ id: string; number: string }[]>`
    select id, number::text from support_tickets where conversation_id = ${conversationId} and status <> 'Resolved' and not is_emergency
    order by created_at desc limit 1`;
  return t ? { id: t.id, ref: ticketRef(Number(t.number)) } : null;
}

/** FR-HD-09: a ticket carrying this conversation (FR-HD-16). One open ticket per conversation; asking again returns it. */
async function escalateTx(tx: Db, who: HelpDeskIdentity, year: number, conversationId: string, subject: string, description: string | null, now: Date): Promise<TicketRef> {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`helpdesk-ticket:${conversationId}`}, 0))`;
  const existing = await openTicketFor(tx, conversationId);
  if (existing) return existing;
  const t = await createTicket(tx, {
    edition: year, subject: subject.slice(0, 200), description, priority: "normal", isEmergency: false, source: "help_desk",
    requesterId: who.userId, conversationId,
  }, now);
  return { id: t.id, ref: t.ref };
}

export async function escalateConversation(deps: HelpDeskDeps, who: HelpDeskIdentity, year: number, conversationId: string, note: string | undefined): Promise<HelpDeskReply> {
  const { sql, now } = deps;
  return sql.begin(async (tx) => {
    const id = await conversationFor(tx, who, year, "app", conversationId, now);
    const [lastQuestion] = await tx<{ content: string }[]>`
      select content from helpdesk_messages where conversation_id = ${id} and role = 'user' order by id desc limit 1`;
    const ticket = await escalateTx(tx, who, year, id, `Help Desk: ${(note || lastQuestion?.content || "Asked for a person").slice(0, 120)}`,
      note ?? lastQuestion?.content ?? null, now);
    const text = `I've passed this to the support team. Your reference is ${ticket.ref}. They will reply here or contact you; you can follow it under My requests.`;
    const msgId = await save(tx, id, "assistant", text, now, { kind: "escalated", ticketId: ticket.id } satisfies Meta);
    return { conversationId: id, message: { id: msgId, role: "assistant", text, at: now.toISOString(), kind: "escalated" }, sources: [], emergency: null,
      ticket, provider: providerOf(deps.model), canAskPerson: false };
  });
}

// ---------------------------------------------------------------- answering
const FALLBACK = "I can't answer that right now.";

export async function ask(deps: HelpDeskDeps, who: HelpDeskIdentity, input: { edition: number; text: string; conversationId?: string }, channel: Channel = "app"): Promise<HelpDeskReply> {
  const { sql, model, now } = deps;
  const year = input.edition;
  await getEdition(sql, year);
  const question = input.text.trim();
  const conversationId = await sql.begin(async (tx) => {
    const id = await conversationFor(tx, who, year, channel, input.conversationId, now);
    await save(tx, id, "user", question, now);
    return id;
  });
  const reply = async (text: string, meta: Meta, extra: Partial<HelpDeskReply> = {}): Promise<HelpDeskReply> => {
    const msgId = await save(sql, conversationId, "assistant", text, now, { ...meta, provider: providerOf(model) });
    return { conversationId, message: { id: msgId, role: "assistant", text, at: now.toISOString(), kind: meta.kind }, sources: [], emergency: null,
      ticket: null, provider: providerOf(model), canAskPerson: true, ...extra };
  };

  // 1. Emergency gate: no model, no troubleshooting (RQ §11.5, AT-31).
  const em = classifyEmergency(question);
  if (em === "emergency") {
    const r = await reportEmergency(sql, who.userId, year, { clientRequestId: randomUUID(), message: question }, now,
      { conversationId, source: "help_desk", onError: (e) => deps.onError?.(e, "helpdesk.emergency") });
    const text = r.ticket
      ? `If you or anyone else is in danger, call 112 now. I have alerted the support team (reference ${r.ticket.ref}); they will contact you. Do not wait for a reply here before calling 112.`
      : "Call 112 now. I could not alert the support team, so please call 112 or ask someone nearby for help.";
    return reply(text, { kind: "emergency", ticketId: r.ticket?.id ?? null, alerted: r.alerted }, { emergency: r, ticket: r.ticket, canAskPerson: false });
  }
  if (em === "informational") {
    const contacts = await emergencyContacts(sql, who.userId, year);
    const text = `In an emergency, call 112 (police, fire, ambulance).${contacts.length > 1 ? ` Event contacts: ${contacts.slice(1).map((c) => `${c.title} ${c.phone}`).join("; ")}.` : ""} If this is an emergency now, press the Emergency button or call 112.`;
    return reply(text, { kind: "answer", informationalEmergency: true }, { sources: [{ title: "Emergency contacts", section: "Emergency" }] });
  }

  // 2. A person, please (FR-HD-09).
  if (wantsHuman(question)) {
    const ticket = await sql.begin((tx) => escalateTx(tx, who, year, conversationId, `Help Desk: ${question.slice(0, 120)}`, question, now));
    return reply(`I've passed this to the support team. Your reference is ${ticket.ref}. They will reply here or contact you.`,
      { kind: "escalated", ticketId: ticket.id }, { ticket, canAskPerson: false });
  }

  // 3. Attempts to change the rules or reach other people's data (AT-27).
  if (looksLikeInjection(question)) {
    await audit(sql, { actorUserId: who.userId, action: "helpdesk.request_refused", entityType: "helpdesk_conversation", entityId: conversationId,
      editionId: year, data: { reason: "rules_or_bulk_data" } });
    return reply("I can only help with your own information and the official event information. I can't share other people's details or change how I work.",
      { kind: "refused" });
  }

  // 4. Scoped tools for this requester (FR-HD-05…07). Logged with name and result size, not content.
  const { outputs, errors } = await runTools({ db: sql, who, year, question, now });
  for (const o of outputs) await save(sql, conversationId, "tool", JSON.stringify({ items: o.items }), now, { items: o.items }, o.tool);
  const context = Object.fromEntries(outputs.map((o) => [o.tool, o.data]));
  const sources = ((context.event_info_search as { title: string; section: string }[] | undefined) ?? []).map((e) => ({ title: e.title, section: e.section }));
  const meta = { tools: outputs.map((o) => ({ tool: o.tool, items: o.items })), ...(errors.length ? { toolErrors: errors } : {}) };

  const fallback = (why: string) => {
    const tail = sources.length
      ? ` These official pages may help: ${sources.slice(0, 3).map((s) => s.title).join("; ")}. You can also ask a person.`
      : " You can open the event information in the app, or ask a person.";
    return reply(`${FALLBACK}${tail}`, { kind: "fallback", reason: why, ...meta }, { sources });
  };
  if (!model) return fallback("no_provider");

  // 5. The model answers from that data only; its output is validated and checked.
  const history = await sql<{ role: "user" | "assistant"; content: string }[]>`
    select role, content from helpdesk_messages where conversation_id = ${conversationId} and role in ('user', 'assistant')
    order by id desc limit 7`;
  const prompt = buildPrompt({ question, history: history.slice(1).reverse().map((h) => ({ role: h.role, text: h.content })), context });
  let raw: string;
  try {
    raw = await model.complete({ system: SYSTEM_INSTRUCTION, user: prompt, responseSchema: RESPONSE_SCHEMA });
  } catch (err) {
    deps.onError?.(err, "helpdesk.model");
    return fallback("provider_unavailable");
  }
  const answer = validateAnswer(raw);
  if (!answer) return fallback("invalid_output");
  const leak = checkAnswer(answer.answer, JSON.stringify(context));
  if (!leak.ok) {
    await audit(sql, { actorUserId: who.userId, action: "helpdesk.output_blocked", entityType: "helpdesk_conversation", entityId: conversationId,
      editionId: year, data: { count: leak.offending.length, model: model.ref, promptVersion: HELPDESK_PROMPT_VERSION } });
    return fallback("output_blocked");
  }
  const common = { ...meta, model: model.ref, promptVersion: HELPDESK_PROMPT_VERSION };
  if (answer.outcome === "needs_human") {
    const ticket = await sql.begin((tx) => escalateTx(tx, who, year, conversationId, `Help Desk: ${question.slice(0, 120)}`, question, now));
    return reply(`${answer.answer} I've passed this to the support team (reference ${ticket.ref}).`, { kind: "escalated", ticketId: ticket.id, ...common },
      { sources, ticket, canAskPerson: false });
  }
  return reply(answer.answer, { kind: answer.outcome === "answered" ? "answer" : "not_found", ...common }, { sources });
}
