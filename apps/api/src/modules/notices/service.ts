// Notices and push notifications (PRD §10, FR-NOT-01…08; decisions TBD-29, TBD-52 in docs/DECISIONS.md).
// Management publishes a notice to everyone, to participant roles or to a named authorised group of one edition. The
// audience is resolved on the server, inside that edition only (FR-NOT-05): only people with access to the edition
// and the matching role or group membership receive it. Each recipient gets an in-app notice; with push chosen, each
// of their registered devices gets one queued push message, delivered by the outbox worker with tracked status.
// Notices are never deleted: text corrections and withdrawals are audited (FR-NOT-06).
import {
  AUDIENCE_LABEL, PARTICIPANT_ROLES, type ManagedNotice, type NoticeAudience, type NoticeCreate, type NoticeEdit, type NoticeGroup,
  type NoticePreview, type NoticesOverview, type ParticipantRef, type PushTokenRegister, type Role,
} from "@sj/contracts";
import { ruleViolation, type Db, type Sql } from "../../db/client.js";
import { audit } from "../../platform/audit.js";
import { AppError, notFound } from "../../platform/errors.js";
import type { Principal } from "../../platform/principal.js";
import { getEdition } from "../editions/service.js";

export const PUSH_BODY_MAX = 178;

// ---------------------------------------------------------------- audience resolution (server-side, edition-scoped)
/** Everyone who takes part in the edition as a participant: unrevoked edition access, a participant role, not deactivated. */
const PARTICIPANTS = (db: Db, year: number, roles: readonly string[]) => db`
  select distinct u.id from user_accounts u
  join edition_access a on a.user_id = u.id and a.edition_id = ${year} and a.revoked_at is null
  join role_grants g on g.user_id = u.id and g.revoked_at is null and (g.edition_id is null or g.edition_id = ${year})
                     and g.role in ${db(roles as string[])}
  where u.status <> 'deactivated'`;

export async function resolveRecipients(db: Db, year: number, a: NoticeAudience): Promise<string[]> {
  if (a.kind === "group") {
    const rows = await db<{ id: string }[]>`
      select u.id from notice_group_members m join notice_groups g on g.id = m.group_id and g.edition_id = ${year} and g.archived_at is null
      join user_accounts u on u.id = m.user_id and u.status <> 'deactivated'
      join edition_access a on a.user_id = u.id and a.edition_id = ${year} and a.revoked_at is null
      where m.group_id = ${a.groupId}`;
    return rows.map((r) => r.id);
  }
  const rows = await db<{ id: string }[]>`${PARTICIPANTS(db, year, a.kind === "roles" ? a.roles : PARTICIPANT_ROLES)}`;
  return rows.map((r) => r.id);
}

async function checkAudience(db: Db, year: number, a: NoticeAudience) {
  if (a.kind !== "group") return;
  const [g] = await db`select 1 from notice_groups where id = ${a.groupId} and edition_id = ${year} and archived_at is null`;
  if (!g) {
    throw new AppError(400, "validation_failed", "Some fields are invalid", undefined, {
      errors: [{ path: "audience.groupId", message: `Not an authorised group of the ${year} event` }],
    });
  }
}

async function audienceLabel(db: Db, a: NoticeAudience): Promise<string> {
  if (a.kind === "everyone") return "Everyone (all participants)";
  if (a.kind === "roles") return a.roles.map((r) => AUDIENCE_LABEL[r]).join(", ");
  const [g] = await db<{ name: string }[]>`select name from notice_groups where id = ${a.groupId}`;
  return `Group: ${g?.name ?? "?"}`;
}

export async function previewNotice(db: Db, year: number, a: NoticeAudience): Promise<NoticePreview> {
  await getEdition(db, year);
  await checkAudience(db, year, a);
  const ids = await resolveRecipients(db, year, a);
  if (!ids.length) return { recipients: 0, withDevice: 0, devices: 0 };
  const [d] = await db<{ withDevice: number; devices: number }[]>`
    select count(distinct user_id)::int as "withDevice", count(*)::int as devices from push_tokens
    where disabled_at is null and user_id in ${db(ids)}`;
  return { recipients: ids.length, withDevice: d!.withDevice, devices: d!.devices };
}

