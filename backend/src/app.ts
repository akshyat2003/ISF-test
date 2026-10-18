import { scryptSync, randomBytes } from "node:crypto";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import {
  ACCOUNT_STATUSES, ActivationRequest, AdminCreateCredentialRequest, CorrectionReviewRequest, CriteriaSetCreate, CutLineRequest, DecisionCorrectionRequest, DecisionRequest,
  DevSessionRequest, normaliseMobile, IMPORT_CATEGORIES, ImportCommitRequest, ImportPreviewRequest, INTERNAL_STATUSES,
  PublicSignUpRequest, RegistrationRequest, ReleaseRequest, ROLES, RoleGrantRequest, SelectionLimitRequest, StartRankingRunRequest,
  CloseAssignmentRequest, EvaluationSave, JuryAssignmentRequest, ManualAssignRequest, PitchSlotRequest, PitchSlotUpdate, ReassignRequest,
  ReopenRequest, RubricCreate,
  ArchiveRequest, ContentCreate, ContentUpdate, DocumentUpload, GroupMembersAdd, NoticeAudience, NoticeCreate, NoticeEdit, NoticeGroupCreate,
  NoticeWithdraw, PublishRequest, PushTokenRegister,
  EmergencyReport, HelpDeskAsk, HelpDeskEscalate, RequesterTicketCreate, SupportAssign, SupportContactLog, SupportEscalate, SupportNote,
  SupportPolicy, SupportStatusUpdate, SupportTicketCreate, TICKET_STATUSES, TicketText,
  SendOtpRequest, VerifyOtpRequest, LoginRequest, UpdatePasswordRequest,
} from "@sj/contracts";
import { z } from "zod";
import type { Config } from "./config.js";
import type { Sql } from "./db/client.js";
import { createCredential, getUser, grantRole, issueActivation, listUsers, me, publicSignUp, redeemActivation, revokeRole, setStatus } from "./modules/accounts/service.js";
import { sendOtpEmail, verifyOtpAndLogin, updatePasswordWithOtp, hashPassword, verifyPassword } from "./modules/accounts/otp.js";
import { listEditions, toPublic } from "./modules/editions/service.js";
import { commitBatch, discardBatch, getBatch, listBatches, previewImport, templateCsv } from "./modules/imports/service.js";
import { markRead, myNotifications } from "./modules/notifications/service.js";
import {
  archiveContent, archiveDocument, contentOverview, contentVersions, createContent, discardDraft, documentLink, eventInfo, publishContent,
  updateContent, uploadDocument,
} from "./modules/content/service.js";
import { databaseStore, supabaseStore, type FileStore } from "./modules/content/storage.js";
import {
  addMembers, createGroup, editNotice, noticesOverview, previewNotice, publishNotice, registerPushToken, removeMember, removePushToken,
  withdrawNotice,
} from "./modules/notices/service.js";
import { approveCriteriaSet, createCriteriaSet, getRun, listCriteriaSets, listRuns, setCutLine, startRun } from "./modules/ranking/service.js";
import { myApplications, register, withdrawApplication } from "./modules/registration/service.js";
import {
  approveCorrection, cancelCorrection, draftDecision, getApplication, listApplications, listCorrections, rejectCorrection, releaseDecisions,
  requestCorrection, setSelectionLimit, withdrawDraft,
} from "./modules/selection/service.js";
import {
  approveRubric, assignJury, createRubric, createSlot, deleteSlot, finishPitch, juryHome, juryOverview, juryStartupProfile, removeJuryAssignment,
  reopenEvaluation, reviewEvaluations, saveEvaluation, startPitch, updateSlot,
} from "./modules/jury/service.js";
import {
  approveRun, assignManually, closeAssignment, discardRun, generateRun, getRun as getVolunteerRun, myAssignment, myVolunteer, reassign,
  volunteerOverview,
} from "./modules/volunteers/service.js";
import { ask, escalateConversation, getConversation, type HelpDeskIdentity } from "./modules/helpdesk/engine.js";
import { helpdeskModelFrom, type HelpDeskModel } from "./modules/helpdesk/model.js";
import {
  acknowledge, addNote, addRequesterNote, assign, createOnBehalf, createOwnTicket, escalate, findRequester, getPolicy, logContact, markAlertSeen,
  myAlerts, myTickets, raisePriority, reportEmergency, setPolicy, setStatus as setTicketStatus, supportQueue, ticketDetail,
} from "./modules/support/service.js";
import { automatedChannels, rankingModelFrom } from "./workers.js";
import { issueDevToken, type IdentityResolver, type TokenVerifier } from "./platform/auth.js";
import { AppError, parse, registerErrorHandler } from "./platform/errors.js";
import { authenticate, principalOf, requireAnyPermission, requireEditionAccess, requirePermission, resolvePrincipal, type Principal } from "./platform/principal.js";

export type Clock = () => Date;
export type AppDeps = {
  config: Config;
  sql: Sql;
  verifier: TokenVerifier;
  /** Authoritative source for "which email/phone has this identity proven" (linking and account creation). */
  identity: IdentityResolver;
  clock?: Clock;
  logger?: boolean | object;
  /** Recorded on ranking runs (FR-RNK-07). Defaults to the configured provider's model reference. */
  rankingModelRef?: string;
  /** Channels with a configured provider, for automated activation delivery (TBD-13). Defaults from config. */
  automated?: { email: boolean; sms: boolean };
  /** Document storage (TBD-51). Defaults from config. */
  fileStore?: FileStore;
  /** Help Desk model (TBD-54). Defaults from config; null = no assistant (fallback answers only). */
  helpdeskModel?: HelpDeskModel | null;
};

