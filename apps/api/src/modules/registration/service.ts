// New-startup registration for 2026, 2027 or both (PRD §6). One transaction: either every requested
// year-wise application is created, or nothing is.
import {
  PRIVACY_NOTICE_VERSION,
  RegistrationRequest,
  applicantStatus,
  checkFormAnswers,
  mergeQuestions,
  yearsFor,
  type InternalStatus,
  type MyApplicationsResponse,
  type RegistrationResponse,
} from "@sj/contracts";
import type { z } from "zod";
import { isUniqueViolation, type Db, type Sql } from "../../db/client.js";
import { audit } from "../../platform/audit.js";
import { AppError } from "../../platform/errors.js";
import type { Account, Principal } from "../../platform/principal.js";
import { listEditions, registrationOpen } from "../editions/service.js";

type Input = z.output<typeof RegistrationRequest>;
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export async function register(sql: Sql, p: Principal, input: Input, now: Date): Promise<RegistrationResponse> {
  const years = yearsFor(input.yearOption);

  // Deadline check happens on the server for every request, including direct API calls (AT-08).
  const editions = (await listEditions(sql)).filter((e) => years.includes(e.id as 2026 | 2027));
  const closed = editions.filter((e) => !registrationOpen(e, now)).map((e) => e.id);
  if (closed.length || editions.length !== years.length) {
    throw new AppError(422, "registration_closed", "Registration is closed",
      `Registration for ${closed.join(" and ")} is closed. You can still choose any edition that is open.`, { editions: closed });
  }

  // TBD-39: answers are checked against each chosen edition's configured questions; unknown keys are rejected.
  const questions = mergeQuestions(editions.map((e) => e.applicationForm));
  const answers = Object.fromEntries(Object.entries(input.formAnswers ?? {}).map(([k, v]) => [k, v.trim()]));
  const issues = checkFormAnswers(questions, answers);
  if (issues.length) throw new AppError(400, "validation_failed", "Some fields are invalid", undefined, { errors: issues });
  const formVersion = new Map(editions.map((e) => [e.id, e.applicationForm.version]));

  return sql.begin(async (tx) => {
    const account = await ensureApplicantAccount(tx, p, input);
    // Serialise concurrent registrations by the same person (double-clicks, retries).
    await tx`select pg_advisory_xact_lock(hashtextextended(${account.id}, 0))`;

    await tx`
      insert into role_grants (user_id, role) select ${account.id}, 'startup_team_leader'
      where not exists (select 1 from role_grants where user_id = ${account.id} and role = 'startup_team_leader'
                        and edition_id is null and revoked_at is null)`;

    // Duplicate rule (TBD-15, docs/DECISIONS.md): one startup per leader account; same-named startups are flagged, not blocked.
    const [existing] = await tx<{ id: string; name: string; origin: string }[]>`
      select s.id, s.name, s.origin from startups s
      join startup_memberships m on m.startup_id = s.id and m.user_id = ${account.id} and m.position = 'leader'`;
    let startupId: string;
    let reused = false;
    if (existing) {
      if (existing.origin === "predefined") {
        throw new AppError(409, "predefined_startup", "No application needed",
          `${existing.name} is already part of the event and does not need to apply (FR-REG-10).`);
      }
      if (norm(existing.name) !== norm(input.startup.name)) {
        throw new AppError(409, "startup_mismatch", "Different startup",
          `This account already leads "${existing.name}". Apply again under that startup, or contact support.`);
      }
      startupId = existing.id;
      reused = true;
    } else {
      const [s] = await tx<{ id: string }[]>`
        insert into startups (name, description, website, city, state, origin, created_by)
        values (${input.startup.name}, ${input.startup.description}, ${input.startup.website ?? null},
                ${input.startup.city ?? null}, ${input.startup.state ?? null}, 'applicant', ${account.id})
        returning id`;
      startupId = s!.id;
      await tx`insert into startup_memberships (startup_id, user_id, position) values (${startupId}, ${account.id}, 'leader')`;
    }

    const already = await tx<{ editionId: number }[]>`
      select edition_id as "editionId" from applications where startup_id = ${startupId} and edition_id in ${tx(years)}`;
    if (already.length) {
      const ys = already.map((a) => a.editionId).sort();
      throw new AppError(409, "duplicate_application", "Already applied",
        `This startup has already applied for ${ys.join(" and ")}. Each startup can apply once per year.`, { editions: ys });
    }

    const [dup] = await tx<{ n: number }[]>`
      select count(*)::int as n from startups
      where name_normalized = lower(regexp_replace(trim(${input.startup.name}), '\\s+', ' ', 'g')) and id <> ${startupId}`;
    const flags = dup && dup.n > 0 ? ["possible_duplicate_name"] : [];

    for (const year of years) {
      try {
        await tx`
          insert into applications (startup_id, edition_id, form_answers, form_version, privacy_notice_version, flags, submitted_by)
          values (${startupId}, ${year}, ${tx.json(answers as never)}, ${formVersion.get(year) ?? null}, ${PRIVACY_NOTICE_VERSION},
                  ${tx.array(flags)}::text[], ${account.id})`;
      } catch (err) {
        // Safety net for races; the explicit check above handles the normal case (DC-01).
        if (isUniqueViolation(err, "one_application_per_startup_per_edition")) {
          throw new AppError(409, "duplicate_application", "Already applied", `This startup has already applied for ${year}.`, { editions: [year] });
        }
        throw err;
      }
    }
    await audit(tx, {
      actorUserId: account.id, action: "registration.submitted", entityType: "startup", entityId: startupId,
      // TBD-45: the leader's 18+ confirmation is part of the audited submission record.
      data: { years, reused, flags, adultDeclaration: input.adultDeclaration, formVersions: Object.fromEntries(formVersion) },
    });
    return { ...(await myApplications(tx, account.id, now)), startupReused: reused };
  });
}