// ---------------------------------------------------------------- publishing, correcting, withdrawing
export async function publishNotice(sql: Sql, p: Principal, year: number, input: NoticeCreate, now: Date): Promise<ManagedNotice> {
  await getEdition(sql, year);
  const audience = input.audience as NoticeAudience;
  const sendPush = input.sendPush ?? false;
  const id = await sql.begin(async (tx) => {
    await checkAudience(tx, year, audience);
    const recipients = await resolveRecipients(tx, year, audience);
    if (!recipients.length) {
      throw new AppError(409, "no_recipients", "Nobody to notify", "Nobody in this audience takes part in the event yet. Nothing was published.");
    }
    const [n] = await tx<{ id: string }[]>`
      insert into notices (edition_id, audience, title, body, send_push, published_by, published_at, recipients)
      values (${year}, ${tx.json(audience as never)}, ${input.title}, ${input.body}, ${sendPush}, ${p.account!.id}, ${now}, ${recipients.length})
      returning id`;
    const noticeId = n!.id;
    // In-app: delivered to each inbox at once. Text is read from the notice, so corrections reach everyone.
    await tx`
      insert into notifications (user_id, edition_id, kind, channel, title, body, status, sent_at, idempotency_key, notice_id)
      select r, ${year}, 'notice', 'in_app', ${input.title}, ${input.body}, 'sent', ${now}, 'notice:' || ${noticeId} || ':' || r, ${noticeId}
      from unnest(${recipients}::uuid[]) as r
      on conflict (idempotency_key) do nothing`;
    let devices = 0;
    if (sendPush) {
      const rows = await tx`
        insert into notifications (user_id, edition_id, kind, channel, recipient, title, body, payload, status, next_attempt_at, idempotency_key, notice_id)
        select t.user_id, ${year}, 'notice', 'push', t.token, ${input.title}, ${input.body.slice(0, PUSH_BODY_MAX)},
               ${tx.json({ noticeId, year } as never)}, 'queued', ${now}, 'notice:' || ${noticeId} || ':push:' || t.token, ${noticeId}
        from push_tokens t where t.disabled_at is null and t.user_id = any(${recipients}::uuid[])
        on conflict (idempotency_key) do nothing
        returning id`;
      devices = rows.length;
    }
    await audit(tx, { actorUserId: p.account!.id, action: "notice.published", entityType: "notice", entityId: noticeId, editionId: year,
      data: { audience, title: input.title, sendPush, recipients: recipients.length, pushDevices: devices } });
    return noticeId;
  });
  return getNotice(sql, id);
}

async function lockNotice(tx: Db, id: string) {
  const [n] = await tx<{ edition: number; title: string; body: string; withdrawnAt: Date | null }[]>`
    select edition_id as edition, title, body, withdrawn_at as "withdrawnAt" from notices where id = ${id} for update`;
  if (!n) throw notFound("Notice");
  if (n.withdrawnAt) throw new AppError(409, "notice_withdrawn", "Notice withdrawn", "A withdrawn notice cannot be changed.");
  return n;
}

/** Corrects the text (FR-NOT-06). Inboxes show the corrected text; queued push messages go out corrected. Audited. */
export async function editNotice(sql: Sql, p: Principal, id: string, e: NoticeEdit): Promise<ManagedNotice> {
  await sql.begin(async (tx) => {
    const n = await lockNotice(tx, id);
    const title = e.title ?? n.title, body = e.body ?? n.body;
    if (title === n.title && body === n.body) throw new AppError(400, "nothing_changes", "Nothing changes", "Change the title or the text.");
    await tx`update notices set title = ${title}, body = ${body}, edited_at = now(), edited_by = ${p.account!.id} where id = ${id}`;
    await tx`update notifications set title = ${title}, body = ${body} where notice_id = ${id} and channel = 'in_app'`;
    await tx`update notifications set title = ${title}, body = ${body.slice(0, PUSH_BODY_MAX)} where notice_id = ${id} and channel = 'push' and status = 'queued'`;
    await audit(tx, { actorUserId: p.account!.id, action: "notice.edited", entityType: "notice", entityId: id, editionId: n.edition,
      data: { reason: e.reason, previous: { title: n.title, body: n.body }, next: { title, body } } });
  });
  return getNotice(sql, id);
}

/** Hides the notice from every inbox and cancels push messages not yet sent. The notice itself is kept. Audited. */
export async function withdrawNotice(sql: Sql, p: Principal, id: string, reason: string): Promise<ManagedNotice> {
  await sql.begin(async (tx) => {
    const n = await lockNotice(tx, id);
    await tx`update notices set withdrawn_at = now(), withdrawn_by = ${p.account!.id}, withdraw_reason = ${reason} where id = ${id}`;
    const cancelled = await tx`update notifications set status = 'cancelled', last_error = 'Notice withdrawn before sending'
      where notice_id = ${id} and channel = 'push' and status = 'queued' returning id`;
    await audit(tx, { actorUserId: p.account!.id, action: "notice.withdrawn", entityType: "notice", entityId: id, editionId: n.edition,
      data: { reason, pushCancelled: cancelled.length } });
  });
  return getNotice(sql, id);
}

