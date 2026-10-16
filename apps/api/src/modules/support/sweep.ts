// Acknowledgement tracking for support tickets (FR-SUP-13, TBD-27; retries and escalation rules TBD-57).
// Runs in the background worker. For each unacknowledged ticket, under a row lock (so two workers, or a worker and a
// person acknowledging at the same moment, never double-act):
// - emergency / high priority past its acknowledgement window, not yet escalated → escalated to Management
//   automatically (an attribute; the status stays Open) and Management plus support are alerted;
// - emergency / high priority still Open → support is re-alerted every re-alert interval (one new round each time,
//   up to maxRealerts), and Management too once escalated;
// - normal priority past its window → support is alerted once that it is overdue.
// The windows and intervals come from the edition's support policy (defaults awaiting organiser approval).
import { SupportPolicy } from "@sj/contracts";
import type { Sql } from "../../db/client.js";
import { audit } from "../../platform/audit.js";
import { alertStaff } from "./service.js";

export type SweepResult = { escalated: number; reminders: number; overdue: number };

const DEFAULT_POLICY: SupportPolicy = {
  emergencyAckMinutes: 5, highAckMinutes: 30, normalAckMinutes: 120, emergencyRealertMinutes: 1, highRealertMinutes: 10, maxRealerts: 20,
};

export async function sweepSupport(sql: Sql, now: Date): Promise<SweepResult> {
  const out: SweepResult = { escalated: 0, reminders: 0, overdue: 0 };
  const candidates = await sql<{ id: string }[]>`
    select id from support_tickets
    where status = 'Open' and ((is_emergency or priority = 'high') or (ack_due_at <= ${now} and overdue_flagged_at is null))
    order by is_emergency desc, created_at limit 500`;
  for (const c of candidates) {
    await sql.begin(async (tx) => {
      const [t] = await tx<{ id: string; status: string; edition: number | null; priority: string; isEmergency: boolean; ackDueAt: Date;
        escalationLevel: number; alertRound: number; lastAlertAt: Date | null; overdueFlaggedAt: Date | null; policy: unknown }[]>`
        select t.id, t.status, t.edition_id as edition, t.priority, t.is_emergency as "isEmergency", t.ack_due_at as "ackDueAt",
               t.escalation_level as "escalationLevel", t.alert_round as "alertRound", t.last_alert_at as "lastAlertAt",
               t.overdue_flagged_at as "overdueFlaggedAt", e.support_policy as policy
        from support_tickets t left join event_editions e on e.id = t.edition_id
        where t.id = ${c.id} for update of t skip locked`;
      if (!t || t.status !== "Open") return;   // acknowledged meanwhile, or another worker has it
      const policy = SupportPolicy.safeParse(t.policy).success ? (t.policy as SupportPolicy) : DEFAULT_POLICY;
      const urgent = t.isEmergency || t.priority === "high";
      if (!urgent) {
        if (t.ackDueAt <= now && !t.overdueFlaggedAt) {
          await alertStaff(tx, t.id, "overdue", 0, now);
          await tx`update support_tickets set overdue_flagged_at = ${now} where id = ${t.id}`;
          await audit(tx, { actorUserId: null, action: "support.ticket_overdue", entityType: "support_ticket", entityId: t.id, editionId: t.edition,
            data: { windowMinutes: policy.normalAckMinutes } });
          out.overdue += 1;
        }
        return;
      }
      let escalatedNow = false;
      if (t.ackDueAt <= now && t.escalationLevel === 0) {
        const minutes = t.isEmergency ? policy.emergencyAckMinutes : policy.highAckMinutes;
        const reason = `Not acknowledged within ${minutes} minutes`;
        await tx`update support_tickets set escalated_to = 'management', escalation_level = 1, escalated_at = ${now}, escalated_by = null,
                   escalation_reason = ${reason} where id = ${t.id}`;
        await tx`insert into ticket_events (ticket_id, actor_id, kind, detail, at)
                 values (${t.id}, null, 'escalated', ${tx.json({ to: "management", level: 1, reason, automatic: true } as never)}, ${now})`;
        await alertStaff(tx, t.id, "escalation", 0, now, { management: true });
        await audit(tx, { actorUserId: null, action: "support.ticket_escalated_automatically", entityType: "support_ticket", entityId: t.id,
          editionId: t.edition, data: { reason, isEmergency: t.isEmergency } });
        out.escalated += 1;
        escalatedNow = true;
      }
      const every = (t.isEmergency ? policy.emergencyRealertMinutes : policy.highRealertMinutes) * 60_000;
      const last = t.lastAlertAt?.getTime() ?? 0;
      if (!escalatedNow && t.alertRound < policy.maxRealerts && now.getTime() - last >= every) {
        const round = t.alertRound + 1;
        await alertStaff(tx, t.id, "reminder", round, now, { management: t.escalationLevel > 0 });
        await tx`update support_tickets set alert_round = ${round}, last_alert_at = ${now} where id = ${t.id}`;
        out.reminders += 1;
      } else if (escalatedNow) {
        await tx`update support_tickets set last_alert_at = ${now} where id = ${t.id}`;
      }
    });
  }
  return out;
}