async function ensureApplicantAccount(tx: Db, p: Principal, input: Input): Promise<Account> {
  if (p.account) {
    if (!p.account.mobile) await tx`update user_accounts set mobile_e164 = ${input.leader.mobile} where id = ${p.account.id}`;
    return p.account;
  }
  // A new account needs an identifier the identity provider has PROVEN; only proven identifiers are stored,
  // so nobody can claim another person's email before that person's account is imported (fail closed).
  const verified = p.verified;
  if (!verified || (!verified.email && !verified.phone)) {
    throw new AppError(403, "identity_unverified", "Verify your sign-in first",
      "Sign in with a confirmed email address or mobile number before registering.");
  }
  if (verified.email) {
    const [taken] = await tx<{ id: string }[]>`select id from user_accounts where lower(email) = ${verified.email}`;
    if (taken) throw new AppError(409, "email_in_use", "Email already registered", "This email belongs to another account. Sign in with that account.");
  }
  const [created] = await tx<Account[]>`
    insert into user_accounts (auth_subject, email, mobile_e164, full_name)
    values (${p.claims.sub}, ${verified.email}, ${verified.phone ?? input.leader.mobile}, ${input.leader.fullName})
    on conflict (auth_subject) do update set auth_subject = excluded.auth_subject
    returning id, email, full_name as "fullName", mobile_e164 as mobile, status`;
  await audit(tx, { actorUserId: created!.id, action: "account.created", entityType: "user_account", entityId: created!.id, data: { via: "registration", verifiedEmail: !!verified.email, verifiedPhone: !!verified.phone } });
  return created!;
}

/** Today's date in India (YYYY-MM-DD): the event dates are local dates. */
export const istDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

/**
 * The applicant's own view: separate status per year; drafts, internal states and AI results hidden (FR-REG-05,
 * FR-SEL-09, TBD-44).
 */
