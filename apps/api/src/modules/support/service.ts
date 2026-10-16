// Support tickets and emergencies (PRD §11.4–11.5, FR-SUP-*, FR-HD-10/11; decisions TBD-07, -27, -28 awaiting
// organisers, and TBD-55…57 in docs/DECISIONS.md).
// - Requesters raise and follow their own tickets; support staff (customer_support) handle them; Management reviews
//   them read-only and receives escalations.
// - Emergencies: the contacts (112 first) are returned before anything else is attempted, and an alert that cannot be
//   recorded never blocks them. A high-priority ticket is created (or a repeat report is added to the requester's open
//   emergency) and every active support person is alerted; with nobody on support, Management is alerted instead.
// - The lifecycle (Open → Acknowledged → In Progress → Resolved) is enforced again by a database trigger (0012).
// - Every action is a ticket event (append-only) and an audit event.
import {
  NATIONAL_EMERGENCY, SupportPolicy, ticketRef, type EmergencyContact, type EmergencyReport, type EmergencyResponse, type MyTicket,
  type RequesterMatch, type RequesterTicketCreate, type Role, type SupportAlerts, type SupportContactLog, type SupportNote, type SupportQueue,
  type SupportStatusUpdate, type SupportTicketCreate, type SupportTicketDetail, type SupportTicketSummary, type TicketRef, type TicketSource,
  type TicketStatus,
  normaliseMobile,
} from "@sj/contracts";
import { ruleViolation, type Db, type Sql } from "../../db/client.js";
import { audit } from "../../platform/audit.js";
import { AppError, forbidden, notFound } from "../../platform/errors.js";
import { permissionsOf, type Principal } from "../../platform/principal.js";
import { viewerTags } from "../content/service.js";
import { getEdition } from "../editions/service.js";
import { notifyInApp } from "../notifications/service.js";

export type AlertReason = "emergency" | "high_priority" | "reminder" | "escalation" | "overdue" | "no_support_staff" | "reported_again";

// ---------------------------------------------------------------- emergency contacts (TBD-07)
/**
 * 112 always first; then only the emergency contacts the Admin has PUBLISHED for this edition and this viewer's
 * audience (Phase 7 content). No number is ever invented here: until the organisers supply venue numbers, 112 is the
 * only one shown.
 */
export async function emergencyContacts(db: Db, userId: string | null, year: number): Promise<EmergencyContact[]> {
  const out: EmergencyContact[] = [{ title: NATIONAL_EMERGENCY.title, phone: NATIONAL_EMERGENCY.phone }];
  try {
    const tags = await viewerTags(db, userId ? { kind: "participant", userId } : { kind: "public" }, year);
    const rows = await db<{ title: string; body: { phone: string; available?: string | null; notes?: string | null } }[]>`
      select title, body from content_items
      where edition_id = ${year} and type = 'emergency_contact' and state = 'published' and audience && ${tags}
      order by title`;
    for (const r of rows) out.push({ title: r.title, phone: r.body.phone, available: r.body.available ?? null, notes: r.body.notes ?? null });
  } catch {
    // Contacts are never withheld because the database had a problem: 112 still goes out.
  }
  return out;
}

// ---------------------------------------------------------------- recipients and alerts
async function activeSupport(db: Db): Promise<string[]> {
  const rows = await db<{ id: string }[]>`
    select distinct u.id from user_accounts u join role_grants g on g.user_id = u.id and g.role = 'customer_support' and g.revoked_at is null
    where u.status = 'active' order by u.id`;
  return rows.map((r) => r.id);
}

async function activeManagement(db: Db): Promise<string[]> {
  const rows = await db<{ id: string }[]>`
    select distinct u.id from user_accounts u join role_grants g on g.user_id = u.id and g.role = 'management' and g.revoked_at is null
    where u.status = 'active' order by u.id`;
  return rows.map((r) => r.id);
}

/**
 * Alerts support staff about a ticket (one row per recipient and round, so retries never duplicate). With no active
 * support staff, Management is alerted instead so an emergency never goes unseen. `management: true` adds Management
 * (escalations). Returns the number of people alerted.
 */
