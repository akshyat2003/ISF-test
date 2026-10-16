// In-app notifications (FR-NOT-*). Push, email, SMS and WhatsApp channels plug in later behind the same outbox
// (results: in-app plus the verified sign-in contact, TBD-14 in docs/DECISIONS.md). Idempotency keys make re-sends harmless (FR-NOT-04).
import type { NotificationItem } from "@sj/contracts";
import type { Db } from "../../db/client.js";
import { AppError } from "../../platform/errors.js";

export async function notifyInApp(
  db: Db,
  n: { userId: string; editionId: number | null; kind: string; title: string; body: string; idempotencyKey: string },
): Promise<boolean> {
  const rows = await db`
    insert into notifications (user_id, edition_id, kind, channel, title, body, status, sent_at, idempotency_key)
    values (${n.userId}, ${n.editionId}, ${n.kind}, 'in_app', ${n.title}, ${n.body}, 'sent', now(), ${n.idempotencyKey})
    on conflict (idempotency_key) do nothing
    returning id`;
  return rows.length === 1;
}

/** The in-app inbox. Notices show their current (corrected) text; withdrawn notices disappear (FR-NOT-06). */
export async function myNotifications(db: Db, userId: string): Promise<NotificationItem[]> {
  const rows = await db<{ id: string; edition: number | null; kind: string; title: string; body: string; createdAt: Date; readAt: Date | null }[]>`
    select m.id, m.edition_id as edition, m.kind, coalesce(n.title, m.title) as title, coalesce(n.body, m.body) as body,
           m.created_at as "createdAt", m.read_at as "readAt"
    from notifications m left join notices n on n.id = m.notice_id
    where m.user_id = ${userId} and m.channel = 'in_app' and n.withdrawn_at is null order by m.created_at desc limit 100`;
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), readAt: r.readAt?.toISOString() ?? null }));
}

/** Marks one of the caller's own in-app messages as read (counted as "read" in the notice's delivery figures). */
export async function markRead(db: Db, userId: string, id: string): Promise<{ read: true }> {
  const rows = await db`update notifications set read_at = coalesce(read_at, now())
    where id = ${id} and user_id = ${userId} and channel = 'in_app' returning id`;
  if (!rows.length) throw new AppError(404, "not_found", "Not found", "Message not found");
  return { read: true };
}

/**
 * Result notification wording (FR-SEL-05/06). DRAFT COPY — must be approved by the Management Team before
 * the first production release (TBD-14, docs/DECISIONS.md). Kept here so the text is reviewable in one place.
 */
export function resultMessage(o: { outcome: "selected" | "not_selected"; year: number; startupName: string; hasLaterApplication: boolean }) {
  if (o.outcome === "selected") {
    return {
      kind: "selection_result",
      title: `Congratulations — ${o.startupName} is selected for Startup Jathara ${o.year}`,
      body:
        `We are delighted to tell you that ${o.startupName} has been selected for Startup Jathara ${o.year}. ` +
        `Your ${o.year} event features are now available when you sign in. Further details will follow.`,
    };
  }
  const next = o.year + 1;
  return {
    kind: "selection_result",
    title: `Update on your Startup Jathara ${o.year} application`,
    body:
      `Thank you for applying to Startup Jathara ${o.year}. After careful review, ${o.startupName} has not been selected for the ${o.year} event. ` +
      (o.hasLaterApplication
        ? `Your ${next} application is separate, is not affected by this decision, and remains under review.`
        : `We encourage you to consider registering for Startup Jathara ${next}.`),
  };
}

/** Wording when a released decision is corrected (TBD-37). DRAFT COPY — awaiting Management approval like the above. */
export function correctionMessage(o: { outcome: "selected" | "not_selected"; year: number; startupName: string; hasLaterApplication: boolean }) {
  if (o.outcome === "selected") {
    return {
      kind: "decision_corrected",
      title: `Update: ${o.startupName} is selected for Startup Jathara ${o.year}`,
      body:
        `We are writing to correct an earlier message. After a review, ${o.startupName} has been selected for Startup Jathara ${o.year}. ` +
        `Your ${o.year} event features are now available when you sign in. We apologise for the confusion.`,
    };
  }
  const next = o.year + 1;
  return {
    kind: "decision_corrected",
    title: `Update on your Startup Jathara ${o.year} application`,
    body:
      `We are writing to correct an earlier message. After a review, ${o.startupName} is not selected for the ${o.year} event, and ` +
      `${o.year} event access has been removed. We apologise for the confusion. ` +
      (o.hasLaterApplication
        ? `Your ${next} application is separate, is not affected, and remains under review.`
        : `We encourage you to consider registering for Startup Jathara ${next}.`),
  };
}