// ---------------------------------------------------------------- reading (console)
type NoticeRow = {
  id: string; edition: number; title: string; body: string; audience: NoticeAudience; sendPush: boolean; publishedBy: string; publishedAt: Date;
  editedBy: string | null; editedAt: Date | null; withdrawnBy: string | null; withdrawnAt: Date | null; withdrawReason: string | null; recipients: number;
};
const NOTICE_SELECT = (db: Db) => db`
  select n.id, n.edition_id as edition, n.title, n.body, n.audience, n.send_push as "sendPush", pu.full_name as "publishedBy",
         n.published_at as "publishedAt", eu.full_name as "editedBy", n.edited_at as "editedAt", wu.full_name as "withdrawnBy",
         n.withdrawn_at as "withdrawnAt", n.withdraw_reason as "withdrawReason", n.recipients
  from notices n join user_accounts pu on pu.id = n.published_by
  left join user_accounts eu on eu.id = n.edited_by left join user_accounts wu on wu.id = n.withdrawn_by`;

async function hydrate(db: Db, rows: NoticeRow[]): Promise<ManagedNotice[]> {
  if (!rows.length) return [];
  const counts = await db<{ noticeId: string; channel: string; status: string; read: number; n: number }[]>`
    select notice_id as "noticeId", channel, status, count(*) filter (where read_at is not null)::int as read, count(*)::int as n
    from notifications where notice_id in ${db(rows.map((r) => r.id))} group by 1, 2, 3`;
  const out: ManagedNotice[] = [];
  for (const r of rows) {
    const mine = counts.filter((c) => c.noticeId === r.id);
    const push = (s: string) => mine.filter((c) => c.channel === "push" && c.status === s).reduce((a, c) => a + c.n, 0);
    const inApp = mine.filter((c) => c.channel === "in_app");
    out.push({
      id: r.id, edition: r.edition, title: r.title, body: r.body, audience: r.audience, audienceLabel: await audienceLabel(db, r.audience),
      sendPush: r.sendPush, publishedBy: r.publishedBy, publishedAt: r.publishedAt.toISOString(), editedBy: r.editedBy,
      editedAt: r.editedAt?.toISOString() ?? null, withdrawnBy: r.withdrawnBy, withdrawnAt: r.withdrawnAt?.toISOString() ?? null,
      withdrawReason: r.withdrawReason, recipients: r.recipients,
      delivery: {
        inApp: { total: inApp.reduce((a, c) => a + c.n, 0), read: inApp.reduce((a, c) => a + c.read, 0) },
        push: { queued: push("queued"), sent: push("sent"), failed: push("failed"), cancelled: push("cancelled") },
      },
    });
  }
  return out;
}

export async function getNotice(db: Db, id: string): Promise<ManagedNotice> {
  const rows = await db<NoticeRow[]>`${NOTICE_SELECT(db)} where n.id = ${id}`;
  if (!rows.length) throw notFound("Notice");
  return (await hydrate(db, rows))[0]!;
}

async function participants(db: Db, year: number): Promise<ParticipantRef[]> {
  const rows = await db<{ id: string; fullName: string; roles: Role[] }[]>`
    select u.id, u.full_name as "fullName", array_agg(distinct g.role order by g.role) as roles from user_accounts u
    join edition_access a on a.user_id = u.id and a.edition_id = ${year} and a.revoked_at is null
    join role_grants g on g.user_id = u.id and g.revoked_at is null and (g.edition_id is null or g.edition_id = ${year})
                       and g.role in ${db(PARTICIPANT_ROLES as unknown as string[])}
    where u.status <> 'deactivated' group by u.id, u.full_name order by u.full_name`;
  return rows;
}

async function groups(db: Db, year: number): Promise<NoticeGroup[]> {
  const gs = await db<{ id: string; name: string; description: string | null; createdBy: string; createdAt: Date }[]>`
    select g.id, g.name, g.description, u.full_name as "createdBy", g.created_at as "createdAt"
    from notice_groups g join user_accounts u on u.id = g.created_by where g.edition_id = ${year} and g.archived_at is null order by g.name`;
  if (!gs.length) return [];
  const members = await db<{ groupId: string; id: string; fullName: string; roles: Role[] }[]>`
    select m.group_id as "groupId", u.id, u.full_name as "fullName",
           coalesce((select array_agg(distinct g.role order by g.role) from role_grants g where g.user_id = u.id and g.revoked_at is null
                     and (g.edition_id is null or g.edition_id = ${year})), '{}') as roles
    from notice_group_members m join user_accounts u on u.id = m.user_id where m.group_id in ${db(gs.map((g) => g.id))} order by u.full_name`;
  return gs.map((g) => ({ ...g, edition: year, createdAt: g.createdAt.toISOString(),
    members: members.filter((m) => m.groupId === g.id).map(({ groupId: _g, ...m }) => m) }));
}

