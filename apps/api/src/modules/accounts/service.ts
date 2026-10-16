// Accounts (Phase 3): "who am I", secure activation and account administration (FR-IAM-05, -06, -08…10).
import { createHash, randomBytes } from "node:crypto";
import type { AccountStatus, ActivationIssued, AdminUser, AdminUserList, MeResponse, Role } from "@sj/contracts";
import type { Db, Sql } from "../../db/client.js";
import { audit } from "../../platform/audit.js";
import { channelFor, enqueue, TEMPLATES } from "../notifications/outbox.js";
import { AppError, notFound } from "../../platform/errors.js";
import { permissionsOf, type Principal } from "../../platform/principal.js";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function me(p: Principal): MeResponse {
  return {
    account: p.account ? { ...p.account, status: p.account.status as AccountStatus } : null,
    roles: [...p.roles].sort(),
    editionAccess: [...p.editionAccess].sort(),
    permissions: [...permissionsOf(p)].sort(),
    mfaRequired: permissionsOf(p, { ignoreMfa: true }).size > permissionsOf(p).size,
  };
}

// ---------------------------------------------------------------- activation

/** Issues a single-use, time-limited activation secret for a pending account; any earlier one is revoked. */
/**
 * Issues a single-use activation code (FR-IAM-08/10). TBD-13: the code goes to the participant's own contact on file,
 * email if the account has one, otherwise SMS. When that channel's provider is configured, it is queued for automated
 * delivery and the Admin never sees it; otherwise it is shown once for the Admin to hand over privately.
 */
export async function issueActivation(
  sql: Sql, p: Principal, userId: string, ttlHours: number, now: Date,
  automated: { email: boolean; sms: boolean } = { email: false, sms: false },
): Promise<ActivationIssued> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + ttlHours * 3600_000);
  const delivery = await sql.begin(async (tx) => {
    const [u] = await tx<{ status: string; email: string | null; mobile: string | null }[]>`
      select status, email, mobile_e164 as mobile from user_accounts where id = ${userId} for update`;
    if (!u) throw notFound("Account");
    if (u.status !== "pending_activation") {
      throw new AppError(409, "not_pending", "Account is not awaiting activation", `This account is ${u.status.replace("_", " ")}.`);
    }
    await tx`update activation_tokens set revoked_at = ${now} where user_id = ${userId} and used_at is null and revoked_at is null`;
    const [t] = await tx<{ id: string }[]>`insert into activation_tokens (user_id, token_sha256, issued_by, issued_at, expires_at)
             values (${userId}, ${sha256(token)}, ${p.account!.id}, ${now}, ${expiresAt}) returning id`;
    const channel = channelFor(u);
    let delivery: ActivationIssued["delivery"] = "manual";
    if (channel && automated[channel]) {
      const vars = { code: token, hours: ttlHours };
      await enqueue(tx, {
        userId, editionId: null, kind: "activation", email: u.email, mobile: u.mobile, subject: TEMPLATES.activation.subject,
        emailBody: TEMPLATES.activation.email(vars), smsBody: TEMPLATES.activation.sms(vars), payload: vars,
        idempotencyKey: `activation:${t!.id}`, sensitive: true,
      }, now);
      delivery = channel;
    }
    await audit(tx, { actorUserId: p.account!.id, action: "activation.issued", entityType: "user_account", entityId: userId,
      data: { expiresAt: expiresAt.toISOString(), delivery } });
    return delivery;
  });
  return { token: delivery === "manual" ? token : null, expiresAt: expiresAt.toISOString(), delivery };
}

const invalidActivation = () =>
  new AppError(400, "activation_invalid", "Activation code not accepted",
    "This activation code is invalid, expired, already used, or belongs to a different account. Ask the event team for a new one.");

/**
 * Redeems an activation secret. The caller must already be signed in with a verified identifier that linked to the
 * pending account (two factors: the proven email/phone and the secret). Every failure looks the same to the caller.
 */