export async function alertStaff(tx: Db, ticketId: string, reason: AlertReason, round: number, now: Date, o: { management?: boolean } = {}): Promise<number> {
  const support = await activeSupport(tx);
  const rows: { recipient: string; reason: AlertReason }[] = support.map((id) => ({ recipient: id, reason }));
  if (o.management || support.length === 0) {
    const mgmt = await activeManagement(tx);
    for (const id of mgmt) {
      if (!support.includes(id)) rows.push({ recipient: id, reason: support.length === 0 && !o.management ? "no_support_staff" : reason });
    }
  }
  let n = 0;
  for (const r of rows) {
    const ins = await tx`
      insert into support_alerts (ticket_id, recipient_id, reason, round, created_at) values (${ticketId}, ${r.recipient}, ${r.reason}, ${round}, ${now})
      on conflict do nothing returning id`;
    n += ins.length;
  }
  return n;
}

// ---------------------------------------------------------------- creating tickets
export type NewTicket = {
  edition: number;
  subject: string;
  description?: string | null;
  priority: "normal" | "high";
  isEmergency: boolean;
  source: TicketSource;
  requesterId?: string | null;
  contact?: { name: string; phone?: string | null } | null;
  createdBy?: string | null;
  conversationId?: string | null;
  clientRequestId?: string | null;
};

/** Inside a transaction. Emergencies and high-priority tickets alert staff at once (round 0). */
export async function createTicket(tx: Db, t: NewTicket, now: Date): Promise<{ id: string; ref: string; alerted: number }> {
  const [row] = await tx<{ id: string; number: string }[]>`
    insert into support_tickets (edition_id, requester_id, conversation_id, priority, is_emergency, subject, description, source, created_by,
                                 contact_name, contact_phone, client_request_id, created_at, last_alert_at)
    values (${t.edition}, ${t.requesterId ?? null}, ${t.conversationId ?? null}, ${t.priority}, ${t.isEmergency}, ${t.subject},
            ${t.description ?? null}, ${t.source}, ${t.createdBy ?? null}, ${t.contact?.name ?? null}, ${t.contact?.phone ?? null},
            ${t.clientRequestId ?? null}, ${now}, ${t.isEmergency || t.priority === "high" ? now : null})
    returning id, number::text`;
  const actor = t.createdBy ?? t.requesterId ?? null;
  await tx`insert into ticket_events (ticket_id, actor_id, kind, detail, at)
           values (${row!.id}, ${actor}, 'created', ${tx.json({ source: t.source, priority: t.priority, isEmergency: t.isEmergency } as never)}, ${now})`;
  let alerted = 0;
  if (t.isEmergency) alerted = await alertStaff(tx, row!.id, "emergency", 0, now);
  else if (t.priority === "high") alerted = await alertStaff(tx, row!.id, "high_priority", 0, now);
  await audit(tx, { actorUserId: actor, action: t.isEmergency ? "support.emergency_reported" : "support.ticket_created", entityType: "support_ticket",
    entityId: row!.id, editionId: t.edition, data: { source: t.source, priority: t.priority, isEmergency: t.isEmergency, alerted } });
  return { id: row!.id, ref: ticketRef(Number(row!.number)), alerted };
}

/**
 * The emergency control (FR-HD-10/11, AT-31). Contacts first; the ticket and alerts are best effort and never delay
 * or replace them. A repeat report while the requester's emergency is still open is added to that ticket and staff
 * are re-alerted immediately (TBD-55). Retries with the same clientRequestId return the same ticket.
 */
export async function reportEmergency(sql: Sql, userId: string | null, year: number, input: EmergencyReport, now: Date,
  o: { conversationId?: string | null; source?: TicketSource; onError?: (err: unknown) => void } = {}): Promise<EmergencyResponse> {
  const contacts = await emergencyContacts(sql, userId, year);
  if (!userId) return { contacts, ticket: null, alerted: 0, reportedAgain: false };
  try {
    await getEdition(sql, year);
    return await sql.begin(async (tx) => {
      // One report at a time per person, so two quick taps cannot open two emergencies.
      await tx`select pg_advisory_xact_lock(hashtextextended(${`emergency:${userId}`}, 0))`;
      const [same] = await tx<{ id: string; number: string }[]>`
        select id, number::text from support_tickets where requester_id = ${userId} and client_request_id = ${input.clientRequestId}`;
      if (same) return { contacts, ticket: { id: same.id, ref: ticketRef(Number(same.number)) }, alerted: 0, reportedAgain: false };
      const [open] = await tx<{ id: string; number: string; alertRound: number }[]>`
        select id, number::text, alert_round as "alertRound" from support_tickets
        where requester_id = ${userId} and edition_id = ${year} and is_emergency and status <> 'Resolved'
        order by created_at desc limit 1 for update`;
      if (open) {
        const round = open.alertRound + 1;
        await tx`insert into ticket_events (ticket_id, actor_id, kind, detail, at)
                 values (${open.id}, ${userId}, 'requester_note', ${tx.json({ text: input.message ?? "Reported the emergency again.", reportedAgain: true } as never)}, ${now})`;
        const alerted = await alertStaff(tx, open.id, "reported_again", round, now);
        await tx`update support_tickets set alert_round = ${round}, last_alert_at = ${now} where id = ${open.id}`;
        await audit(tx, { actorUserId: userId, action: "support.emergency_reported_again", entityType: "support_ticket", entityId: open.id,
          editionId: year, data: { alerted } });
        return { contacts, ticket: { id: open.id, ref: ticketRef(Number(open.number)) }, alerted, reportedAgain: true };
      }
      const t = await createTicket(tx, {
        edition: year, subject: "Emergency reported", description: input.message ?? null, priority: "high", isEmergency: true,
        source: o.source ?? "emergency_control", requesterId: userId, conversationId: o.conversationId ?? null, clientRequestId: input.clientRequestId,
      }, now);
      return { contacts, ticket: { id: t.id, ref: t.ref }, alerted: t.alerted, reportedAgain: false };
    });
  } catch (err) {
    // The alert could not be recorded (unknown edition, database trouble). The person still gets the contacts; the
    // app then says the alert did not go through and to call 112. The error goes to the server log.
    o.onError?.(err);
    return { contacts, ticket: null, alerted: 0, reportedAgain: false };
  }
}

