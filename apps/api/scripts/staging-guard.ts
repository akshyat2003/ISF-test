// Safety rules for scripts that touch a live Supabase project (staging-verify.ts). Pure functions, unit-tested
// in test/staging-guard.test.ts. Two rules: run only against an explicitly approved staging project, and only
// ever delete users this run provably created.

/** Supabase project refs approved as STAGING targets. Adding one is a reviewed code change. */
export const APPROVED_STAGING_REFS: readonly string[] = ["chiafggvergjwliqvlwv"];   // ISF org · startup-jathara-staging · ap-south-1

/**
 * Throws unless every condition holds: the confirmation phrase, an expected ref that is on the approved list,
 * and a Supabase URL that is exactly https://<expected-ref>.supabase.co (no other host, port, path or scheme).
 */
export function assertApprovedStagingTarget(env: { confirm?: string; expectedRef?: string; supabaseUrl?: string }): string {
  if (env.confirm !== "this-is-staging") throw new Error("Set STAGING_CONFIRM=this-is-staging to confirm the target is staging");
  const ref = env.expectedRef?.trim();
  if (!ref) throw new Error("Set STAGING_SUPABASE_PROJECT_REF to the approved staging project ref");
  if (!APPROVED_STAGING_REFS.includes(ref)) throw new Error(`Project ref ${ref} is not an approved staging project`);
  let url: URL;
  try {
    url = new URL(env.supabaseUrl ?? "");
  } catch {
    throw new Error("STAGING_SUPABASE_URL is not a valid URL");
  }
  const exact = url.protocol === "https:" && url.hostname === `${ref}.supabase.co` && url.port === ""
    && (url.pathname === "/" || url.pathname === "") && !url.search && !url.hash && !url.username && !url.password;
  if (!exact) throw new Error(`STAGING_SUPABASE_URL must be exactly https://${ref}.supabase.co`);
  return ref;
}

type AuthUser = { id: string; email?: string | null; phone?: string | null; created_at?: string };
const digits = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "");

/** True only for a parseable, finite timestamp at or after `start`. Missing or malformed values fail closed. */
export function createdAtOrAfter(createdAt: string | null | undefined, start: Date): boolean {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  return Number.isFinite(t) && t >= start.getTime();
}

/** Result shape of the Supabase Admin delete calls: failures come back in `error`, not as exceptions. */
export type DeleteResult = { error: { message: string } | null };
export type CleanupReport = { deleted: string[]; failed: { id: string; message: string }[] };

/**
 * Tracks the users this run created. A user is recorded only with positive proof:
 *   - "created": the Admin API createUser call for it succeeded in this run, or
 *   - "fresh": it did not exist before this run, it was created after the run started, and its email is one
 *     this run generated (unique per run).
 * Nothing is ever inferred from an email prefix or a role, so pre-existing accounts are never deleted.
 */
export class CreatedUsers {
  private readonly ids = new Set<string>();
  private readonly ownedEmails = new Set<string>();
  constructor(private readonly startedAt: Date, private readonly runTag: string) {
    if (!Number.isFinite(startedAt.getTime())) throw new Error("CreatedUsers needs a valid start time");
  }

  /** A unique address that belongs to this run only. */
  ownedEmail(label: string): string {
    const email = `sj-staging-${this.runTag}-${label}@example.com`.toLowerCase();
    this.ownedEmails.add(email);
    return email;
  }

  /** The Admin API createUser call succeeded in this run (it fails if the user already existed). */
  recordCreated(user: AuthUser): void {
    this.ids.add(user.id);
  }

  /** Record only if provably new and ours; returns whether it was recorded. */
  recordIfFresh(user: AuthUser | null | undefined, existedBefore: boolean): boolean {
    if (!user || existedBefore) return false;
    const email = user.email?.toLowerCase();
    if (!email || !this.ownedEmails.has(email) || !createdAtOrAfter(user.created_at, this.startedAt)) return false;
    this.ids.add(user.id);
    return true;
  }

  /**
   * Phone-only users (the SMS test number): record only if no user had that number before this run, the user was
   * created after the run started, and its number is exactly the configured test number.
   */
  recordIfFreshPhone(user: AuthUser | null | undefined, existedBefore: boolean, testPhone: string): boolean {
    if (!user || existedBefore || !digits(testPhone)) return false;
    if (digits(user.phone) !== digits(testPhone) || !createdAtOrAfter(user.created_at, this.startedAt)) return false;
    this.ids.add(user.id);
    return true;
  }

  has(id: string): boolean { return this.ids.has(id); }
  /**
   * Deletes one owned user. The id is dropped from tracking ONLY after a confirmed deletion; an error result or
   * a thrown exception keeps it tracked and is reported. Ids this run does not own are never passed to deleteFn.
   */
  async deleteOwned(id: string, deleteFn: (id: string) => Promise<DeleteResult>): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!this.ids.has(id)) return { ok: false, message: `refusing to delete ${id}: not created by this run` };
    try {
      const { error } = await deleteFn(id);
      if (error) return { ok: false, message: error.message || "unknown error" };
    } catch (e) {
      return { ok: false, message: (e as Error).message || String(e) };
    }
    this.ids.delete(id);
    return { ok: true };
  }

  /** Attempts every remaining owned user; anything not confirmed deleted is listed in `failed`. */
  async cleanupAll(deleteFn: (id: string) => Promise<DeleteResult>): Promise<CleanupReport> {
    const report: CleanupReport = { deleted: [], failed: [] };
    for (const id of this.list()) {
      const r = await this.deleteOwned(id, deleteFn);
      if (r.ok) report.deleted.push(id); else report.failed.push({ id, message: r.message });
    }
    return report;
  }
  list(): string[] { return [...this.ids]; }
}