export async function redeemActivation(sql: Sql, p: Principal, token: string, now: Date): Promise<MeResponse["account"]> {
  if (!p.account) throw invalidActivation();
  const accountId = p.account.id;
  return sql.begin(async (tx) => {
    const [t] = await tx<{ id: string; userId: string; expiresAt: Date; usedAt: Date | null; revokedAt: Date | null }[]>`
      select id, user_id as "userId", expires_at as "expiresAt", used_at as "usedAt", revoked_at as "revokedAt"
      from activation_tokens where token_sha256 = ${sha256(token)} for update`;
    const [u] = await tx<{ status: string }[]>`select status from user_accounts where id = ${accountId} for update`;
    const ok = t && t.userId === accountId && !t.usedAt && !t.revokedAt && t.expiresAt > now && u?.status === "pending_activation";
    if (!ok) {
      await audit(tx, { actorUserId: accountId, action: "activation.rejected", entityType: "user_account", entityId: accountId,
        data: { reason: !t ? "unknown" : t.userId !== accountId ? "other_account" : t.usedAt ? "used" : t.revokedAt ? "revoked" : t.expiresAt <= now ? "expired" : "not_pending" } });
      return null;
    }
    await tx`update activation_tokens set used_at = ${now} where id = ${t.id}`;
    const [acct] = await tx<NonNullable<MeResponse["account"]>[]>`
      update user_accounts set status = 'active' where id = ${accountId}
      returning id, email, full_name as "fullName", mobile_e164 as mobile, status`;
    await audit(tx, { actorUserId: accountId, action: "activation.redeemed", entityType: "user_account", entityId: accountId });
    return acct!;
  }).then((acct) => {
    if (!acct) throw invalidActivation();   // thrown after commit so the rejection audit is kept
    return acct;
  });
}

// ---------------------------------------------------------------- administration

type UserRow = {
  id: string; email: string | null; fullName: string; mobile: string | null; status: AccountStatus; signInLinked: boolean;
  createdAt: Date; activatedAt: Date | null; total?: number;
};

async function hydrate(db: Db, rows: UserRow[]): Promise<AdminUser[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const grants = await db<{ userId: string; grantId: string; role: Role; edition: number | null; grantedAt: Date }[]>`
    select user_id as "userId", id::text as "grantId", role, edition_id as edition, granted_at as "grantedAt"
    from role_grants where user_id in ${db(ids)} and revoked_at is null order by granted_at`;
  const access = await db<{ userId: string; edition: number; source: "predefined" | "selected" }[]>`
    select user_id as "userId", edition_id as edition, source from edition_access
    where user_id in ${db(ids)} and revoked_at is null order by edition_id`;
  const tokens = await db<{ userId: string; issuedAt: Date; expiresAt: Date }[]>`
    select user_id as "userId", issued_at as "issuedAt", expires_at as "expiresAt" from activation_tokens
    where user_id in ${db(ids)} and used_at is null and revoked_at is null`;
  return rows.map((r) => {
    const t = tokens.find((x) => x.userId === r.id);
    return {
      id: r.id, email: r.email, fullName: r.fullName, mobile: r.mobile, status: r.status, signInLinked: r.signInLinked,
      createdAt: r.createdAt.toISOString(), activatedAt: r.activatedAt?.toISOString() ?? null,
      roles: grants.filter((g) => g.userId === r.id).map(({ grantId, role, edition, grantedAt }) => ({ grantId, role, edition, grantedAt: grantedAt.toISOString() })),
      editionAccess: access.filter((a) => a.userId === r.id).map(({ edition, source }) => ({ edition, source })),
      activation: t ? { issuedAt: t.issuedAt.toISOString(), expiresAt: t.expiresAt.toISOString() } : null,
    };
  });
}

const USER_COLS = (db: Db) => db`u.id, u.email, u.full_name as "fullName", u.mobile_e164 as mobile, u.status,
  (u.auth_subject is not null) as "signInLinked", u.created_at as "createdAt", u.activated_at as "activatedAt"`;