// ---------------------------------------------------------------- requester views (FR-SUP-15)
type MyRow = {
  id: string; number: string; edition: number | null; subject: string | null; status: TicketStatus; priority: "normal" | "high"; isEmergency: boolean;
  createdAt: Date; updatedAt: Date;
};

async function requesterUpdates(db: Db, ids: string[]) {
  if (!ids.length) return [];
  return db<{ ticketId: string; kind: "created" | "status" | "reply" | "requester_note"; detail: Record<string, unknown>; at: Date }[]>`
    select ticket_id as "ticketId", kind, detail, at from ticket_events
    where ticket_id in ${db(ids)} and kind in ('created', 'status', 'reply', 'requester_note') order by id`;
}

function updateText(kind: string, d: Record<string, unknown>): string {
  if (kind === "created") return "Request received.";
  if (kind === "status") return `Status: ${String(d.to)}`;
  return String(d.text ?? "");
}

export async function myTickets(db: Db, userId: string, year?: number): Promise<MyTicket[]> {
  const rows = await db<MyRow[]>`
    select id, number::text, edition_id as edition, subject, status, priority, is_emergency as "isEmergency", created_at as "createdAt",
           updated_at as "updatedAt"
    from support_tickets where requester_id = ${userId} ${year ? db`and edition_id = ${year}` : db``}
    order by created_at desc limit 50`;
  const ups = await requesterUpdates(db, rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id, ref: ticketRef(Number(r.number)), edition: r.edition, subject: r.subject ?? "Support request", status: r.status, priority: r.priority,
    isEmergency: r.isEmergency, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
    updates: ups.filter((u) => u.ticketId === r.id).map((u) => ({ at: u.at.toISOString(), kind: u.kind, text: updateText(u.kind, u.detail) })),
  }));
}

export async function createOwnTicket(sql: Sql, p: Principal, input: RequesterTicketCreate, now: Date): Promise<MyTicket> {
  await getEdition(sql, input.edition);
  const id = await sql.begin(async (tx) => (await createTicket(tx, {
    edition: input.edition, subject: input.subject, description: input.description ?? null, priority: "normal", isEmergency: false,
    source: "requester", requesterId: p.account!.id,
  }, now)).id);
  return (await myTickets(sql, p.account!.id)).find((t) => t.id === id)!;
}

export async function addRequesterNote(sql: Sql, p: Principal, id: string, text: string, now: Date): Promise<MyTicket> {
  await sql.begin(async (tx) => {
    const [t] = await tx<{ status: TicketStatus; edition: number | null }[]>`
      select status, edition_id as edition from support_tickets where id = ${id} and requester_id = ${p.account!.id} for update`;
    if (!t) throw notFound("Ticket");
    if (t.status === "Resolved") throw new AppError(409, "ticket_resolved", "Already resolved", "This request is resolved. Start a new one if you still need help.");
    await tx`insert into ticket_events (ticket_id, actor_id, kind, detail, at) values (${id}, ${p.account!.id}, 'requester_note', ${tx.json({ text } as never)}, ${now})`;
    await audit(tx, { actorUserId: p.account!.id, action: "support.requester_note", entityType: "support_ticket", entityId: id, editionId: t.edition });
  });
  return (await myTickets(sql, p.account!.id)).find((t) => t.id === id)!;
}

