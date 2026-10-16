// Turns verified token claims into a principal: the account, active roles and edition access.
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "@sj/contracts";
import type { Db } from "../db/client.js";
import { audit } from "./audit.js";
import { bearer, type Claims, type IdentityResolver, type VerifiedIdentity } from "./auth.js";
import { AppError, forbidden, unauthorized } from "./errors.js";
import { AUTHENTICATED, ROLE_PERMISSIONS, STAFF_ROLES, type Permission } from "./permissions.js";

export type Account = { id: string; email: string | null; fullName: string; mobile: string | null; status: string };

export type Principal = {
  claims: Claims;
  /** null until the person creates an account (e.g. a first-time applicant before registering). */
  account: Account | null;
  /**
   * Identifiers proven by the authoritative identity source. Resolved only when the token subject is not yet
   * linked to an account (linking / account creation); null for already-linked accounts, which never need it.
   */
  verified: VerifiedIdentity | null;
  roles: Set<Role>;
  editionAccess: Set<number>;
  mfaSatisfied: boolean;
};

const ACCOUNT_COLUMNS = (db: Db) => db`id, email, full_name as "fullName", mobile_e164 as mobile, status`;

/**
 * Links a pre-created account (staff, imports) to a newly seen identity — fail closed:
 * - only identifiers the identity resolver PROVED (never raw token claims);
 * - only accounts that are unlinked and not deactivated;
 * - a phone match links only if the account has no email on file or the same verified email;
 * - more than one candidate, or email and phone pointing at different accounts, links nothing.
 */
async function linkPreCreatedAccount(db: Db, claims: Claims, v: VerifiedIdentity): Promise<Account | null> {
  if (!v.email && !v.phone) return null;
  const byEmail = v.email
    ? await db<Account[]>`select ${ACCOUNT_COLUMNS(db)} from user_accounts
        where lower(email) = ${v.email} and auth_subject is null and status <> 'deactivated'`
    : [];
  const byPhone = v.phone
    ? await db<Account[]>`select ${ACCOUNT_COLUMNS(db)} from user_accounts
        where mobile_e164 = ${v.phone} and auth_subject is null and status <> 'deactivated'`
    : [];
  const candidates = new Map([...byEmail, ...byPhone].map((a) => [a.id, a]));
  const refuse = async (reason: string) => {
    await audit(db, { actorUserId: null, action: "identity.link_refused", entityType: "identity", entityId: claims.sub,
      data: { reason, candidates: candidates.size } });
    return null;
  };
  if (candidates.size === 0) return null;
  if (candidates.size > 1) return refuse(byEmail.length && byPhone.length ? "email_phone_conflict" : "ambiguous");
  const target = [...candidates.values()][0]!;
  const viaEmail = byEmail.some((a) => a.id === target.id);
  if (!viaEmail && target.email && target.email.toLowerCase() !== v.email) return refuse("email_on_file_unverified");

  const [linked] = await db<Account[]>`
    update user_accounts set auth_subject = ${claims.sub}
    where id = ${target.id} and auth_subject is null and status <> 'deactivated'
    returning ${ACCOUNT_COLUMNS(db)}`;
  if (!linked) return null;   // lost a race; the caller re-reads by subject
  await audit(db, { actorUserId: linked.id, action: "identity.linked", entityType: "user_account", entityId: linked.id,
    data: { via: viaEmail ? "verified_email" : "verified_phone" } });
  return linked;
}