export async function listUsers(db: Db, f: { q?: string; role?: Role; status?: AccountStatus; limit: number; offset: number }): Promise<AdminUserList> {
  const like = f.q ? `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const rows = await db<UserRow[]>`
    select ${USER_COLS(db)}, count(*) over ()::int as total from user_accounts u
    where true
      ${like ? db`and (u.full_name ilike ${like} or u.email ilike ${like} or u.mobile_e164 ilike ${like})` : db``}
      ${f.status ? db`and u.status = ${f.status}` : db``}
      ${f.role ? db`and exists (select 1 from role_grants g where g.user_id = u.id and g.role = ${f.role} and g.revoked_at is null)` : db``}
    order by u.created_at desc, u.id limit ${f.limit} offset ${f.offset}`;
  return { total: rows[0]?.total ?? 0, items: await hydrate(db, rows) };
}

export async function getUser(db: Db, id: string): Promise<AdminUser> {
  const rows = await db<UserRow[]>`select ${USER_COLS(db)} from user_accounts u where u.id = ${id}`;
  if (!rows.length) throw notFound("Account");
  return (await hydrate(db, rows))[0]!;
}

/** Nobody changes their own roles or status: prevents self-escalation and self-lockout (least privilege). */
function notSelf(p: Principal, userId: string) {
  if (p.account!.id === userId) {
    throw new AppError(403, "self_change_forbidden", "Not allowed on your own account", "Ask another administrator to change your own roles or status.");
  }
}

export async function grantRole(sql: Sql, p: Principal, userId: string, role: Role, edition: number | null): Promise<AdminUser> {
  notSelf(p, userId);
  await sql.begin(async (tx) => {
    const [u] = await tx<{ status: string }[]>`select status from user_accounts where id = ${userId} for update`;
    if (!u) throw notFound("Account");
    if (edition !== null) {
      const [e] = await tx`select 1 from event_editions where id = ${edition}`;
      if (!e) throw notFound("Edition");
    }
    const [g] = await tx<{ id: string }[]>`
      insert into role_grants (user_id, role, edition_id, granted_by)
      select ${userId}, ${role}, ${edition}, ${p.account!.id}
      where not exists (select 1 from role_grants where user_id = ${userId} and role = ${role}
                        and coalesce(edition_id, 0) = coalesce(${edition}::smallint, 0) and revoked_at is null)
      returning id::text`;
    if (!g) throw new AppError(409, "role_already_granted", "Role already granted", "This account already holds that role.");
    await audit(tx, { actorUserId: p.account!.id, action: "role.granted", entityType: "user_account", entityId: userId,
      editionId: edition, data: { role, edition, grantId: g.id } });
  });
  return getUser(sql, userId);
}

export async function revokeRole(sql: Sql, p: Principal, userId: string, grantId: string): Promise<AdminUser> {
  notSelf(p, userId);
  await sql.begin(async (tx) => {
    const [g] = await tx<{ role: Role; edition: number | null }[]>`
      update role_grants set revoked_at = now(), revoked_by = ${p.account!.id}
      where id = ${grantId} and user_id = ${userId} and revoked_at is null
      returning role, edition_id as edition`;
    if (!g) throw notFound("Active role grant");
    await audit(tx, { actorUserId: p.account!.id, action: "role.revoked", entityType: "user_account", entityId: userId,
      editionId: g.edition, data: { role: g.role, edition: g.edition, grantId } });
  });
  return getUser(sql, userId);
}

/** Deactivation takes effect on the account's next request (status is checked on every request, FR-IAM-09). */
export async function setStatus(sql: Sql, p: Principal, userId: string, target: "deactivated" | "reactivated"): Promise<AdminUser> {
  notSelf(p, userId);
  await sql.begin(async (tx) => {
    const [u] = await tx<{ status: AccountStatus; activatedAt: Date | null }[]>`
      select status, activated_at as "activatedAt" from user_accounts where id = ${userId} for update`;
    if (!u) throw notFound("Account");
    let next: AccountStatus;
    if (target === "deactivated") {
      if (u.status === "deactivated") throw new AppError(409, "already_deactivated", "Already deactivated");
      next = "deactivated";
      await tx`update activation_tokens set revoked_at = now() where user_id = ${userId} and used_at is null and revoked_at is null`;
    } else {
      if (u.status !== "deactivated") throw new AppError(409, "not_deactivated", "Account is not deactivated");
      // An account that was never activated goes back to awaiting activation, never straight to active.
      next = u.activatedAt ? "active" : "pending_activation";
    }
    await tx`update user_accounts set status = ${next} where id = ${userId}`;
    await audit(tx, { actorUserId: p.account!.id, action: target === "deactivated" ? "account.deactivated" : "account.reactivated",
      entityType: "user_account", entityId: userId, data: { from: u.status, to: next } });
  });
  return getUser(sql, userId);
}