// ---------------------------------------------------------------- support staff views
type TicketRow = {
  id: string; number: string; edition: number | null; subject: string | null; status: TicketStatus; priority: "normal" | "high"; isEmergency: boolean;
  source: TicketSource | null; requesterId: string | null; requesterName: string | null; contactName: string | null; contactPhone: string | null;
  assigneeId: string | null; assigneeName: string | null; createdAt: Date; ackDueAt: Date | null; acknowledgedAt: Date | null;
  escalatedTo: "management" | null; escalationLevel: number; escalatedAt: Date | null; escalationReason: string | null; escalatedByName: string | null;
  description: string | null; conversationId: string | null; acknowledgedByName: string | null; resolvedByName: string | null; resolvedAt: Date | null;
  resolutionNote: string | null; alertRound: number;
};
const TICKET_SELECT = (db: Db) => db`
  select t.id, t.number::text, t.edition_id as edition, t.subject, t.status, t.priority, t.is_emergency as "isEmergency", t.source,
         t.requester_id as "requesterId", ru.full_name as "requesterName", t.contact_name as "contactName", t.contact_phone as "contactPhone",
         t.assignee_id as "assigneeId", au.full_name as "assigneeName", t.created_at as "createdAt", t.ack_due_at as "ackDueAt",
         t.acknowledged_at as "acknowledgedAt", t.escalated_to as "escalatedTo", t.escalation_level as "escalationLevel",
         t.escalated_at as "escalatedAt", t.escalation_reason as "escalationReason", eu.full_name as "escalatedByName",
         t.description, t.conversation_id as "conversationId", ku.full_name as "acknowledgedByName", vu.full_name as "resolvedByName",
         t.resolved_at as "resolvedAt", t.resolution_note as "resolutionNote", t.alert_round as "alertRound"
  from support_tickets t
  left join user_accounts ru on ru.id = t.requester_id left join user_accounts au on au.id = t.assignee_id
  left join user_accounts eu on eu.id = t.escalated_by left join user_accounts ku on ku.id = t.acknowledged_by
  left join user_accounts vu on vu.id = t.resolved_by`;

const toSummary = (r: TicketRow, now: Date): SupportTicketSummary => ({
  id: r.id, ref: ticketRef(Number(r.number)), edition: r.edition, subject: r.subject ?? "Support request", status: r.status, priority: r.priority,
  isEmergency: r.isEmergency, source: r.source, requesterName: r.requesterName ?? r.contactName ?? "Unknown",
  assignee: r.assigneeId ? { id: r.assigneeId, name: r.assigneeName! } : null, createdAt: r.createdAt.toISOString(),
  ackDueAt: r.ackDueAt?.toISOString() ?? null, acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
  overdue: r.status === "Open" && !!r.ackDueAt && r.ackDueAt <= now,
  escalation: r.escalatedTo
    ? { to: r.escalatedTo, level: r.escalationLevel, at: r.escalatedAt!.toISOString(), reason: r.escalationReason!, by: r.escalatedByName }
    : null,
});

export const canHandle = (p: Principal) => permissionsOf(p).has("support.handle");

export async function supportQueue(db: Db, p: Principal, f: { edition?: number; status?: TicketStatus | "active"; mine?: boolean }, now: Date): Promise<SupportQueue> {
  const rows = await db<TicketRow[]>`${TICKET_SELECT(db)}
    where true
      ${f.edition ? db`and t.edition_id = ${f.edition}` : db``}
      ${f.status === "active" || !f.status ? db`and t.status <> 'Resolved'` : db`and t.status = ${f.status}`}
      ${f.mine ? db`and t.assignee_id = ${p.account!.id}` : db``}
    order by (t.status = 'Open' and t.is_emergency) desc, (t.status = 'Open') desc, t.is_emergency desc, (t.priority = 'high') desc, t.created_at
    limit 300`;
  const [c] = await db<{ open: number; emergencies: number; overdue: number; escalated: number }[]>`
    select count(*) filter (where status <> 'Resolved')::int as open,
           count(*) filter (where status = 'Open' and is_emergency)::int as emergencies,
           count(*) filter (where status = 'Open' and ack_due_at <= ${now})::int as overdue,
           count(*) filter (where status <> 'Resolved' and escalated_to is not null)::int as escalated
    from support_tickets ${f.edition ? db`where edition_id = ${f.edition}` : db``}`;
  const staff = await db<{ id: string; name: string }[]>`
    select distinct u.id, u.full_name as name from user_accounts u join role_grants g on g.user_id = u.id and g.role = 'customer_support' and g.revoked_at is null
    where u.status = 'active'`;
  return {
    tickets: rows.map((r) => toSummary(r, now)),
    counts: { open: c!.open, unacknowledgedEmergencies: c!.emergencies, overdue: c!.overdue, escalated: c!.escalated },
    staff: [...staff].sort((a, b) => a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id)), canEdit: canHandle(p),
  };
}