export async function resolvePrincipal(
  db: Db,
  claims: Claims,
  opts: { requireStaffMfa: boolean; identity: IdentityResolver; allowPending?: boolean },
): Promise<Principal> {
  const bySubject = () => db<Account[]>`select ${ACCOUNT_COLUMNS(db)} from user_accounts where auth_subject = ${claims.sub}`;
  let account: Account | null = (await bySubject())[0] ?? null;
  let verified: VerifiedIdentity | null = null;
  if (!account) {
    verified = await opts.identity.resolve(claims);
    account = (await linkPreCreatedAccount(db, claims, verified)) ?? (await bySubject())[0] ?? null;
  }

  // Activation is enforced here, before any role or edition access is loaded, for every protected endpoint.
  if (account) {
    if (account.status === "deactivated") throw forbidden("This account has been deactivated", "account_deactivated");
    if (account.status === "pending_activation") {
      // Only the activation and "who am I" routes accept a pending account, and they get no roles or access.
      if (opts.allowPending) return { claims, account, verified, roles: new Set(), editionAccess: new Set(), mfaSatisfied: false };
      throw forbidden("This account has not been activated yet. Use your activation invitation to continue.", "account_not_active");
    }
    if (account.status !== "active") throw forbidden("This account is not active", "account_not_active");   // unknown state: fail closed
  }

  const roles = new Set<Role>();
  const editionAccess = new Set<number>();
  if (account) {
    for (const r of await db<{ role: Role }[]>`select role from role_grants where user_id = ${account.id} and revoked_at is null`) roles.add(r.role);
    for (const e of await db<{ editionId: number }[]>`
      select edition_id as "editionId" from edition_access where user_id = ${account.id} and revoked_at is null`) editionAccess.add(e.editionId);
  }
  return { claims, account, verified, roles, editionAccess, mfaSatisfied: !opts.requireStaffMfa || claims.aal === "aal2" };
}

export function permissionsOf(p: Principal, opts: { ignoreMfa?: boolean } = {}): Set<Permission> {
  const out = new Set<Permission>(AUTHENTICATED);
  for (const role of p.roles) {
    if (STAFF_ROLES.has(role) && !p.mfaSatisfied && !opts.ignoreMfa) continue;
    for (const perm of ROLE_PERMISSIONS[role]) out.add(perm);
  }
  return out;
}

declare module "fastify" {
  interface FastifyRequest {
    principal: Principal | null;
  }
}

export function principalOf(req: FastifyRequest): Principal {
  if (!req.principal) throw unauthorized();
  return req.principal;
}

/** Route guard: authenticated + holds the permission. Distinguishes "needs MFA" from "not allowed". */
export function requirePermission(perm: Permission) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const p = principalOf(req);
    if (permissionsOf(p).has(perm)) return;
    if (permissionsOf(p, { ignoreMfa: true }).has(perm)) {
      throw new AppError(403, "mfa_required", "Multi-factor authentication required", "Sign in again with your second factor");
    }
    throw forbidden();
  };
}

/** Route guard: holds at least one of the permissions (e.g. support staff, or Management reviewing read-only). */
export function requireAnyPermission(perms: Permission[]) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const p = principalOf(req);
    const held = permissionsOf(p);
    if (perms.some((x) => held.has(x))) return;
    const withoutMfa = permissionsOf(p, { ignoreMfa: true });
    if (perms.some((x) => withoutMfa.has(x))) {
      throw new AppError(403, "mfa_required", "Multi-factor authentication required", "Sign in again with your second factor");
    }
    throw forbidden();
  };
}

/** Route guard for participant features of an edition (FR-IAM-12): `:year` must be in the caller's edition access. */
export function requireEditionAccess() {
  return async (req: FastifyRequest) => {
    const p = principalOf(req);
    const year = Number((req.params as { year?: string }).year);
    if (!p.editionAccess.has(year)) throw forbidden(`You do not have access to the ${year} event`, "no_edition_access");
  };
}

export function authenticate(
  verify: (token: string) => Promise<Claims>,
  db: Db,
  opts: { requireStaffMfa: boolean; identity: IdentityResolver; allowPending?: boolean },
) {
  return async (req: FastifyRequest) => {
    const token = bearer(req.headers.authorization);
    if (!token) throw unauthorized();
    const claims = await verify(token);
    req.principal = await resolvePrincipal(db, claims, opts);
  };
}
