import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import {
  ACCOUNT_STATUSES, ActivationRequest, CorrectionReviewRequest, CriteriaSetCreate, CutLineRequest, DecisionCorrectionRequest, DecisionRequest,
  DevSessionRequest, normaliseMobile, IMPORT_CATEGORIES, ImportCommitRequest, ImportPreviewRequest, INTERNAL_STATUSES,
  RegistrationRequest, ReleaseRequest, ROLES, RoleGrantRequest, SelectionLimitRequest, StartRankingRunRequest,
  CloseAssignmentRequest, EvaluationSave, JuryAssignmentRequest, ManualAssignRequest, PitchSlotRequest, PitchSlotUpdate, ReassignRequest,
  ReopenRequest, RubricCreate,
  ArchiveRequest, ContentCreate, ContentUpdate, DocumentUpload, GroupMembersAdd, NoticeAudience, NoticeCreate, NoticeEdit, NoticeGroupCreate,
  NoticeWithdraw, PublishRequest, PushTokenRegister,
  EmergencyReport, HelpDeskAsk, HelpDeskEscalate, RequesterTicketCreate, SupportAssign, SupportContactLog, SupportEscalate, SupportNote,
  SupportPolicy, SupportStatusUpdate, SupportTicketCreate, TICKET_STATUSES, TicketText,
} from "@sj/contracts";
import { z } from "zod";
import type { Config } from "./config.js";
import type { Sql } from "./db/client.js";
import { getUser, grantRole, issueActivation, listUsers, me, redeemActivation, revokeRole, setStatus } from "./modules/accounts/service.js";
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
    origin: config.corsOrigins,
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
  app.get("/healthz", async () => {
    await sql`select 1`;
    return { ok: true };
  });

  // ---------------------------------------------------------------- public
  app.get("/v1/public/editions", async () => (await listEditions(sql)).map((e) => toPublic(e, now())));

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
      return { token: await issueDevToken(config.devAuthSecret!, body.email ?? null, { aal: body.mfa ? "aal2" : "aal1", ...(phone ? { phone } : {}) }) };
    });
  }

  return app;
}