/** FR-SUP-02: the ticket with the authorised requester details. Every view is audited (access to contact details). */
export async function ticketDetail(sql: Sql, p: Principal, id: string, now: Date): Promise<SupportTicketDetail> {
  const [r] = await sql<TicketRow[]>`${TICKET_SELECT(sql)} where t.id = ${id}`;
  if (!r) throw notFound("Ticket");
  let requester: SupportTicketDetail["requester"] = null;
  if (r.requesterId) {
    const [u] = await sql<{ id: string; name: string; email: string | null; mobile: string | null }[]>`
      select id, full_name as name, email, mobile_e164 as mobile from user_accounts where id = ${r.requesterId}`;
    const roles = await sql<{ role: Role }[]>`
      select distinct role from role_grants where user_id = ${r.requesterId} and revoked_at is null
        and (edition_id is null or ${r.edition}::smallint is null or edition_id = ${r.edition}) order by role`;
    const [s] = await sql<{ name: string }[]>`
      select s.name from startup_memberships m join startups s on s.id = m.startup_id where m.user_id = ${r.requesterId} limit 1`;
    requester = { ...u!, roles: roles.map((x) => x.role), startup: s?.name ?? null };
  }
  const events = await sql<{ id: string; kind: string; actor: string | null; at: Date; detail: Record<string, unknown> }[]>`
    select e.id::text, e.kind, u.full_name as actor, e.at, e.detail from ticket_events e left join user_accounts u on u.id = e.actor_id
    where e.ticket_id = ${id} order by e.id`;
  const transcript = r.conversationId
    ? (await sql<{ role: "user" | "assistant"; text: string; at: Date }[]>`
        select role, content as text, at from helpdesk_messages where conversation_id = ${r.conversationId} and role in ('user', 'assistant')
        order by id`).map((m) => ({ role: m.role, text: m.text, at: m.at.toISOString() }))
    : null;
  const [a] = await sql<{ sent: number; seen: number }[]>`
    select count(*)::int as sent, count(seen_at)::int as seen from support_alerts where ticket_id = ${id}`;
  await audit(sql, { actorUserId: p.account!.id, action: "support.ticket_viewed", entityType: "support_ticket", entityId: id, editionId: r.edition });
  return {
    ...toSummary(r, now), description: r.description, requester,
    contact: r.contactName ? { name: r.contactName, phone: r.contactPhone } : null,
    acknowledgedBy: r.acknowledgedByName, resolvedBy: r.resolvedByName, resolvedAt: r.resolvedAt?.toISOString() ?? null,
    resolutionNote: r.resolutionNote, events: events.map((e) => ({ ...e, at: e.at.toISOString() })), transcript,
    alerts: { sent: a!.sent, seen: a!.seen, rounds: r.alertRound }, canEdit: canHandle(p) && r.status !== "Resolved",
  };
}

// ---------------------------------------------------------------- support actions
async function lockTicket(tx: Db, id: string) {
  const [t] = await tx<{ id: string; status: TicketStatus; edition: number | null; requesterId: string | null; number: string; priority: string;
    isEmergency: boolean; escalatedTo: string | null }[]>`
    select id, status, edition_id as edition, requester_id as "requesterId", number::text, priority, is_emergency as "isEmergency",
           escalated_to as "escalatedTo"
    from support_tickets where id = ${id} for update`;
  if (!t) throw notFound("Ticket");
  return t;
}

function mapRule(err: unknown): never {
  const hint = ruleViolation(err);
  if (hint === "TICKET-LIFECYCLE") throw new AppError(409, "invalid_transition", "Not allowed in this status", (err as Error).message);
  if (hint === "SUPPORT-STAFF") throw new AppError(409, "not_support_staff", "Not active support staff", (err as Error).message);
  throw err;
}

async function tellRequester(tx: Db, t: { id: string; number: string; requesterId: string | null; edition: number | null }, eventId: string, title: string, body: string) {
  if (!t.requesterId) return;
  await notifyInApp(tx, { userId: t.requesterId, editionId: t.edition, kind: "support_update", title, body, idempotencyKey: `ticket:${t.id}:event:${eventId}` });
}