export async function myApplications(db: Db, userId: string, now: Date = new Date()): Promise<MyApplicationsResponse> {
  const [startup] = await db<{ id: string; name: string }[]>`
    select s.id, s.name from startups s
    join startup_memberships m on m.startup_id = s.id and m.user_id = ${userId} and m.position = 'leader'`;
  if (!startup) return { startup: null, applications: [] };
  const apps = await db<{ id: string; edition: number; status: InternalStatus; submittedAt: Date; releasedAt: Date | null; correctedAt: Date | null; eventStartsOn: string | null }[]>`
    select a.id, a.edition_id as edition, a.status, a.submitted_at as "submittedAt", d.released_at as "releasedAt",
           d.corrected_at as "correctedAt", to_char(e.event_starts_on, 'YYYY-MM-DD') as "eventStartsOn"
    from applications a left join selection_decisions d on d.application_id = a.id join event_editions e on e.id = a.edition_id
    where a.startup_id = ${startup.id} order by a.edition_id`;
  const today = istDate(now);
  return {
    startup,
    applications: apps.map((a) => ({
      id: a.id,
      edition: a.edition,
      status: applicantStatus(a.status),
      submittedAt: a.submittedAt.toISOString(),
      decidedAt: a.releasedAt ? (a.correctedAt ?? a.releasedAt).toISOString() : null,
      canWithdraw: a.status !== "withdrawn" && (!a.eventStartsOn || today < a.eventStartsOn),
    })),
  };
}

/**
 * TBD-37: the leader withdraws their startup's application for one year, any time before that year's event starts.
 * An unreleased draft decision is discarded and a pending correction cancelled; a selected team loses its access to
 * that edition. The other year's application is never touched (RQ §6).
 */
export async function withdrawApplication(sql: Sql, p: Principal, applicationId: string, now: Date): Promise<MyApplicationsResponse> {
  if (!p.account) throw new AppError(404, "not_found", "Not found", "Application was not found");
  const userId = p.account.id;
  await sql.begin(async (tx) => {
    const [a] = await tx<{ edition: number; status: InternalStatus; eventStartsOn: string | null; releasedAt: Date | null; hasDecision: boolean }[]>`
      select a.edition_id as edition, a.status, to_char(e.event_starts_on, 'YYYY-MM-DD') as "eventStartsOn",
             d.released_at as "releasedAt", (d.application_id is not null) as "hasDecision"
      from applications a
      join startup_memberships m on m.startup_id = a.startup_id and m.user_id = ${userId} and m.position = 'leader'
      join event_editions e on e.id = a.edition_id
      left join selection_decisions d on d.application_id = a.id
      where a.id = ${applicationId}
      for update of a`;
    // Someone else's application looks exactly like a missing one.
    if (!a) throw new AppError(404, "not_found", "Not found", "Application was not found");
    if (a.status === "withdrawn") throw new AppError(409, "already_withdrawn", "Already withdrawn", "This application is already withdrawn.");
    if (a.eventStartsOn && istDate(now) >= a.eventStartsOn) {
      throw new AppError(409, "event_started", "Too late to withdraw", `The ${a.edition} event has already started.`);
    }
    if (a.hasDecision && !a.releasedAt) await tx`delete from selection_decisions where application_id = ${applicationId}`;
    await tx`update decision_corrections set status = 'cancelled', reviewed_at = clock_timestamp(), review_note = 'Application withdrawn by the applicant'
             where application_id = ${applicationId} and status = 'pending'`;
    if (a.status === "selected") {
      await tx`update edition_access set revoked_at = now()
               where user_id = ${userId} and edition_id = ${a.edition} and source = 'selected' and revoked_at is null`;
    }
    await tx`update applications set status = 'withdrawn', withdrawn_at = ${now} where id = ${applicationId}`;
    await audit(tx, { actorUserId: userId, action: "application.withdrawn", entityType: "application", entityId: applicationId,
      editionId: a.edition, data: { previousStatus: a.status, draftDiscarded: a.hasDecision && !a.releasedAt } });
  });
  return myApplications(sql, userId, now);
}
