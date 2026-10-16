// Append-only audit trail (FR-AUD-*). The table rejects UPDATE/DELETE at the database level (DC-13).
import type { Db } from "../db/client.js";

export type AuditEvent = {
  actorUserId: string | null;
  actorType?: "user" | "service" | "system";
  action: string;
  entityType: string;
  entityId?: string | null;
  editionId?: number | null;
  data?: Record<string, unknown>;
};

export async function audit(db: Db, e: AuditEvent): Promise<void> {
  await db`
    insert into audit_events (actor_type, actor_user_id, action, entity_type, entity_id, edition_id, data)
    values (${e.actorType ?? (e.actorUserId ? "user" : "system")}, ${e.actorUserId}, ${e.action}, ${e.entityType},
            ${e.entityId ?? null}, ${e.editionId ?? null}, ${db.json((e.data ?? {}) as never)})`;
}