const Year = z.object({ year: z.coerce.number().int().min(2026).max(2100) });
const Id = z.object({ id: z.string().uuid() });

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, sql, verifier, identity } = deps;
  const now = deps.clock ?? (() => new Date());
  const rankingModelRef = deps.rankingModelRef ?? rankingModelFrom(config).ref;
  const automated = deps.automated ?? automatedChannels(config);
  const webUrl = config.publicWebUrl;
  const fileStore: FileStore = deps.fileStore ?? (config.storage.provider === "supabase"
    ? supabaseStore({ url: config.supabaseUrl!, serviceRoleKey: config.supabaseServiceRoleKey!, bucket: config.storage.bucket })
    : databaseStore(config.storage.fileLinkSecret));
  const helpdeskModel = deps.helpdeskModel !== undefined ? deps.helpdeskModel : helpdeskModelFrom(config);
  const app = Fastify({
    logger: deps.logger ?? { level: config.logLevel, redact: ["req.headers.authorization", "req.headers.cookie"] },
    trustProxy: true,
    bodyLimit: 256 * 1024,
  });
  app.decorateRequest("principal", null);
  registerErrorHandler(app);
  await app.register(helmet);
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const isAllowed =
        config.corsOrigins.includes("*") ||
        config.corsOrigins.includes(origin) ||
        origin.endsWith(".vercel.app") ||
        origin.endsWith(".onrender.com") ||
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:") ||
        origin.startsWith("http://192.168.") ||
        origin.startsWith("http://10.");
      if (isAllowed) return cb(null, true);
      return cb(null, false);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type"],
    credentials: false,
    maxAge: 600,
  });
  await app.register(rateLimit, { global: false });

  const auth = authenticate((t) => verifier.verify(t), sql, { requireStaffMfa: config.requireStaffMfa, identity });
  // Accepts pending_activation accounts (with no roles or access): only for "who am I" and activation.
  const authPending = authenticate((t) => verifier.verify(t), sql, { requireStaffMfa: config.requireStaffMfa, identity, allowPending: true });

  // ---------------------------------------------------------------- health
  app.get("/healthz", async (req, reply) => {
    let dbStatus = "connected";
    let dbError = null;
    try {
      await sql`select 1`;
    } catch (e: any) {
      dbStatus = "error";
      dbError = { message: e?.message, code: e?.code };
      req.log.error({ err: e }, "Health check database connection failed");
    }
    return reply.status(dbStatus === "connected" ? 200 : 503).send({
      ok: dbStatus === "connected",
      dbStatus,
      dbError,
      authMode: config.authMode,
    });
  });

  // ---------------------------------------------------------------- public
  app.get("/v1/public/editions", async () => (await listEditions(sql)).map((e) => toPublic(e, now())));

  app.post("/v1/public/signup", {
    config: { rateLimit: { max: config.registrationRateLimit, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const input = parse(PublicSignUpRequest, req.body);
    const result = await publicSignUp(sql, input, now());
    return reply.status(201).send(result);
  });

  app.post("/v1/auth/register", {
    config: { rateLimit: { max: config.registrationRateLimit, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const body = (req.body as any) || {};
    const email = String(body.email || "").toLowerCase().trim();
    const fullName = String(body.fullName || "").trim();
    const category = String(body.category || body.role || "startup_founder");
    const teamName = String(body.teamName || body.startupName || "").trim();
    const teamMembers = String(body.teamMembers || "").trim();
    const rawMobile = String(body.mobile || body.phoneNumber || "").trim();
    const mobile = normaliseMobile(rawMobile) || (rawMobile && /^\+[1-9]\d{7,14}$/.test(rawMobile) ? rawMobile : null);
    const rawAltMobile = String(body.altMobile || "").trim();
    const altMobile = normaliseMobile(rawAltMobile) || rawAltMobile;
    const domain = String(body.domain || "").trim();
    const city = String(body.city || "").trim();
    const state = String(body.state || "").trim();
    const country = String(body.country || "India").trim();
    const redgNo = String(body.redgNo || "").trim();
    const rollNo = String(body.rollNo || "").trim();
    const organisationName = String(body.organisationName || body.teamName || "").trim();
    const photoUrl = typeof body.photoUrl === "string" ? body.photoUrl.trim() : null;
    const rawLinkedin = String(body.linkedinUrl || "").trim();
    const linkedinUrl = rawLinkedin
      ? /^https?:\/\//i.test(rawLinkedin)
        ? rawLinkedin
        : rawLinkedin.startsWith("//")
        ? `https:${rawLinkedin}`
        : /^([a-z0-9-]+\.)?linkedin\.com/i.test(rawLinkedin)
        ? `https://${rawLinkedin}`
        : rawLinkedin.startsWith("in/")
        ? `https://www.linkedin.com/${rawLinkedin}`
        : /^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(rawLinkedin)
        ? `https://${rawLinkedin}`
        : `https://www.linkedin.com/in/${rawLinkedin.replace(/^@/, "")}`
      : "";
    const password = typeof body.password === "string" ? body.password.trim() : "";

    if (!email || !email.includes("@")) throw new AppError(400, "bad_request", "A valid email address is required");
    if (!fullName) throw new AppError(400, "bad_request", "Full name is required");
    if (rawMobile && !mobile) {
      throw new AppError(400, "bad_request", "Invalid primary phone number format. Please provide a valid 10-digit mobile number or +91 98765 43210.");
    }
    if (category === "volunteer") {
      if (!mobile) throw new AppError(400, "bad_request", "A valid primary phone number is required (e.g. 10-digit mobile or +91 98765 43210)");
      if (!altMobile) throw new AppError(400, "bad_request", "Alternate phone number is required");
      if (!redgNo) throw new AppError(400, "bad_request", "Registration number (redg no) is required");
      if (!rollNo) throw new AppError(400, "bad_request", "Roll number / student ID is required");
    }

    const rawMembers: Array<any> = Array.isArray(body.members) ? body.members : [];
    const members: Array<{ name: string; photoUrl?: string; phone: string; email: string }> = rawMembers.slice(0, 5).map((m: any) => ({
      name: String(m?.name || "").trim(),
      photoUrl: typeof m?.photoUrl === "string" ? m.photoUrl.trim() : undefined,
      phone: normaliseMobile(String(m?.phone || "").trim()) || String(m?.phone || "").trim(),
      email: String(m?.email || "").toLowerCase().trim(),
    }));

    const isStartupLeader = category === "startup_founder" || category === "startup_team_leader" || category === "startup_leader";
    const isStudentInnovator = category === "student_innovator";
    const isVolunteer = category === "volunteer";

    let role = "delegate";
    if (isStartupLeader || isStudentInnovator) role = "startup_team_leader";
    else if (category === "startup_team_member") role = "startup_team_member";
    else if (isVolunteer) role = "volunteer";
    else if (category === "mentor" || category === "jury_member") role = "jury_member";
    else if (category === "management") role = "management";

    const teamMembersSummary = members.length > 0
      ? members.map((m, i) => `${i + 1}. ${m.name} (${m.email}, ${m.phone})`).join("; ")
      : String(body.teamMembers || "").trim();

    const [u] = await sql<{ id: string }[]>`
      insert into user_accounts (
        auth_subject, email, full_name, mobile_e164, status,
        category, team_name, team_members, team_members_json, domain, alt_mobile, city, state, country, linkedin_url,
        redg_no, roll_no, organisation_name, photo_url
      )
      values (
        ${`dev|${email}`}, ${email}, ${fullName}, ${mobile || null}, 'active',
        ${category}, ${teamName || organisationName || null}, ${teamMembersSummary || null}, ${JSON.stringify(members)}::jsonb, ${domain || null}, ${altMobile || null}, ${city || null}, ${state || null}, ${country || 'India'}, ${linkedinUrl || null},
        ${redgNo || null}, ${rollNo || null}, ${organisationName || teamName || null}, ${photoUrl || null}
      )
      on conflict (lower(email)) where email is not null do update
      set full_name = ${fullName},
          mobile_e164 = coalesce(${mobile || null}, user_accounts.mobile_e164),
          category = ${category},
          team_name = coalesce(${teamName || organisationName || null}, user_accounts.team_name),
          team_members = coalesce(${teamMembersSummary || null}, user_accounts.team_members),
          team_members_json = coalesce(${JSON.stringify(members)}::jsonb, user_accounts.team_members_json),
          domain = coalesce(${domain || null}, user_accounts.domain),
          alt_mobile = coalesce(${altMobile || null}, user_accounts.alt_mobile),
          city = coalesce(${city || null}, user_accounts.city),
          state = coalesce(${state || null}, user_accounts.state),
          country = coalesce(${country || 'India'}, user_accounts.country),
          linkedin_url = coalesce(${linkedinUrl || null}, user_accounts.linkedin_url),
          redg_no = coalesce(${redgNo || null}, user_accounts.redg_no),
          roll_no = coalesce(${rollNo || null}, user_accounts.roll_no),
          organisation_name = coalesce(${organisationName || teamName || null}, user_accounts.organisation_name),
          photo_url = coalesce(${photoUrl || null}, user_accounts.photo_url),
          updated_at = now()
      returning id
    `;

    const userId = u!.id;
    await sql`
      insert into role_grants (user_id, role, edition_id)
      values (${userId}, ${role}, 2026)
      on conflict do nothing
    `;
    await sql`
      insert into edition_access (user_id, edition_id, source)
      values (${userId}, 2026, 'predefined')
      on conflict do nothing
    `;

    // Link startup if teamName provided
    let startupId: string | null = null;
    if (teamName && !isVolunteer) {
      const [existingStartup] = await sql<{ id: string }[]>`
        select id from startups where name_normalized = lower(regexp_replace(trim(${teamName}), '\\s+', ' ', 'g')) limit 1
      `;
      if (existingStartup) {
        startupId = existingStartup.id;
      } else {
        const [newStartup] = await sql<{ id: string }[]>`
          insert into startups (name, origin, created_by, city, state)
          values (${teamName}, 'applicant', ${userId}, ${city || null}, ${state || null})
          returning id
        `;
        startupId = newStartup?.id || null;
      }

      if (startupId) {
        await sql`
          insert into startup_memberships (startup_id, user_id, position)
          values (${startupId}, ${userId}, ${role === 'startup_team_leader' ? 'leader' : 'member'})
          on conflict (startup_id, user_id) do update set position = ${role === 'startup_team_leader' ? 'leader' : 'member'}
        `;
      }
    }

    // 1. Startup Team Leader registration details & team members
    if (isStartupLeader) {
      await sql`
        insert into startup_team_leaders (
          user_id, startup_id, team_name, full_name, email,
          mobile, alt_mobile, domain, city, state, country,
          linkedin_url, photo_url, edition_id
        )
        values (
          ${userId}, ${startupId}, ${teamName}, ${fullName}, ${email},
          ${mobile || null}, ${altMobile || null}, ${domain || null}, ${city || null}, ${state || null}, ${country || 'India'},
          ${linkedinUrl || null}, ${photoUrl || null}, 2026
        )
        on conflict (user_id) do update set
          startup_id = coalesce(${startupId}, startup_team_leaders.startup_id),
          team_name = ${teamName},
          full_name = ${fullName},
          email = ${email},
          mobile = coalesce(${mobile || null}, startup_team_leaders.mobile),
          alt_mobile = coalesce(${altMobile || null}, startup_team_leaders.alt_mobile),
          domain = coalesce(${domain || null}, startup_team_leaders.domain),
          city = coalesce(${city || null}, startup_team_leaders.city),
          state = coalesce(${state || null}, startup_team_leaders.state),
          country = coalesce(${country || 'India'}, startup_team_leaders.country),
          linkedin_url = coalesce(${linkedinUrl || null}, startup_team_leaders.linkedin_url),
          photo_url = coalesce(${photoUrl || null}, startup_team_leaders.photo_url),
          updated_at = now()
      `;

      if (members.length > 0) {
        await sql`delete from startup_team_members where leader_user_id = ${userId}`;
        for (const m of members) {
          if (m && m.name && m.email) {
            const memberEmail = m.email.toLowerCase().trim();
            const memberAuthSub = `dev|${memberEmail}`;
            const [memberUser] = await sql<{ id: string }[]>`
              insert into user_accounts (
                auth_subject, email, full_name, mobile_e164, status,
                category, team_name, domain, city, state, country, photo_url
              )
              values (
                ${memberAuthSub}, ${memberEmail}, ${m.name}, ${m.phone || null}, 'active',
                'startup_team_member', ${teamName || null}, ${domain || null}, ${city || null}, ${state || null}, ${country || 'India'}, ${m.photoUrl || null}
              )
              on conflict (lower(email)) where email is not null do update
              set full_name = ${m.name},
                  mobile_e164 = coalesce(${m.phone || null}, user_accounts.mobile_e164),
                  category = 'startup_team_member',
                  team_name = coalesce(${teamName || null}, user_accounts.team_name),
                  domain = coalesce(${domain || null}, user_accounts.domain),
                  photo_url = coalesce(${m.photoUrl || null}, user_accounts.photo_url),
                  updated_at = now()
              returning id
            `;
            const memberUserId = memberUser?.id || null;
            if (memberUserId) {
              await sql`
                insert into role_grants (user_id, role, edition_id)
                values (${memberUserId}, 'startup_team_member', 2026)
                on conflict do nothing
              `;
              await sql`
                insert into edition_access (user_id, edition_id, source)
                values (${memberUserId}, 2026, 'predefined')
                on conflict do nothing
              `;
              if (startupId) {
                await sql`
                  insert into startup_memberships (startup_id, user_id, position)
                  values (${startupId}, ${memberUserId}, 'member')
                  on conflict (startup_id, user_id) do update set position = 'member'
                `;
              }
            }

            await sql`
              insert into startup_team_members (startup_id, leader_user_id, user_id, name, photo_url, phone, email)
              values (
                ${startupId},
                ${userId},
                ${memberUserId},
                ${m.name},
                ${m.photoUrl || null},
                ${m.phone},
                ${memberEmail}
              )
            `;
          }
        }
      }
    }

    // 2. Student Innovator registration details & student team members
    if (isStudentInnovator) {
      const [innovator] = await sql<{ id: string }[]>`
        insert into student_innovators (
          user_id, startup_id, team_name, full_name, email,
          mobile, alt_mobile, domain, city, state, country,
          linkedin_url, photo_url, edition_id
        )
        values (
          ${userId}, ${startupId}, ${teamName}, ${fullName}, ${email},
          ${mobile || null}, ${altMobile || null}, ${domain || null}, ${city || null}, ${state || null}, ${country || 'India'},
          ${linkedinUrl || null}, ${photoUrl || null}, 2026
        )
        on conflict (user_id) do update set
          startup_id = coalesce(${startupId}, student_innovators.startup_id),
          team_name = ${teamName},
          full_name = ${fullName},
          email = ${email},
          mobile = coalesce(${mobile || null}, student_innovators.mobile),
          alt_mobile = coalesce(${altMobile || null}, student_innovators.alt_mobile),
          domain = coalesce(${domain || null}, student_innovators.domain),
          city = coalesce(${city || null}, student_innovators.city),
          state = coalesce(${state || null}, student_innovators.state),
          country = coalesce(${country || 'India'}, student_innovators.country),
          linkedin_url = coalesce(${linkedinUrl || null}, student_innovators.linkedin_url),
          photo_url = coalesce(${photoUrl || null}, student_innovators.photo_url),
          updated_at = now()
        returning id
      `;
      const studentInnovatorId = innovator?.id || null;

      if (members.length > 0) {
        await sql`delete from student_team_members where leader_user_id = ${userId}`;
        for (const m of members) {
          if (m && m.name && m.email) {
            const memberEmail = m.email.toLowerCase().trim();
            const memberAuthSub = `dev|${memberEmail}`;
            const [memberUser] = await sql<{ id: string }[]>`
              insert into user_accounts (
                auth_subject, email, full_name, mobile_e164, status,
                category, team_name, domain, city, state, country, photo_url
              )
              values (
                ${memberAuthSub}, ${memberEmail}, ${m.name}, ${m.phone || null}, 'active',
                'student_innovator', ${teamName || null}, ${domain || null}, ${city || null}, ${state || null}, ${country || 'India'}, ${m.photoUrl || null}
              )
              on conflict (lower(email)) where email is not null do update
              set full_name = ${m.name},
                  mobile_e164 = coalesce(${m.phone || null}, user_accounts.mobile_e164),
                  category = 'student_innovator',
                  team_name = coalesce(${teamName || null}, user_accounts.team_name),
                  domain = coalesce(${domain || null}, user_accounts.domain),
                  photo_url = coalesce(${m.photoUrl || null}, user_accounts.photo_url),
                  updated_at = now()
              returning id
            `;
            const memberUserId = memberUser?.id || null;
            if (memberUserId) {
              await sql`
                insert into role_grants (user_id, role, edition_id)
                values (${memberUserId}, 'startup_team_member', 2026)
                on conflict do nothing
              `;
              await sql`
                insert into edition_access (user_id, edition_id, source)
                values (${memberUserId}, 2026, 'predefined')
                on conflict do nothing
              `;
              if (startupId) {
                await sql`
                  insert into startup_memberships (startup_id, user_id, position)
                  values (${startupId}, ${memberUserId}, 'member')
                  on conflict (startup_id, user_id) do update set position = 'member'
                `;
              }
            }

            await sql`
              insert into student_team_members (student_innovator_id, leader_user_id, user_id, team_name, name, photo_url, phone, email)
              values (
                ${studentInnovatorId},
                ${userId},
                ${memberUserId},
                ${teamName || null},
                ${m.name},
                ${m.photoUrl || null},
                ${m.phone},
                ${memberEmail}
              )
            `;
          }
        }
      }
    }

    // 3. Volunteer registration details
    if (isVolunteer) {
      await sql`
        insert into volunteers (
          user_id, full_name, email, mobile, alt_mobile, organisation_name,
          redg_no, roll_no, city, state, country, linkedin_url, photo_url, edition_id
        )
        values (
          ${userId}, ${fullName}, ${email}, ${mobile}, ${altMobile}, ${organisationName || teamName},
          ${redgNo}, ${rollNo}, ${city}, ${state}, ${country || 'India'},
          ${linkedinUrl || null}, ${photoUrl || null}, 2026
        )
        on conflict (user_id) do update set
          full_name = ${fullName},
          email = ${email},
          mobile = ${mobile},
          alt_mobile = ${altMobile},
          organisation_name = ${organisationName || teamName},
          redg_no = ${redgNo},
          roll_no = ${rollNo},
          city = ${city},
          state = ${state},
          country = ${country || 'India'},
          linkedin_url = coalesce(${linkedinUrl || null}, volunteers.linkedin_url),
          photo_url = coalesce(${photoUrl || null}, volunteers.photo_url),
          updated_at = now()
      `;
    }

    if (password) {
      // update password hash
      const salt = randomBytes(16).toString("hex");
      const derivedKey = scryptSync(password, salt, 64);
      const hash = `${salt}:${derivedKey.toString("hex")}`;
      await sql`update user_accounts set password_hash = ${hash} where id = ${userId}`;
    }

    return reply.status(201).send({
      ok: true,
      userId,
      email,
      fullName,
      role,
      category,
      message: "Registration successful! You can now log in with your credentials.",
    });
  });

  // ---------------------------------------------------------------- applicant (any signed-in user, own data)
  app.post("/v1/me/registrations", {
    preHandler: [auth, requirePermission("registration.submit")],
    config: { rateLimit: { max: config.registrationRateLimit, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const input = parse(RegistrationRequest, req.body);
    const result = await register(sql, principalOf(req), input, now());
    return reply.status(201).send(result);
  });

  app.get("/v1/me/applications", { preHandler: [auth, requirePermission("application.read_own")] }, async (req) => {
    const p = principalOf(req);
    return p.account ? myApplications(sql, p.account.id, now()) : { startup: null, applications: [] };
  });

  // TBD-37: the applicant withdraws one year's application (before that year's event).
  app.post("/v1/me/applications/:id/withdraw", { preHandler: [auth, requirePermission("application.withdraw_own")] }, async (req) =>
    withdrawApplication(sql, principalOf(req), parse(Id, req.params).id, now()));

  app.get("/v1/me/notifications", { preHandler: [auth, requirePermission("notification.read_own")] }, async (req) => {
    const p = principalOf(req);
    return p.account ? myNotifications(sql, p.account.id) : [];
  });

  // Participant home for an edition: reachable only with edition access (FR-IAM-12, AT-09).
  app.get("/v1/editions/:year/me", { preHandler: [auth, requireEditionAccess()] }, async (req) => {
    const p = principalOf(req);
    const { year } = parse(Year, req.params);
    return { edition: year, access: true, roles: [...p.roles].sort() };
  });

  // ---------------------------------------------------------------- my account (Phase 3)
  app.get("/v1/me", { preHandler: [authPending] }, async (req) => me(principalOf(req)));

  app.post("/v1/me/activation", {
    preHandler: [authPending],
    config: { rateLimit: { max: config.activationRateLimit, timeWindow: "1 minute" } },
  }, async (req) => {
    const { token } = parse(ActivationRequest, req.body);
    await redeemActivation(sql, principalOf(req), token, now());
    // Re-resolve so the response reflects the now-active account with its roles.
    return me(await resolvePrincipal(sql, principalOf(req).claims, { requireStaffMfa: config.requireStaffMfa, identity }));
  });

  app.post("/v1/me/password", { preHandler: [authPending] }, async (req, reply) => {
    const p = principalOf(req);
    const account = p.account;
    if (!account) throw new AppError(401, "unauthorized", "Sign in first");
    const body = (req.body || {}) as { currentPassword?: string; newPassword?: string };
    const newPassword = String(body.newPassword || "").trim();
    const currentPassword = String(body.currentPassword || "").trim();
    if (!newPassword || newPassword.length < 6) {
      throw new AppError(400, "weak_password", "New password must be at least 6 characters long.");
    }
    const [user] = await sql<{ id: string; password_hash: string | null }[]>`
      select id, password_hash from user_accounts where id = ${account.id}
    `;
    if (!user) throw new AppError(404, "not_found", "User not found");
    if (user.password_hash) {
      if (!currentPassword) {
        throw new AppError(400, "missing_password", "Current password is required.");
      }
      if (!verifyPassword(currentPassword, user.password_hash)) {
        throw new AppError(400, "invalid_password", "Current password does not match our records.");
      }
    }
    const newHash = hashPassword(newPassword);
    await sql`update user_accounts set password_hash = ${newHash}, updated_at = now() where id = ${user.id}`;
    return { ok: true, message: "Your password has been updated successfully." };
  });

  // ---------------------------------------------------------------- admin: accounts and roles (FR-IAM-05/06/09)
  const UserQuery = z.object({
    q: z.string().trim().max(100).optional(),
    role: z.enum(ROLES).optional(),
    status: z.enum(ACCOUNT_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  });
  app.get("/v1/admin/users", { preHandler: [auth, requirePermission("user.read")] }, async (req) =>
    listUsers(sql, parse(UserQuery, req.query)));
  app.get("/v1/admin/users/:id", { preHandler: [auth, requirePermission("user.read")] }, async (req) =>
    getUser(sql, parse(Id, req.params).id));
  app.post("/v1/admin/users/:id/roles", { preHandler: [auth, requirePermission("role.assign")] }, async (req, reply) => {
    const body = parse(RoleGrantRequest, req.body);
    return reply.status(201).send(await grantRole(sql, principalOf(req), parse(Id, req.params).id, body.role, body.edition ?? null));
  });
  app.delete("/v1/admin/users/:id/roles/:grantId", { preHandler: [auth, requirePermission("role.assign")] }, async (req) => {
    const { id, grantId } = parse(z.object({ id: z.string().uuid(), grantId: z.string().regex(/^\d{1,18}$/) }), req.params);
    return revokeRole(sql, principalOf(req), id, grantId);
  });
  app.post("/v1/admin/users/:id/deactivate", { preHandler: [auth, requirePermission("user.manage")] }, async (req) =>
    setStatus(sql, principalOf(req), parse(Id, req.params).id, "deactivated"));
  app.post("/v1/admin/users/:id/reactivate", { preHandler: [auth, requirePermission("user.manage")] }, async (req) =>
    setStatus(sql, principalOf(req), parse(Id, req.params).id, "reactivated"));
  app.post("/v1/admin/users/:id/activation", { preHandler: [auth, requirePermission("activation.issue")] }, async (req, reply) =>
    reply.status(201).send(await issueActivation(sql, principalOf(req), parse(Id, req.params).id, config.activationTtlHours, now(), automated)));
  app.post("/v1/admin/credentials", { preHandler: [auth, requirePermission("role.assign")] }, async (req, reply) => {
    const body = parse(AdminCreateCredentialRequest, req.body);
    return reply.status(201).send(await createCredential(sql, principalOf(req), body, config.activationTtlHours, now()));
  });

  // ---------------------------------------------------------------- admin: bulk import (FR-IMP-*)
  app.get("/v1/admin/imports", { preHandler: [auth, requirePermission("import.manage")] }, async () => listBatches(sql));
  app.get("/v1/admin/imports/templates/:category", { preHandler: [auth, requirePermission("import.manage")] }, async (req, reply) => {
    const { category } = parse(z.object({ category: z.enum(IMPORT_CATEGORIES) }), req.params);
    return reply.header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="sj-import-${category}.csv"`).send(templateCsv(category));
  });
  app.post("/v1/admin/imports", { preHandler: [auth, requirePermission("import.manage")], bodyLimit: 3 * 1024 * 1024 }, async (req, reply) =>
    reply.status(201).send(await previewImport(sql, principalOf(req), parse(ImportPreviewRequest, req.body))));
  app.get("/v1/admin/imports/:id", { preHandler: [auth, requirePermission("import.manage")] }, async (req) =>
    getBatch(sql, parse(Id, req.params).id));
  app.post("/v1/admin/imports/:id/commit", { preHandler: [auth, requirePermission("import.manage")] }, async (req) =>
    commitBatch(sql, principalOf(req), parse(Id, req.params).id, parse(ImportCommitRequest, req.body ?? {}).excludeRows ?? []));
  app.post("/v1/admin/imports/:id/discard", { preHandler: [auth, requirePermission("import.manage")] }, async (req) =>
    discardBatch(sql, principalOf(req), parse(Id, req.params).id));

  // ---------------------------------------------------------------- management
  app.get("/v1/manage/editions/:year/applications", { preHandler: [auth, requirePermission("application.read_all")] }, async (req) => {
    const { year } = parse(Year, req.params);
    const q = parse(z.object({ status: z.enum(INTERNAL_STATUSES).optional() }), req.query);
    return listApplications(sql, year, q);
  });

  app.get("/v1/manage/applications/:id", { preHandler: [auth, requirePermission("application.read_all")] }, async (req) => {
    const { id } = parse(Id, req.params);
    return getApplication(sql, id);
  });

  app.put("/v1/manage/applications/:id/decision", { preHandler: [auth, requirePermission("decision.draft")] }, async (req) => {
    const { id } = parse(Id, req.params);
    return draftDecision(sql, principalOf(req), id, parse(DecisionRequest, req.body), now());
  });

  app.delete("/v1/manage/applications/:id/decision", { preHandler: [auth, requirePermission("decision.draft")] }, async (req) => {
    const { id } = parse(Id, req.params);
    return withdrawDraft(sql, principalOf(req), id);
  });

  app.post("/v1/manage/editions/:year/decisions/release", { preHandler: [auth, requirePermission("decision.release")] }, async (req) => {
    const { year } = parse(Year, req.params);
    const body = parse(ReleaseRequest, req.body ?? {});
    return releaseDecisions(sql, principalOf(req), year, body.applicationIds, { confirmOverLimit: body.confirmOverLimit, now: now(), webUrl });
  });

  app.put("/v1/manage/editions/:year/selection-limit", { preHandler: [auth, requirePermission("selection_limit.configure")] }, async (req) => {
    const { year } = parse(Year, req.params);
    return setSelectionLimit(sql, principalOf(req), year, parse(SelectionLimitRequest, req.body).limit);
  });

  // ---------------------------------------------------------------- decision corrections (TBD-37): two people
  app.get("/v1/manage/editions/:year/corrections", { preHandler: [auth, requirePermission("decision.correct")] }, async (req) => {
    const { year } = parse(Year, req.params);
    const q = parse(z.object({ status: z.enum(["pending", "applied", "rejected", "cancelled"]).optional() }), req.query);
    return listCorrections(sql, year, q.status);
  });
  app.post("/v1/manage/applications/:id/corrections", { preHandler: [auth, requirePermission("decision.correct")] }, async (req, reply) =>
    reply.status(201).send(await requestCorrection(sql, principalOf(req), parse(Id, req.params).id, parse(DecisionCorrectionRequest, req.body))));
  app.post("/v1/manage/corrections/:id/approve", { preHandler: [auth, requirePermission("decision.correct")] }, async (req) =>
    approveCorrection(sql, principalOf(req), parse(Id, req.params).id, parse(CorrectionReviewRequest, req.body ?? {}).note, { now: now(), webUrl }));
  app.post("/v1/manage/corrections/:id/reject", { preHandler: [auth, requirePermission("decision.correct")] }, async (req) =>
    rejectCorrection(sql, principalOf(req), parse(Id, req.params).id, parse(CorrectionReviewRequest, req.body ?? {}).note));
  app.post("/v1/manage/corrections/:id/cancel", { preHandler: [auth, requirePermission("decision.correct")] }, async (req) =>
    cancelCorrection(sql, principalOf(req), parse(Id, req.params).id));

  // ---------------------------------------------------------------- AI ranking (Phase 5, FR-RNK-*)
  app.get("/v1/manage/editions/:year/criteria-sets", { preHandler: [auth, requirePermission("ranking.read")] }, async (req) =>
    listCriteriaSets(sql, parse(Year, req.params).year));
  app.post("/v1/manage/editions/:year/criteria-sets", { preHandler: [auth, requirePermission("criteria.manage")] }, async (req, reply) =>
    reply.status(201).send(await createCriteriaSet(sql, principalOf(req), parse(Year, req.params).year, parse(CriteriaSetCreate, req.body))));
  app.post("/v1/manage/criteria-sets/:id/approve", { preHandler: [auth, requirePermission("criteria.manage")] }, async (req) =>
    approveCriteriaSet(sql, principalOf(req), parse(Id, req.params).id));
  app.get("/v1/manage/editions/:year/ranking-runs", { preHandler: [auth, requirePermission("ranking.read")] }, async (req) =>
    listRuns(sql, parse(Year, req.params).year));
  app.post("/v1/manage/editions/:year/ranking-runs", { preHandler: [auth, requirePermission("ranking.run")] }, async (req, reply) => {
    const { criteriaSetId } = parse(StartRankingRunRequest, req.body);
    return reply.status(202).send(await startRun(sql, principalOf(req), parse(Year, req.params).year, criteriaSetId, rankingModelRef, now()));
  });
  app.get("/v1/manage/ranking-runs/:id", { preHandler: [auth, requirePermission("ranking.read")] }, async (req) =>
    getRun(sql, parse(Id, req.params).id));
  app.put("/v1/manage/ranking-runs/:id/cut-line", { preHandler: [auth, requirePermission("ranking.run")] }, async (req) =>
    setCutLine(sql, principalOf(req), parse(Id, req.params).id, parse(CutLineRequest, req.body).cutLine));

  // ---------------------------------------------------------------- jury evaluation, Management (Phase 6, FR-JRY-*)
  // Jury scoring is decision support for the event only; nothing here reads or writes ranking or selection data.
  const jm = { preHandler: [auth, requirePermission("jury.manage")] };
  const jr = { preHandler: [auth, requirePermission("jury.review")] };
  app.get("/v1/manage/editions/:year/jury", jm, async (req) => juryOverview(sql, parse(Year, req.params).year));
  app.post("/v1/manage/editions/:year/rubrics", jm, async (req, reply) =>
    reply.status(201).send(await createRubric(sql, principalOf(req), parse(Year, req.params).year, parse(RubricCreate, req.body))));
  app.post("/v1/manage/rubrics/:id/approve", jm, async (req) => approveRubric(sql, principalOf(req), parse(Id, req.params).id));
  app.post("/v1/manage/editions/:year/jury-assignments", jm, async (req, reply) =>
    reply.status(201).send(await assignJury(sql, principalOf(req), parse(Year, req.params).year, parse(JuryAssignmentRequest, req.body))));
  app.delete("/v1/manage/jury-assignments/:id", jm, async (req) => removeJuryAssignment(sql, principalOf(req), parse(Id, req.params).id));
  app.post("/v1/manage/editions/:year/pitch-slots", jm, async (req, reply) =>
    reply.status(201).send(await createSlot(sql, principalOf(req), parse(Year, req.params).year, parse(PitchSlotRequest, req.body))));
  app.put("/v1/manage/pitch-slots/:id", jm, async (req) => updateSlot(sql, principalOf(req), parse(Id, req.params).id, parse(PitchSlotUpdate, req.body)));
  app.delete("/v1/manage/pitch-slots/:id", jm, async (req) => deleteSlot(sql, principalOf(req), parse(Id, req.params).id));
  app.post("/v1/manage/pitch-slots/:id/start", jm, async (req) => startPitch(sql, principalOf(req), parse(Id, req.params).id));
  app.post("/v1/manage/pitch-slots/:id/finish", jm, async (req) => finishPitch(sql, principalOf(req), parse(Id, req.params).id));
  app.get("/v1/manage/editions/:year/evaluations", jr, async (req) => reviewEvaluations(sql, parse(Year, req.params).year));
  app.post("/v1/manage/evaluations/:id/reopen", jr, async (req) =>
    reopenEvaluation(sql, principalOf(req), parse(Id, req.params).id, parse(ReopenRequest, req.body).reason));

  // ---------------------------------------------------------------- jury evaluation, jurors (own assignments only)
  const juror = { preHandler: [auth, requireEditionAccess(), requirePermission("jury.evaluate")] };
  const StartupParam = z.object({ year: z.coerce.number().int().min(2026).max(2100), startupId: z.string().uuid() });
  app.get("/v1/editions/:year/jury", juror, async (req) => juryHome(sql, principalOf(req), parse(Year, req.params).year));
  app.get("/v1/editions/:year/jury/startups/:startupId", juror, async (req) => {
    const { year, startupId } = parse(StartupParam, req.params);
    return juryStartupProfile(sql, principalOf(req), year, startupId);
  });
  app.put("/v1/editions/:year/jury/startups/:startupId/evaluation", juror, async (req) => {
    const { year, startupId } = parse(StartupParam, req.params);
    return saveEvaluation(sql, principalOf(req), year, startupId, parse(EvaluationSave, req.body), false);
  });
  app.post("/v1/editions/:year/jury/startups/:startupId/evaluation/submit", juror, async (req) => {
    const { year, startupId } = parse(StartupParam, req.params);
    return saveEvaluation(sql, principalOf(req), year, startupId, parse(EvaluationSave, req.body), true);
  });

  // ---------------------------------------------------------------- volunteer assignment (Phase 6, FR-VOL-*)
  const vRead = { preHandler: [auth, requirePermission("volunteer.read")] };
  const vGen = { preHandler: [auth, requirePermission("volunteer.generate")] };
  const vReview = { preHandler: [auth, requirePermission("volunteer.review")] };
  const vChange = { preHandler: [auth, requirePermission("volunteer.reassign")] };
  const delivery = () => ({ now: now(), webUrl });
  app.get("/v1/manage/editions/:year/volunteers", vRead, async (req) => volunteerOverview(sql, parse(Year, req.params).year));
  app.post("/v1/manage/editions/:year/volunteer-runs", vGen, async (req, reply) =>
    reply.status(201).send(await generateRun(sql, principalOf(req), parse(Year, req.params).year)));
  app.get("/v1/manage/volunteer-runs/:id", vRead, async (req) => getVolunteerRun(sql, parse(Id, req.params).id));
  app.post("/v1/manage/volunteer-runs/:id/approve", vReview, async (req) => approveRun(sql, principalOf(req), parse(Id, req.params).id, delivery()));
  app.post("/v1/manage/volunteer-runs/:id/discard", vGen, async (req) => discardRun(sql, principalOf(req), parse(Id, req.params).id));
  app.post("/v1/manage/editions/:year/volunteer-assignments", vChange, async (req, reply) =>
    reply.status(201).send(await assignManually(sql, principalOf(req), parse(Year, req.params).year, parse(ManualAssignRequest, req.body), delivery())));
  app.post("/v1/manage/volunteer-assignments/:id/reassign", vChange, async (req) =>
    reassign(sql, principalOf(req), parse(Id, req.params).id, parse(ReassignRequest, req.body), delivery()));
  app.post("/v1/manage/volunteer-assignments/:id/close", vChange, async (req) =>
    closeAssignment(sql, principalOf(req), parse(Id, req.params).id, parse(CloseAssignmentRequest, req.body).reason, delivery()));

  // ---------------------------------------------------------------- volunteer desk & directory CRUD
  app.get("/v1/manage/volunteers", vRead, async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const q = (query.q || "").toLowerCase().trim();
    const orgFilter = (query.organisation || "").trim();
    const assignmentFilter = query.assignment || "all";
    const edition = Number(query.edition) || 2026;

    // Auto-sync volunteers table with user_accounts marked as volunteer
    try {
      await sql`
        insert into volunteers (
          user_id, full_name, email, mobile, alt_mobile, organisation_name,
          redg_no, roll_no, city, state, country, linkedin_url, photo_url, edition_id
        )
        select
          u.id as user_id,
          u.full_name,
          coalesce(u.email, 'volunteer@startupjathara.com') as email,
          coalesce(u.mobile_e164, '+910000000000') as mobile,
          coalesce(u.alt_mobile, u.mobile_e164, '+910000000000') as alt_mobile,
          coalesce(u.organisation_name, 'GIET University') as organisation_name,
          coalesce(u.redg_no, '24UG0000') as redg_no,
          coalesce(u.roll_no, '24VOL000') as roll_no,
          coalesce(u.city, 'Gunupur') as city,
          coalesce(u.state, 'Odisha') as state,
          coalesce(u.country, 'India') as country,
          u.linkedin_url,
          u.photo_url,
          ${edition} as edition_id
        from user_accounts u
        join role_grants rg on rg.user_id = u.id and rg.role = 'volunteer' and rg.revoked_at is null
        where not exists (
          select 1 from volunteers v where v.user_id = u.id or (u.email is not null and lower(v.email) = lower(u.email))
        )
        on conflict (user_id) do nothing
      `;
    } catch {}

    const searchPattern = q ? `%${q}%` : null;
    const orgPattern = orgFilter && orgFilter !== "all" ? `%${orgFilter}%` : null;

    const rows = await sql`
      select
        v.id,
        v.user_id as "userId",
        v.full_name as "fullName",
        v.email,
        v.mobile,
        v.alt_mobile as "altMobile",
        v.organisation_name as "organisationName",
        v.redg_no as "redgNo",
        v.roll_no as "rollNo",
        v.city,
        v.state,
        v.country,
        v.linkedin_url as "linkedinUrl",
        v.photo_url as "photoUrl",
        v.edition_id as "editionId",
        v.created_at as "createdAt",
        v.updated_at as "updatedAt",
        coalesce(u.status, 'active') as "accountStatus",
        u.activated_at as "activatedAt",
        va.id as "assignmentId",
        va.state as "assignmentState",
        va.activated_at as "assignedSince",
        va.reason as "assignmentReason",
        case
          when va.target_startup_id is not null then 'startup'
          when va.target_jury_user_id is not null then 'jury'
          else null
        end as "targetType",
        case
          when va.target_startup_id is not null then va.target_startup_id
          when va.target_jury_user_id is not null then va.target_jury_user_id
          else null
        end as "targetId",
        case
          when va.target_startup_id is not null then s.name
          when va.target_jury_user_id is not null then ju.full_name
          else null
        end as "targetName"
      from volunteers v
      left join user_accounts u on u.id = v.user_id
      left join volunteer_assignments va on va.volunteer_user_id = v.user_id and va.state <> 'closed'
      left join startups s on s.id = va.target_startup_id
      left join user_accounts ju on ju.id = va.target_jury_user_id
      where (${searchPattern}::text is null or (
        lower(v.full_name) like ${searchPattern} or
        lower(v.email) like ${searchPattern} or
        lower(v.mobile) like ${searchPattern} or
        lower(v.redg_no) like ${searchPattern} or
        lower(v.roll_no) like ${searchPattern} or
        lower(v.organisation_name) like ${searchPattern} or
        lower(v.city) like ${searchPattern}
      ))
      and (${orgPattern}::text is null or lower(v.organisation_name) like lower(${orgPattern}))
      and (
        ${assignmentFilter} = 'all' or
        (${assignmentFilter} = 'assigned' and va.id is not null) or
        (${assignmentFilter} = 'unassigned' and va.id is null)
      )
      order by v.created_at desc
    `;

    const allVolunteers = await sql`
      select
        count(*)::int as total,
        count(distinct va.id)::int as assigned,
        count(distinct v.organisation_name)::int as organisations
      from volunteers v
      left join volunteer_assignments va on va.volunteer_user_id = v.user_id and va.state <> 'closed'
    `;

    const colleges = await sql`
      select distinct organisation_name as name
      from volunteers
      where organisation_name is not null and trim(organisation_name) <> ''
      order by organisation_name asc
    `;

    const totalVolunteers = allVolunteers[0]?.total || rows.length;
    const assignedCount = allVolunteers[0]?.assigned || 0;
    const unassignedCount = Math.max(0, totalVolunteers - assignedCount);

    return {
      ok: true,
      items: rows,
      summary: {
        totalVolunteers,
        assignedCount,
        unassignedCount,
        organisationsCount: allVolunteers[0]?.organisations || colleges.length,
        availableColleges: colleges.map((c: any) => c.name),
      },
    };
  });

  app.post("/v1/manage/volunteers", vChange, async (req, reply) => {
    const body = req.body as any;
    const fullName = String(body.fullName || "").trim();
    const email = String(body.email || "").toLowerCase().trim();
    const mobile = String(body.mobile || "").trim();
    const altMobile = String(body.altMobile || mobile).trim();
    const organisationName = String(body.organisationName || body.college || "").trim();
    const redgNo = String(body.redgNo || "").trim();
    const rollNo = String(body.rollNo || "").trim();
    const city = String(body.city || "").trim();
    const state = String(body.state || "").trim();
    const country = String(body.country || "India").trim();
    const linkedinUrl = body.linkedinUrl ? String(body.linkedinUrl).trim() : null;
    const photoUrl = body.photoUrl ? String(body.photoUrl).trim() : null;
    const password = body.password ? String(body.password).trim() : "Volunteer@2026!";
    const edition = Number(body.edition) || 2026;

    if (!fullName) return reply.status(400).send({ message: "Full name is required" });
    if (!email || !email.includes("@")) return reply.status(400).send({ message: "Valid email is required" });
    if (!mobile) return reply.status(400).send({ message: "Primary mobile is required" });
    if (!organisationName) return reply.status(400).send({ message: "Organisation / College name is required" });
    if (!redgNo) return reply.status(400).send({ message: "Registration number is required" });
    if (!rollNo) return reply.status(400).send({ message: "Roll number is required" });

    const passwordHash = hashPassword(password);
    const authSub = `dev|${email}`;

    const [user] = await sql`
      insert into user_accounts (
        auth_subject, email, full_name, mobile_e164, password_hash,
        status, category, organisation_name, redg_no, roll_no, photo_url,
        alt_mobile, city, state, country, linkedin_url
      )
      values (
        ${authSub}, ${email}, ${fullName}, ${mobile}, ${passwordHash},
        'active', 'volunteer', ${organisationName}, ${redgNo}, ${rollNo}, ${photoUrl || null},
        ${altMobile || null}, ${city || null}, ${state || null}, ${country || 'India'}, ${linkedinUrl || null}
      )
      on conflict (lower(email)) where email is not null do update
      set auth_subject = ${authSub},
          full_name = ${fullName},
          mobile_e164 = ${mobile},
          password_hash = coalesce(${passwordHash}, user_accounts.password_hash),
          category = 'volunteer',
          status = 'active',
          organisation_name = ${organisationName},
          redg_no = ${redgNo},
          roll_no = ${rollNo},
          photo_url = coalesce(${photoUrl}, user_accounts.photo_url),
          alt_mobile = coalesce(${altMobile}, user_accounts.alt_mobile),
          city = coalesce(${city}, user_accounts.city),
          state = coalesce(${state}, user_accounts.state),
          country = coalesce(${country}, user_accounts.country),
          linkedin_url = coalesce(${linkedinUrl}, user_accounts.linkedin_url),
          updated_at = now()
      returning id, email, full_name
    `;

    if (!user) {
      throw new AppError(500, "user_creation_failed", "Failed to create user account", "Database did not return inserted user record.");
    }

    await sql`
      insert into role_grants (user_id, role, edition_id)
      values (${user.id}, 'volunteer', ${edition})
      on conflict do nothing
    `;

    const [volunteer] = await sql`
      insert into volunteers (
        user_id, full_name, email, mobile, alt_mobile, organisation_name,
        redg_no, roll_no, city, state, country, linkedin_url, photo_url, edition_id
      )
      values (
        ${user.id}, ${fullName}, ${email}, ${mobile}, ${altMobile}, ${organisationName},
        ${redgNo}, ${rollNo}, ${city}, ${state}, ${country}, ${linkedinUrl}, ${photoUrl}, ${edition}
      )
      on conflict (user_id) do update set
        full_name = ${fullName},
        email = ${email},
        mobile = ${mobile},
        alt_mobile = ${altMobile},
        organisation_name = ${organisationName},
        redg_no = ${redgNo},
        roll_no = ${rollNo},
        city = ${city},
        state = ${state},
        country = ${country},
        linkedin_url = coalesce(${linkedinUrl}, volunteers.linkedin_url),
        photo_url = coalesce(${photoUrl}, volunteers.photo_url),
        updated_at = now()
      returning *
    `;

    return reply.status(201).send({
      ok: true,
      message: `Volunteer ${fullName} accredited successfully.`,
      volunteer,
    });
  });

  app.get("/v1/manage/volunteers/:id", vRead, async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await sql`
      select
        v.id,
        v.user_id as "userId",
        v.full_name as "fullName",
        v.email,
        v.mobile,
        v.alt_mobile as "altMobile",
        v.organisation_name as "organisationName",
        v.redg_no as "redgNo",
        v.roll_no as "rollNo",
        v.city,
        v.state,
        v.country,
        v.linkedin_url as "linkedinUrl",
        v.photo_url as "photoUrl",
        v.edition_id as "editionId",
        v.created_at as "createdAt",
        v.updated_at as "updatedAt",
        coalesce(u.status, 'active') as "accountStatus",
        u.activated_at as "activatedAt",
        va.id as "assignmentId",
        va.state as "assignmentState",
        va.activated_at as "assignedSince",
        va.reason as "assignmentReason"
      from volunteers v
      left join user_accounts u on u.id = v.user_id
      left join volunteer_assignments va on va.volunteer_user_id = v.user_id and va.state <> 'closed'
      where v.id = ${id} or v.user_id = ${id}
    `;
    if (!rows.length) return reply.status(404).send({ message: "Volunteer not found" });
    return { ok: true, volunteer: rows[0] };
  });

  app.put("/v1/manage/volunteers/:id", vChange, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;

    const [existing] = await sql`select * from volunteers where id = ${id} or user_id = ${id}`;
    if (!existing) return reply.status(404).send({ message: "Volunteer not found" });

    const fullName = body.fullName !== undefined ? String(body.fullName).trim() : existing.full_name;
    const email = body.email !== undefined ? String(body.email).toLowerCase().trim() : existing.email;
    const mobile = body.mobile !== undefined ? String(body.mobile).trim() : existing.mobile;
    const altMobile = body.altMobile !== undefined ? String(body.altMobile).trim() : existing.alt_mobile;
    const organisationName = body.organisationName !== undefined ? String(body.organisationName).trim() : existing.organisation_name;
    const redgNo = body.redgNo !== undefined ? String(body.redgNo).trim() : existing.redg_no;
    const rollNo = body.rollNo !== undefined ? String(body.rollNo).trim() : existing.roll_no;
    const city = body.city !== undefined ? String(body.city).trim() : existing.city;
    const state = body.state !== undefined ? String(body.state).trim() : existing.state;
    const country = body.country !== undefined ? String(body.country).trim() : existing.country;
    const linkedinUrl = body.linkedinUrl !== undefined ? String(body.linkedinUrl).trim() || null : existing.linkedin_url;
    const photoUrl = body.photoUrl !== undefined ? String(body.photoUrl).trim() || null : existing.photo_url;
    const accountStatus = body.accountStatus !== undefined ? String(body.accountStatus).trim() : undefined;

    const [updated] = await sql`
      update volunteers set
        full_name = ${fullName},
        email = ${email},
        mobile = ${mobile},
        alt_mobile = ${altMobile},
        organisation_name = ${organisationName},
        redg_no = ${redgNo},
        roll_no = ${rollNo},
        city = ${city},
        state = ${state},
        country = ${country},
        linkedin_url = ${linkedinUrl},
        photo_url = ${photoUrl},
        updated_at = now()
      where id = ${existing.id}
      returning *
    `;

    if (existing.user_id) {
      await sql`
        update user_accounts set
          full_name = ${fullName},
          email = ${email},
          mobile_e164 = ${mobile},
          alt_mobile = ${altMobile},
          organisation_name = ${organisationName},
          redg_no = ${redgNo},
          roll_no = ${rollNo},
          city = ${city},
          state = ${state},
          country = ${country},
          linkedin_url = ${linkedinUrl},
          photo_url = ${photoUrl},
          status = coalesce(${accountStatus || null}, status),
          updated_at = now()
        where id = ${existing.user_id}
      `;
    }

    return {
      ok: true,
      message: "Volunteer details updated successfully.",
      volunteer: updated,
    };
  });

  app.patch("/v1/manage/volunteers/:id", vChange, async (req, reply) => {
    return (app as any).inject({ method: "PUT", url: `/v1/manage/volunteers/${(req.params as any).id}`, payload: req.body, headers: req.headers });
  });

  app.delete("/v1/manage/volunteers/:id", vChange, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [existing] = await sql`select * from volunteers where id = ${id} or user_id = ${id}`;
    if (!existing) return reply.status(404).send({ message: "Volunteer not found" });

    // Close any active assignment
    await sql`
      update volunteer_assignments
      set state = 'closed', closed_at = now(), closed_by = ${existing.user_id}, close_reason = 'Volunteer record deleted by administrator'
      where volunteer_user_id = ${existing.user_id} and state <> 'closed'
    `;

    // Revoke volunteer role grant
    await sql`
      update role_grants set revoked_at = now()
      where user_id = ${existing.user_id} and role = 'volunteer'
    `;

    // Delete volunteer record
    await sql`delete from volunteers where id = ${existing.id}`;

    // Deactivate user account if no other active roles
    const otherRoles = await sql`
      select id from role_grants where user_id = ${existing.user_id} and revoked_at is null
    `;
    if (otherRoles.length === 0) {
      await sql`update user_accounts set status = 'deactivated', updated_at = now() where id = ${existing.user_id}`;
    }

    return {
      ok: true,
      id: existing.id,
      message: `Volunteer ${existing.full_name} has been removed from summit accreditation.`,
    };
  });

  // Participants: their own active assignment / volunteer only, for an edition they take part in.
  app.get("/v1/editions/:year/volunteer/assignment", { preHandler: [auth, requireEditionAccess(), requirePermission("volunteer.my_assignment")] },
    async (req) => myAssignment(sql, principalOf(req), parse(Year, req.params).year));
  app.get("/v1/editions/:year/me/volunteer", { preHandler: [auth, requireEditionAccess(), requirePermission("volunteer.my_volunteer")] },
    async (req) => myVolunteer(sql, principalOf(req), parse(Year, req.params).year));

  // ---------------------------------------------------------------- event information (Phase 7, FR-EVT-*; TBD-24)
  // Public and participant views read the same published data (FR-EVT-01): the website and the app never differ.
  app.get("/v1/public/editions/:year/event", async (req) => eventInfo(sql, { kind: "public" }, parse(Year, req.params).year));
  app.get("/v1/public/editions/:year/documents/:id/link", async (req) => {
    const { year, id } = parse(z.object({ year: Year.shape.year, id: z.string().uuid() }), req.params);
    return documentLink(sql, { kind: "public" }, year, id, fileStore, now());
  });
  const participant = { preHandler: [auth, requireEditionAccess()] };
  app.get("/v1/editions/:year/event", participant, async (req) =>
    eventInfo(sql, { kind: "participant", userId: principalOf(req).account!.id }, parse(Year, req.params).year));
  app.get("/v1/editions/:year/documents/:id/link", participant, async (req) => {
    const { year, id } = parse(z.object({ year: Year.shape.year, id: z.string().uuid() }), req.params);
    return documentLink(sql, { kind: "participant", userId: principalOf(req).account!.id }, year, id, fileStore, now());
  });
  // Console: both Admin and Management read everything; the service checks who may edit which type (TBD-24).
  const cRead = { preHandler: [auth, requirePermission("content.read_all")] };
  app.get("/v1/manage/editions/:year/content", cRead, async (req) => contentOverview(sql, principalOf(req), parse(Year, req.params).year));
  app.post("/v1/manage/editions/:year/content", cRead, async (req, reply) =>
    reply.status(201).send(await createContent(sql, principalOf(req), parse(Year, req.params).year, parse(ContentCreate, req.body))));
  app.put("/v1/manage/content/:id", cRead, async (req) => updateContent(sql, principalOf(req), parse(Id, req.params).id, parse(ContentUpdate, req.body)));
  app.post("/v1/manage/content/:id/publish", cRead, async (req) =>
    publishContent(sql, principalOf(req), parse(Id, req.params).id, parse(PublishRequest, req.body).changeSummary));
  app.post("/v1/manage/content/:id/discard-draft", cRead, async (req) => discardDraft(sql, principalOf(req), parse(Id, req.params).id));
  app.post("/v1/manage/content/:id/archive", cRead, async (req) =>
    archiveContent(sql, principalOf(req), parse(Id, req.params).id, parse(ArchiveRequest, req.body).reason));
  app.get("/v1/manage/content/:id/versions", cRead, async (req) => contentVersions(sql, parse(Id, req.params).id));
  app.post("/v1/manage/editions/:year/documents", { ...cRead, bodyLimit: 15 * 1024 * 1024 }, async (req, reply) =>
    reply.status(201).send(await uploadDocument(sql, principalOf(req), parse(Year, req.params).year, parse(DocumentUpload, req.body), fileStore)));
  app.post("/v1/manage/documents/:id/archive", cRead, async (req) => {
    await archiveDocument(sql, principalOf(req), parse(Id, req.params).id, parse(ArchiveRequest, req.body).reason);
    return { archived: true };
  });
  app.get("/v1/manage/documents/:id/link", cRead, async (req) => documentLink(sql, { kind: "staff" }, null, parse(Id, req.params).id, fileStore, now()));
  // Development storage only: the signed token in the path is the authorisation, valid for 60 seconds.
  if (fileStore.name === "database") {
    const store = fileStore as ReturnType<typeof databaseStore>;
    app.get("/v1/files/:token", async (req, reply) => {
      const t = store.verify((req.params as { token: string }).token, now());
      if (!t) throw new AppError(404, "link_expired", "Link expired", "This link has expired. Open the document again.");
      const f = await store.read(sql, t.id);
      if (!f) throw new AppError(404, "not_found", "Not found", "File not found");
      return reply.header("content-type", f.contentType)
        .header("content-disposition", `inline; filename="${f.fileName.replace(/[^A-Za-z0-9._ -]/g, "_")}"`)
        .header("cache-control", "private, no-store").header("x-content-type-options", "nosniff").send(f.bytes);
    });
  }

  // ---------------------------------------------------------------- notices and push (Phase 7, FR-NOT-*; TBD-29, -52)
  const nPub = { preHandler: [auth, requirePermission("notice.publish")] };
  app.get("/v1/manage/editions/:year/notices", nPub, async (req) => noticesOverview(sql, parse(Year, req.params).year));
  app.post("/v1/manage/editions/:year/notices/preview", nPub, async (req) =>
    previewNotice(sql, parse(Year, req.params).year, parse(z.object({ audience: NoticeAudience }), req.body).audience));
  app.post("/v1/manage/editions/:year/notices", nPub, async (req, reply) =>
    reply.status(201).send(await publishNotice(sql, principalOf(req), parse(Year, req.params).year, parse(NoticeCreate, req.body), now())));
  app.put("/v1/manage/notices/:id", nPub, async (req) => editNotice(sql, principalOf(req), parse(Id, req.params).id, parse(NoticeEdit, req.body)));
  app.post("/v1/manage/notices/:id/withdraw", nPub, async (req) =>
    withdrawNotice(sql, principalOf(req), parse(Id, req.params).id, parse(NoticeWithdraw, req.body).reason));
  app.post("/v1/manage/editions/:year/notice-groups", nPub, async (req, reply) =>
    reply.status(201).send(await createGroup(sql, principalOf(req), parse(Year, req.params).year, parse(NoticeGroupCreate, req.body))));
  app.post("/v1/manage/notice-groups/:id/members", nPub, async (req) =>
    addMembers(sql, principalOf(req), parse(Id, req.params).id, parse(GroupMembersAdd, req.body).userIds));
  app.delete("/v1/manage/notice-groups/:id/members/:userId", nPub, async (req) => {
    const { id, userId } = parse(z.object({ id: z.string().uuid(), userId: z.string().uuid() }), req.params);
    return removeMember(sql, principalOf(req), id, userId);
  });
  const own = { preHandler: [auth, requirePermission("push.register_own")] };
  app.post("/v1/me/push-tokens", own, async (req) => registerPushToken(sql, principalOf(req), parse(PushTokenRegister, req.body)));
  app.delete("/v1/me/push-tokens", own, async (req) =>
    removePushToken(sql, principalOf(req), parse(z.object({ token: z.string().max(300) }), req.body).token));
  app.post("/v1/me/notifications/:id/read", { preHandler: [auth, requirePermission("notification.read_own")] }, async (req) =>
    markRead(sql, principalOf(req).account!.id, parse(Id, req.params).id));

  // ---------------------------------------------------------------- AI Help Desk, mobile app channel (Phase 8, FR-HD-*)
  // The identity comes from the authenticated session only (FR-HD-02); the engine never trusts names or ids in text.
  const identityOf = (p: Principal): HelpDeskIdentity => {
    if (!p.account) throw new AppError(409, "account_required", "Account needed", "Register or activate your account to use the Help Desk.");
    return { userId: p.account.id, roles: p.roles, editionAccess: p.editionAccess };
  };
  const hdDeps = () => ({ sql, model: helpdeskModel, now: now(), onError: (err: unknown, where: string) => app.log.error({ err }, where) });
  const EditionQuery = z.object({ edition: z.coerce.number().int().min(2026).max(2100) });
  app.post("/v1/helpdesk/messages", {
    preHandler: [auth, requirePermission("helpdesk.use")],
    config: { rateLimit: { max: config.helpdesk.rateLimit, timeWindow: "1 minute", keyGenerator: (req) => req.headers.authorization ?? req.ip } },
  }, async (req) => ask(hdDeps(), identityOf(principalOf(req)), parse(HelpDeskAsk, req.body)));
  app.get("/v1/helpdesk/conversation", { preHandler: [auth, requirePermission("helpdesk.use")] }, async (req) =>
    getConversation(sql, identityOf(principalOf(req)), parse(EditionQuery, req.query).edition));
  app.post("/v1/helpdesk/conversations/:id/escalate", { preHandler: [auth, requirePermission("helpdesk.use")] }, async (req) => {
    const { id } = parse(Id, req.params);
    const { edition } = parse(EditionQuery, req.query);
    return escalateConversation(hdDeps(), identityOf(principalOf(req)), edition, id, parse(HelpDeskEscalate, req.body ?? {}).note);
  });

  // ---------------------------------------------------------------- emergency control (FR-HD-10/11, AT-31)
  // Never rate-limited and never gated on a role or edition access: anyone signed in can raise it. The contacts come
  // back even when the alert cannot be recorded.
  app.post("/v1/editions/:year/emergency", { preHandler: [auth, requirePermission("emergency.report")] }, async (req) =>
    reportEmergency(sql, principalOf(req).account?.id ?? null, parse(Year, req.params).year, parse(EmergencyReport, req.body), now(),
      { onError: (err) => app.log.error({ err }, "emergency alert could not be recorded") }));

  // ---------------------------------------------------------------- own support requests (FR-SUP-15)
  const ownT = { preHandler: [auth, requirePermission("support.request_own")] };
  app.get("/v1/me/tickets", ownT, async (req) => {
    const p = principalOf(req);
    const q = parse(z.object({ edition: z.coerce.number().int().min(2026).max(2100).optional() }), req.query);
    return p.account ? myTickets(sql, p.account.id, q.edition) : [];
  });
  app.post("/v1/me/tickets", ownT, async (req, reply) => {
    const p = principalOf(req);
    identityOf(p);   // an account is needed to own a ticket
    return reply.status(201).send(await createOwnTicket(sql, p, parse(RequesterTicketCreate, req.body), now()));
  });
  app.post("/v1/me/tickets/:id/notes", ownT, async (req) => {
    const p = principalOf(req);
    identityOf(p);
    return addRequesterNote(sql, p, parse(Id, req.params).id, parse(TicketText, req.body).text, now());
  });

  // ---------------------------------------------------------------- Customer Support dashboard (FR-SUP-01…14)
  // Support staff handle tickets; Management reviews them read-only (FR-SUP-10) and receives escalations (TBD-27).
  const sRead = { preHandler: [auth, requireAnyPermission(["support.handle", "support.review"])] };
  const sWrite = { preHandler: [auth, requirePermission("support.handle")] };
  const QueueQuery = z.object({
    edition: z.coerce.number().int().min(2026).max(2100).optional(),
    status: z.enum([...TICKET_STATUSES, "active"] as [string, ...string[]]).optional(),
    mine: z.enum(["true", "false"]).optional(),
  });
  app.get("/v1/support/tickets", sRead, async (req) => {
    const q = parse(QueueQuery, req.query);
    return supportQueue(sql, principalOf(req), { edition: q.edition, status: q.status as never, mine: q.mine === "true" }, now());
  });
  app.get("/v1/support/tickets/:id", sRead, async (req) => ticketDetail(sql, principalOf(req), parse(Id, req.params).id, now()));
  app.post("/v1/support/tickets", sWrite, async (req, reply) => {
    const input = parse(SupportTicketCreate, req.body);
    return reply.status(201).send(await createOnBehalf(sql, principalOf(req), input, now()));
  });
  app.post("/v1/support/tickets/:id/acknowledge", sWrite, async (req) => acknowledge(sql, principalOf(req), parse(Id, req.params).id, now()));
  app.post("/v1/support/tickets/:id/status", sWrite, async (req) =>
    setTicketStatus(sql, principalOf(req), parse(Id, req.params).id, parse(SupportStatusUpdate, req.body), now()));
  app.post("/v1/support/tickets/:id/assign", sWrite, async (req) =>
    assign(sql, principalOf(req), parse(Id, req.params).id, parse(SupportAssign, req.body).assigneeId, now()));
  app.post("/v1/support/tickets/:id/notes", sWrite, async (req) => addNote(sql, principalOf(req), parse(Id, req.params).id, parse(SupportNote, req.body), now()));
  app.post("/v1/support/tickets/:id/contact", sWrite, async (req) =>
    logContact(sql, principalOf(req), parse(Id, req.params).id, parse(SupportContactLog, req.body), now()));
  app.post("/v1/support/tickets/:id/escalate", sWrite, async (req) =>
    escalate(sql, principalOf(req), parse(Id, req.params).id, parse(SupportEscalate, req.body).reason, now()));
  app.post("/v1/support/tickets/:id/priority", sWrite, async (req) => raisePriority(sql, principalOf(req), parse(Id, req.params).id, now()));
  app.get("/v1/support/requesters", sWrite, async (req) => findRequester(sql, parse(z.object({ q: z.string().trim().min(3).max(200) }), req.query).q));
  const alertsG = { preHandler: [auth, requirePermission("support.alerts")] };
  app.get("/v1/support/alerts", alertsG, async (req) => myAlerts(sql, principalOf(req)));
  app.post("/v1/support/alerts/:id/seen", alertsG, async (req) =>
    markAlertSeen(sql, principalOf(req), parse(z.object({ id: z.string().regex(/^\d{1,18}$/) }), req.params).id, now()));
  app.get("/v1/support/editions/:year/policy", alertsG, async (req) => getPolicy(sql, parse(Year, req.params).year));
  app.put("/v1/manage/editions/:year/support-policy", { preHandler: [auth, requirePermission("support.configure")] }, async (req) =>
    setPolicy(sql, principalOf(req), parse(Year, req.params).year, parse(SupportPolicy, req.body)));

  // ---------------------------------------------------------------- development sign-in (never in production)
  if (config.authMode === "dev" && config.nodeEnv !== "production") {
    app.post("/v1/dev/session", async (req) => {
      const body = parse(DevSessionRequest, req.body);
      const phone = body.phone ? normaliseMobile(body.phone) : null;
      if (body.phone && !phone) throw new AppError(400, "validation_failed", "Enter a valid mobile number");
      const email = body.email?.toLowerCase().trim();
      if (email && ["sarangeeamartya@gmail.com", "arushkumar450@gmail.com", "akshatrajpati@gmail.com"].includes(email)) {
        try {
          const authSub = `dev|${email}`;
          const name = email.split("@")[0] || "Admin";
          const rows = (await sql`
            insert into user_accounts (auth_subject, email, full_name, status)
            values (${authSub}, ${email}, ${name}, 'active')
            on conflict (lower(email)) where email is not null do update
            set status = 'active', auth_subject = coalesce(user_accounts.auth_subject, excluded.auth_subject)
            returning id`) as unknown as { id: string }[];
          const u = rows[0];
          if (u) {
            await sql`insert into role_grants (user_id, role) select ${u.id}, 'admin' where not exists (select 1 from role_grants where user_id = ${u.id} and role = 'admin' and revoked_at is null)`;
            await sql`insert into role_grants (user_id, role) select ${u.id}, 'management' where not exists (select 1 from role_grants where user_id = ${u.id} and role = 'management' and revoked_at is null)`;
            await sql`insert into role_grants (user_id, role) select ${u.id}, 'customer_support' where not exists (select 1 from role_grants where user_id = ${u.id} and role = 'customer_support' and revoked_at is null)`;
            await sql`insert into edition_access (user_id, edition_id, source) values (${u.id}, 2026, 'predefined') on conflict (user_id, edition_id) do nothing`;
          }
        } catch {
          // ignore if DB query fails
        }
      }
      return { token: await issueDevToken(config.devAuthSecret!, body.email ?? null, { aal: body.mfa ? "aal2" : "aal1", ...(phone ? { phone } : {}) }) };
    });
  }

  // ---------------------------------------------------------------- Nodemailer email OTP
  app.post("/v1/auth/otp/send", async (req) => {
    const body = parse(SendOtpRequest, req.body);
    return sendOtpEmail(body.email, body.purpose, sql);
  });

  app.post("/v1/auth/otp/verify", async (req, reply) => {
    const body = parse(VerifyOtpRequest, req.body);
    const result = await verifyOtpAndLogin(
      sql,
      config.devAuthSecret ?? "dev-auth-secret-for-jwt-signing-12345",
      body.email,
      body.code,
      body.password,
    );
    reply.header(
      "set-cookie",
      `sj_token=${encodeURIComponent(result.token)}; Path=/; Max-Age=86400; SameSite=Lax`
    );
    return result;
  });

  app.post("/v1/auth/login", async (req, reply) => {
    const body = parse(LoginRequest, req.body);
    const result = await verifyOtpAndLogin(
      sql,
      config.devAuthSecret ?? "dev-auth-secret-for-jwt-signing-12345",
      body.email,
      "",
      body.password,
    );
    reply.header(
      "set-cookie",
      `sj_token=${encodeURIComponent(result.token)}; Path=/; Max-Age=86400; SameSite=Lax`
    );
    return result;
  });

  app.post("/v1/auth/password/update", async (req) => {
    const body = parse(UpdatePasswordRequest, req.body);
    return updatePasswordWithOtp(sql, body.email, body.code, body.newPassword);
  });

  return app;
}