export async function noticesOverview(db: Db, year: number): Promise<NoticesOverview> {
  await getEdition(db, year);
  const rows = await db<NoticeRow[]>`${NOTICE_SELECT(db)} where n.edition_id = ${year} order by n.published_at desc`;
  return { edition: year, notices: await hydrate(db, rows), groups: await groups(db, year), participants: await participants(db, year) };
}

// ---------------------------------------------------------------- authorised groups (FR-NOT-08, TBD-29)
export async function createGroup(sql: Sql, p: Principal, year: number, input: { name: string; description?: string }): Promise<NoticesOverview> {
  await getEdition(sql, year);
  await sql.begin(async (tx) => {
    const [dup] = await tx`select 1 from notice_groups where edition_id = ${year} and lower(name) = lower(${input.name}) and archived_at is null`;
    if (dup) throw new AppError(409, "group_exists", "Group exists", `There is already a group called "${input.name}" for ${year}.`);
    const [g] = await tx<{ id: string }[]>`
      insert into notice_groups (edition_id, name, description, created_by) values (${year}, ${input.name}, ${input.description ?? null}, ${p.account!.id})
      returning id`;
    await audit(tx, { actorUserId: p.account!.id, action: "notice_group.created", entityType: "notice_group", entityId: g!.id, editionId: year,
      data: { name: input.name } });
  });
  return noticesOverview(sql, year);
}

async function groupEdition(tx: Db, id: string): Promise<number> {
  const [g] = await tx<{ edition: number }[]>`select edition_id as edition from notice_groups where id = ${id} and archived_at is null for update`;
  if (!g) throw notFound("Group");
  return g.edition;
}

export async function addMembers(sql: Sql, p: Principal, id: string, userIds: string[]): Promise<NoticesOverview> {
  let year = 0;
  try {
    await sql.begin(async (tx) => {
      year = await groupEdition(tx, id);
      const added = await tx<{ userId: string }[]>`
        insert into notice_group_members (group_id, user_id, added_by)
        select ${id}, u, ${p.account!.id} from unnest(${[...new Set(userIds)]}::uuid[]) as u
        on conflict do nothing returning user_id as "userId"`;
      await audit(tx, { actorUserId: p.account!.id, action: "notice_group.members_added", entityType: "notice_group", entityId: id, editionId: year,
        data: { added: added.map((a) => a.userId) } });
    });
  } catch (err) {
    if (ruleViolation(err) === "GROUP-MEMBER") {
      throw new AppError(409, "not_a_participant", "Not a participant", "Only people who take part in this event can join its groups. Nothing was changed.");
    }
    throw err;
  }
  return noticesOverview(sql, year);
}

export async function removeMember(sql: Sql, p: Principal, id: string, userId: string): Promise<NoticesOverview> {
  let year = 0;
  await sql.begin(async (tx) => {
    year = await groupEdition(tx, id);
    const gone = await tx`delete from notice_group_members where group_id = ${id} and user_id = ${userId} returning user_id`;
    if (!gone.length) throw notFound("Group member");
    await audit(tx, { actorUserId: p.account!.id, action: "notice_group.member_removed", entityType: "notice_group", entityId: id, editionId: year,
      data: { userId } });
  });
  return noticesOverview(sql, year);
}

// ---------------------------------------------------------------- devices (push tokens)
/** Registers this device for the signed-in account. A device belongs to the account last signed in on it. */
export async function registerPushToken(db: Db, p: Principal, t: PushTokenRegister): Promise<{ registered: true }> {
  await db`
    insert into push_tokens (user_id, token, platform, last_seen_at) values (${p.account!.id}, ${t.token}, ${t.platform}, now())
    on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, last_seen_at = now(),
      disabled_at = null, disabled_reason = null`;
  return { registered: true };
}

/** Called on sign-out: this device stops receiving the account's push messages. */
export async function removePushToken(db: Db, p: Principal, token: string): Promise<{ removed: boolean }> {
  const rows = await db`delete from push_tokens where user_id = ${p.account!.id} and token = ${token} returning token`;
  return { removed: rows.length > 0 };
}