async function event(tx: Db, ticketId: string, actor: string | null, kind: string, detail: object, now: Date): Promise<string> {
  const [e] = await tx<{ id: string }[]>`
    insert into ticket_events (ticket_id, actor_id, kind, detail, at) values (${ticketId}, ${actor}, ${kind}, ${tx.json(detail as never)}, ${now})
    returning id::text`;
  return e!.id;
}

/** FR-SUP-09: support acknowledges. Two people acknowledging at once: one wins, the other is told it is done. */
export async function acknowledge(sql: Sql, p: Principal, id: string, now: Date): Promise<SupportTicketDetail> {
  try {
    await sql.begin(async (tx) => {
      const t = await lockTicket(tx, id);
      if (t.status !== "Open") throw new AppError(409, "already_acknowledged", "Already acknowledged", "Someone has already acknowledged this ticket.");
      await tx`update support_tickets set status = 'Acknowledged', acknowledged_at = ${now}, acknowledged_by = ${p.account!.id},
                 assignee_id = coalesce(assignee_id, ${p.account!.id}) where id = ${id}`;
      const ev = await event(tx, id, p.account!.id, "status", { from: "Open", to: "Acknowledged" }, now);
      await tellRequester(tx, t, ev, `${ticketRef(Number(t.number))}: support has your request`, "A member of the support team has acknowledged your request.");
      await audit(tx, { actorUserId: p.account!.id, action: "support.ticket_acknowledged", entityType: "support_ticket", entityId: id, editionId: t.edition,
        data: { isEmergency: t.isEmergency } });
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    mapRule(err);
  }
  return ticketDetail(sql, p, id, now);
}

export async function setStatus(sql: Sql, p: Principal, id: string, u: SupportStatusUpdate, now: Date): Promise<SupportTicketDetail> {
  try {
    await sql.begin(async (tx) => {
      const t = await lockTicket(tx, id);
      if (t.status === "Open") throw new AppError(409, "invalid_transition", "Acknowledge first", "Acknowledge the ticket before changing its status.");
      if (t.status === u.status) throw new AppError(409, "invalid_transition", "No change", `The ticket is already ${t.status}.`);
      const note = u.note?.trim() || null;
      if (u.status === "Resolved") {
        await tx`update support_tickets set status = 'Resolved', resolved_at = ${now}, resolved_by = ${p.account!.id}, resolution_note = ${note} where id = ${id}`;
      } else {
        await tx`update support_tickets set status = ${u.status} where id = ${id}`;
      }
      const ev = await event(tx, id, p.account!.id, "status", { from: t.status, to: u.status, ...(note ? { note } : {}) }, now);
      await tellRequester(tx, t, ev, `${ticketRef(Number(t.number))}: ${u.status === "Resolved" ? "resolved" : "in progress"}`,
        u.status === "Resolved" ? `Your request has been resolved.${note ? ` ${note}` : ""}` : "The support team is working on your request.");
      await audit(tx, { actorUserId: p.account!.id, action: "support.ticket_status", entityType: "support_ticket", entityId: id, editionId: t.edition,
        data: { from: t.status, to: u.status } });
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    mapRule(err);
  }
  return ticketDetail(sql, p, id, now);
}

export async function assign(sql: Sql, p: Principal, id: string, assigneeId: string | null, now: Date): Promise<SupportTicketDetail> {
  try {
    await sql.begin(async (tx) => {
      const t = await lockTicket(tx, id);
      if (t.status === "Resolved") throw new AppError(409, "ticket_resolved", "Resolved", "A resolved ticket cannot be reassigned.");
      if (assigneeId) {
        const [ok] = await tx<{ ok: boolean }[]>`select sj_is_active_support(${assigneeId}) as ok`;
        if (!ok!.ok) throw new AppError(409, "not_support_staff", "Not support staff", "Tickets are assigned only to active support staff.");
      }
      await tx`update support_tickets set assignee_id = ${assigneeId} where id = ${id}`;
      await event(tx, id, p.account!.id, "assigned", { assigneeId }, now);
      await audit(tx, { actorUserId: p.account!.id, action: "support.ticket_assigned", entityType: "support_ticket", entityId: id, editionId: t.edition,
        data: { assigneeId } });
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    mapRule(err);
  }
  return ticketDetail(sql, p, id, now);
}

/** FR-SUP-05: an internal note, or a reply the requester sees in the app (FR-SUP-15). */
export async function addNote(sql: Sql, p: Principal, id: string, n: SupportNote, now: Date): Promise<SupportTicketDetail> {
  await sql.begin(async (tx) => {
    const t = await lockTicket(tx, id);
    if (t.status === "Resolved") throw new AppError(409, "ticket_resolved", "Resolved", "A resolved ticket is closed.");
    const kind = n.visibility === "requester" ? "reply" : "note";
    if (kind === "reply" && !t.requesterId) throw new AppError(409, "no_requester_account", "No account", "This requester has no account; contact them directly and log it.");
    const ev = await event(tx, id, p.account!.id, kind, { text: n.text }, now);
    if (kind === "reply") await tellRequester(tx, t, ev, `${ticketRef(Number(t.number))}: message from support`, n.text);
    await audit(tx, { actorUserId: p.account!.id, action: kind === "reply" ? "support.ticket_reply" : "support.ticket_note", entityType: "support_ticket",
      entityId: id, editionId: t.edition });
  });
  return ticketDetail(sql, p, id, now);
}

/** FR-SUP-04: support contacted the requester (by their authorised details) — what was done, and the outcome. */
export async function logContact(sql: Sql, p: Principal, id: string, c: SupportContactLog, now: Date): Promise<SupportTicketDetail> {
  await sql.begin(async (tx) => {
    const t = await lockTicket(tx, id);
    if (t.status === "Resolved") throw new AppError(409, "ticket_resolved", "Resolved", "A resolved ticket is closed.");
    await event(tx, id, p.account!.id, "contact", { method: c.method, outcome: c.outcome }, now);
    await audit(tx, { actorUserId: p.account!.id, action: "support.requester_contacted", entityType: "support_ticket", entityId: id, editionId: t.edition,
      data: { method: c.method } });
  });
  return ticketDetail(sql, p, id, now);
}

/** FR-SUP-07/12: escalate to Management (TBD-27). An attribute; the status does not change. */
export async function escalate(sql: Sql, p: Principal, id: string, reason: string, now: Date): Promise<SupportTicketDetail> {
  try {
    await sql.begin(async (tx) => {
      const t = await lockTicket(tx, id);
      if (t.status === "Resolved") throw new AppError(409, "ticket_resolved", "Resolved", "A resolved ticket cannot be escalated.");
      if (t.escalatedTo) throw new AppError(409, "already_escalated", "Already escalated", "This ticket is already escalated to Management.");
      await tx`update support_tickets set escalated_to = 'management', escalation_level = 1, escalated_at = ${now}, escalated_by = ${p.account!.id},
                 escalation_reason = ${reason} where id = ${id}`;
      await event(tx, id, p.account!.id, "escalated", { to: "management", level: 1, reason }, now);
      await alertStaff(tx, id, "escalation", 0, now, { management: true });
      await audit(tx, { actorUserId: p.account!.id, action: "support.ticket_escalated", entityType: "support_ticket", entityId: id, editionId: t.edition,
        data: { reason } });
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    mapRule(err);
  }
  return ticketDetail(sql, p, id, now);
}

/** Raise a normal ticket to high priority (never lowered). An unacknowledged ticket gets the tighter window. */
export async function raisePriority(sql: Sql, p: Principal, id: string, now: Date): Promise<SupportTicketDetail> {
  await sql.begin(async (tx) => {
    const t = await lockTicket(tx, id);
    if (t.status === "Resolved") throw new AppError(409, "ticket_resolved", "Resolved", "A resolved ticket is closed.");
    if (t.priority === "high") throw new AppError(409, "already_high", "Already high priority", "This ticket is already high priority.");
    await tx`update support_tickets set priority = 'high', last_alert_at = coalesce(last_alert_at, ${now}) where id = ${id}`;
    await event(tx, id, p.account!.id, "priority", { from: "normal", to: "high" }, now);
    if (t.status === "Open") await alertStaff(tx, id, "high_priority", 0, now);
    await audit(tx, { actorUserId: p.account!.id, action: "support.ticket_priority_raised", entityType: "support_ticket", entityId: id, editionId: t.edition });
  });
  return ticketDetail(sql, p, id, now);
}

/** FR-SUP-14: a ticket for someone who calls or walks in — an existing account, or the caller's name and number. */
export async function createOnBehalf(sql: Sql, p: Principal, input: SupportTicketCreate & { priority: "normal" | "high"; isEmergency: boolean }, now: Date): Promise<SupportTicketDetail> {
  await getEdition(sql, input.edition);
  if (input.requesterId) {
    const [u] = await sql`select 1 from user_accounts where id = ${input.requesterId} and status <> 'deactivated'`;
    if (!u) throw new AppError(400, "validation_failed", "Some fields are invalid", undefined, { errors: [{ path: "requesterId", message: "No such account" }] });
  }
  const id = await sql.begin(async (tx) => (await createTicket(tx, {
    edition: input.edition, subject: input.subject, description: input.description ?? null, priority: input.priority, isEmergency: input.isEmergency,
    source: "support_staff", requesterId: input.requesterId ?? null, contact: input.contact ?? null, createdBy: p.account!.id,
  }, now)).id);
  return ticketDetail(sql, p, id, now);
}

/** Finds an account by its exact email or mobile number only (no browsing of the participant list). */
export async function findRequester(db: Db, q: string): Promise<RequesterMatch[]> {
  const term = q.trim();
  const mobile = normaliseMobile(term);
  const rows = await db<{ id: string; name: string; roles: Role[] }[]>`
    select u.id, u.full_name as name, coalesce(array_agg(distinct g.role) filter (where g.role is not null), '{}') as roles
    from user_accounts u left join role_grants g on g.user_id = u.id and g.revoked_at is null
    where u.status <> 'deactivated' and (lower(u.email) = lower(${term}) ${mobile ? db`or u.mobile_e164 = ${mobile}` : db``})
    group by u.id, u.full_name limit 5`;
  return [...rows];
}

// ---------------------------------------------------------------- alerts for staff (support and Management)
export async function myAlerts(db: Db, p: Principal): Promise<SupportAlerts> {
  const rows = await db<{ id: string; ticketId: string; number: string; subject: string | null; isEmergency: boolean; status: TicketStatus;
    reason: SupportAlerts["alerts"][number]["reason"]; round: number; createdAt: Date }[]>`
    select a.id::text, a.ticket_id as "ticketId", t.number::text, t.subject, t.is_emergency as "isEmergency", t.status, a.reason, a.round,
           a.created_at as "createdAt"
    from support_alerts a join support_tickets t on t.id = a.ticket_id
    where a.recipient_id = ${p.account!.id} and a.seen_at is null and t.status <> 'Resolved'
    order by t.is_emergency desc, a.created_at desc limit 50`;
  const [c] = await db<{ n: number }[]>`select count(*)::int as n from support_tickets where status = 'Open' and is_emergency`;
  return {
    alerts: rows.map((r) => ({ id: r.id, ticketId: r.ticketId, ref: ticketRef(Number(r.number)), subject: r.subject ?? "Support request",
      isEmergency: r.isEmergency, status: r.status, reason: r.reason, round: r.round, createdAt: r.createdAt.toISOString() })),
    unacknowledgedEmergencies: c!.n,
  };
}

export async function markAlertSeen(db: Db, p: Principal, id: string, now: Date): Promise<{ seen: true }> {
  const rows = await db`update support_alerts set seen_at = ${now} where id = ${id} and recipient_id = ${p.account!.id} and seen_at is null returning id`;
  if (!rows.length) {
    const [mine] = await db`select 1 from support_alerts where id = ${id} and recipient_id = ${p.account!.id}`;
    if (!mine) throw notFound("Alert");
  }
  return { seen: true };
}

// ---------------------------------------------------------------- per-edition policy (TBD-27)
export async function getPolicy(db: Db, year: number): Promise<SupportPolicy> {
  const [r] = await db<{ p: unknown }[]>`select support_policy as p from event_editions where id = ${year}`;
  if (!r) throw new AppError(404, "edition_not_found", "Not found", `There is no ${year} edition`);
  return SupportPolicy.parse(r.p);
}

export async function setPolicy(sql: Sql, p: Principal, year: number, policy: SupportPolicy): Promise<SupportPolicy> {
  await sql.begin(async (tx) => {
    const previous = await getPolicy(tx, year);
    await tx`update event_editions set support_policy = ${tx.json(policy as never)}, updated_at = now() where id = ${year}`;
    await audit(tx, { actorUserId: p.account!.id, action: "support.policy_changed", entityType: "event_edition", entityId: String(year), editionId: year,
      data: { previous, next: policy } });
  });
  return getPolicy(sql, year);
}

/** Read-only review for Management: the queue and ticket details without edit rights (FR-SUP-10). */
export function assertCanRead(p: Principal) {
  const perms = permissionsOf(p);
  if (!perms.has("support.handle") && !perms.has("support.review")) throw forbidden();
}

export type { TicketRef };
