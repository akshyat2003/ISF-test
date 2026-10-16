// Typed HTTP client for the Startup Jathara API, shared by the website, console and mobile app.
import type {
  AccountStatus,
  ActivationIssued,
  CriteriaSet,
  CriteriaSetCreate,
  DecisionCorrection,
  DecisionCorrectionRequest,
  RankingRunDetail,
  RankingRunSummary,
  AdminUser,
  AdminUserList,
  DecisionRequest,
  ImportBatch,
  ImportBatchDetail,
  ImportCategory,
  MeResponse,
  Role,
  InternalStatus,
  ManageApplication,
  ManageApplicationList,
  MyApplicationsResponse,
  NotificationItem,
  Problem,
  PublicEdition,
  RegistrationRequest,
  RegistrationResponse,
  ReleaseResponse,
  SignInIdentifier,
  EvaluationDetail,
  EvaluationReview,
  EvaluationSave,
  JuryHome,
  JuryOverview,
  JuryStartupProfile,
  MyVolunteer,
  MyVolunteerAssignment,
  PitchSlotRequest,
  PitchSlotUpdate,
  ReassignRequest,
  Rubric,
  RubricCreate,
  VolunteerAssignmentItem,
  VolunteerOverview,
  VolunteerRun,
  VolunteerTargetRef,
  ContentCreate,
  ContentOverview,
  ContentUpdate,
  ContentVersion,
  DocumentLink,
  DocumentUpload,
  EventInfo,
  ManagedContentItem,
  ManagedDocument,
  ManagedNotice,
  NoticeAudience,
  NoticeCreate,
  NoticeEdit,
  NoticePreview,
  NoticesOverview,
  PushTokenRegister,
  EmergencyResponse,
  HelpDeskConversation,
  HelpDeskReply,
  MyTicket,
  RequesterMatch,
  SupportAlerts,
  SupportContactLog,
  SupportNote,
  SupportPolicy,
  SupportQueue,
  SupportStatusUpdate,
  SupportTicketCreate,
  SupportTicketDetail,
} from "@sj/contracts";

export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail ?? problem.title);
  }
  get status() { return this.problem.status; }
  get code() { return this.problem.code; }
  /** Field errors keyed by dotted path, e.g. "startup.name". */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.problem.errors ?? []).map((e) => [e.path, e.message]));
  }
}

export type ApiOptions = { baseUrl: string; getToken: () => string | null | Promise<string | null> };

export function createApi({ baseUrl, getToken }: ApiOptions) {
  async function req<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
    const token = await getToken();
    let res: Response;
    try {
      res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
        method,
        headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError({ type: "about:blank", title: "Cannot reach the server", status: 0, code: "network_error", detail: "Check your connection and try again." });
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new ApiError(data ?? { type: "about:blank", title: res.statusText, status: res.status, code: "http_error" });
    return data as T;
  }

  const base = baseUrl.replace(/\/$/, "");
  return {
    /** Turns an API-relative link (development document storage) into an absolute URL; absolute links pass through. */
    absoluteUrl: (url: string) => (url.startsWith("/") ? `${base}${url}` : url),
    editions: () => req<PublicEdition[]>("GET", "/v1/public/editions"),
    // Event information (Phase 7): the same published data for the website (public) and the app (participants).
    publicEvent: (year: number) => req<EventInfo>("GET", `/v1/public/editions/${year}/event`),
    publicDocumentLink: (year: number, id: string) => req<DocumentLink>("GET", `/v1/public/editions/${year}/documents/${id}/link`),
    event: (year: number) => req<EventInfo>("GET", `/v1/editions/${year}/event`),
    documentLink: (year: number, id: string) => req<DocumentLink>("GET", `/v1/editions/${year}/documents/${id}/link`),
    markRead: (id: string) => req<{ read: true }>("POST", `/v1/me/notifications/${id}/read`),
    registerPushToken: (body: PushTokenRegister) => req<{ registered: true }>("POST", "/v1/me/push-tokens", body),
    removePushToken: (token: string) => req<{ removed: boolean }>("DELETE", "/v1/me/push-tokens", { token }),
    // Phase 8: the emergency control (contacts first; never rate-limited), the Help Desk and own requests.
    reportEmergency: (year: number, clientRequestId: string, message?: string) =>
      req<EmergencyResponse>("POST", `/v1/editions/${year}/emergency`, { clientRequestId, ...(message ? { message } : {}) }),
    helpdesk: {
      ask: (edition: number, text: string, conversationId?: string) =>
        req<HelpDeskReply>("POST", "/v1/helpdesk/messages", { edition, text, ...(conversationId ? { conversationId } : {}) }),
      conversation: (edition: number) => req<HelpDeskConversation>("GET", `/v1/helpdesk/conversation?edition=${edition}`),
      askPerson: (edition: number, conversationId: string, note?: string) =>
        req<HelpDeskReply>("POST", `/v1/helpdesk/conversations/${conversationId}/escalate?edition=${edition}`, note ? { note } : {}),
    },
    myTickets: (edition?: number) => req<MyTicket[]>("GET", `/v1/me/tickets${edition ? `?edition=${edition}` : ""}`),
    createTicket: (edition: number, subject: string, description?: string) =>
      req<MyTicket>("POST", "/v1/me/tickets", { edition, subject, ...(description ? { description } : {}) }),
    addTicketNote: (id: string, text: string) => req<MyTicket>("POST", `/v1/me/tickets/${id}/notes`, { text }),
    /** Development sign-in only (refused in production): by email or by mobile number. */
    devSession: (id: string | SignInIdentifier, mfa = false) =>
      req<{ token: string }>("POST", "/v1/dev/session", { ...(typeof id === "string" ? { email: id } : id), mfa }),
    register: (body: RegistrationRequest) => req<RegistrationResponse>("POST", "/v1/me/registrations", body),
    myApplications: () => req<MyApplicationsResponse>("GET", "/v1/me/applications"),
    /** TBD-37: withdraw one year's application (until that year's event starts). */
    withdrawApplication: (id: string) => req<MyApplicationsResponse>("POST", `/v1/me/applications/${id}/withdraw`),
    myNotifications: () => req<NotificationItem[]>("GET", "/v1/me/notifications"),
    me: () => req<MeResponse>("GET", "/v1/me"),
    activate: (token: string) => req<MeResponse>("POST", "/v1/me/activation", { token }),
    admin: {
      users: (f: { q?: string; role?: Role; status?: AccountStatus; limit?: number; offset?: number } = {}) => {
        const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
        return req<AdminUserList>("GET", `/v1/admin/users${p.size ? `?${p}` : ""}`);
      },
      user: (id: string) => req<AdminUser>("GET", `/v1/admin/users/${id}`),
      grantRole: (id: string, role: Role, edition: number | null = null) => req<AdminUser>("POST", `/v1/admin/users/${id}/roles`, { role, edition }),
      revokeRole: (id: string, grantId: string) => req<AdminUser>("DELETE", `/v1/admin/users/${id}/roles/${grantId}`),
      deactivate: (id: string) => req<AdminUser>("POST", `/v1/admin/users/${id}/deactivate`),
      reactivate: (id: string) => req<AdminUser>("POST", `/v1/admin/users/${id}/reactivate`),
      issueActivation: (id: string) => req<ActivationIssued>("POST", `/v1/admin/users/${id}/activation`),
      imports: () => req<ImportBatch[]>("GET", "/v1/admin/imports"),
      importBatch: (id: string) => req<ImportBatchDetail>("GET", `/v1/admin/imports/${id}`),
      previewImport: (body: { category: ImportCategory; edition: number; fileName: string; csv: string }) =>
        req<ImportBatchDetail>("POST", "/v1/admin/imports", body),
      commitImport: (id: string, excludeRows: number[] = []) => req<ImportBatchDetail>("POST", `/v1/admin/imports/${id}/commit`, { excludeRows }),
      discardImport: (id: string) => req<ImportBatch>("POST", `/v1/admin/imports/${id}/discard`),
    },
    manage: {
      list: (year: number, status?: InternalStatus) =>
        req<ManageApplicationList>("GET", `/v1/manage/editions/${year}/applications${status ? `?status=${status}` : ""}`),
      get: (id: string) => req<ManageApplication>("GET", `/v1/manage/applications/${id}`),
      decide: (id: string, body: DecisionRequest) => req<ManageApplication>("PUT", `/v1/manage/applications/${id}/decision`, body),
      withdraw: (id: string) => req<ManageApplication>("DELETE", `/v1/manage/applications/${id}/decision`),
      /** `confirmOverLimit`: explicit confirmation to release above the selection limit (TBD-19). */
      release: (year: number, applicationIds?: string[], opts: { confirmOverLimit?: boolean } = {}) =>
        req<ReleaseResponse>("POST", `/v1/manage/editions/${year}/decisions/release`, {
          ...(applicationIds ? { applicationIds } : {}),
          ...(opts.confirmOverLimit ? { confirmOverLimit: true } : {}),
        }),
      setLimit: (year: number, limit: number | null) =>
        req<{ edition: number; selectionLimit: number | null }>("PUT", `/v1/manage/editions/${year}/selection-limit`, { limit }),
      // AI ranking (Phase 5)
      criteriaSets: (year: number) => req<CriteriaSet[]>("GET", `/v1/manage/editions/${year}/criteria-sets`),
      createCriteriaSet: (year: number, body: CriteriaSetCreate) => req<CriteriaSet>("POST", `/v1/manage/editions/${year}/criteria-sets`, body),
      approveCriteriaSet: (id: string) => req<CriteriaSet>("POST", `/v1/manage/criteria-sets/${id}/approve`),
      runs: (year: number) => req<RankingRunSummary[]>("GET", `/v1/manage/editions/${year}/ranking-runs`),
      startRun: (year: number, criteriaSetId: string) => req<RankingRunSummary>("POST", `/v1/manage/editions/${year}/ranking-runs`, { criteriaSetId }),
      run: (id: string) => req<RankingRunDetail>("GET", `/v1/manage/ranking-runs/${id}`),
      setCutLine: (id: string, cutLine: number | null) => req<RankingRunDetail>("PUT", `/v1/manage/ranking-runs/${id}/cut-line`, { cutLine }),
      // Decision corrections (TBD-37)
      corrections: (year: number, status?: DecisionCorrection["status"]) =>
        req<DecisionCorrection[]>("GET", `/v1/manage/editions/${year}/corrections${status ? `?status=${status}` : ""}`),
      requestCorrection: (id: string, body: DecisionCorrectionRequest) => req<ManageApplication>("POST", `/v1/manage/applications/${id}/corrections`, body),
      approveCorrection: (id: string, note?: string) => req<ManageApplication>("POST", `/v1/manage/corrections/${id}/approve`, note ? { note } : {}),
      rejectCorrection: (id: string, note?: string) => req<ManageApplication>("POST", `/v1/manage/corrections/${id}/reject`, note ? { note } : {}),
      cancelCorrection: (id: string) => req<ManageApplication>("POST", `/v1/manage/corrections/${id}/cancel`),
      // Jury evaluation (Phase 6). Decision support only: separate from AI ranking and selection decisions.
      jury: (year: number) => req<JuryOverview>("GET", `/v1/manage/editions/${year}/jury`),
      createRubric: (year: number, body: RubricCreate) => req<Rubric>("POST", `/v1/manage/editions/${year}/rubrics`, body),
      approveRubric: (id: string) => req<Rubric>("POST", `/v1/manage/rubrics/${id}/approve`),
      assignJury: (year: number, juryUserId: string, startupId: string) =>
        req<JuryOverview>("POST", `/v1/manage/editions/${year}/jury-assignments`, { juryUserId, startupId }),
      unassignJury: (id: string) => req<JuryOverview>("DELETE", `/v1/manage/jury-assignments/${id}`),
      createSlot: (year: number, body: PitchSlotRequest) => req<JuryOverview>("POST", `/v1/manage/editions/${year}/pitch-slots`, body),
      updateSlot: (id: string, body: PitchSlotUpdate) => req<JuryOverview>("PUT", `/v1/manage/pitch-slots/${id}`, body),
      deleteSlot: (id: string) => req<JuryOverview>("DELETE", `/v1/manage/pitch-slots/${id}`),
      startPitch: (id: string) => req<JuryOverview>("POST", `/v1/manage/pitch-slots/${id}/start`),
      finishPitch: (id: string) => req<JuryOverview>("POST", `/v1/manage/pitch-slots/${id}/finish`),
      evaluations: (year: number) => req<EvaluationReview>("GET", `/v1/manage/editions/${year}/evaluations`),
      reopenEvaluation: (id: string, reason: string) => req<EvaluationDetail>("POST", `/v1/manage/evaluations/${id}/reopen`, { reason }),
      // Volunteer assignment (Phase 6)
      volunteers: (year: number) => req<VolunteerOverview>("GET", `/v1/manage/editions/${year}/volunteers`),
      generateVolunteerRun: (year: number) => req<VolunteerRun>("POST", `/v1/manage/editions/${year}/volunteer-runs`),
      volunteerRun: (id: string) => req<VolunteerRun>("GET", `/v1/manage/volunteer-runs/${id}`),
      approveVolunteerRun: (id: string) => req<VolunteerRun>("POST", `/v1/manage/volunteer-runs/${id}/approve`),
      discardVolunteerRun: (id: string) => req<VolunteerRun>("POST", `/v1/manage/volunteer-runs/${id}/discard`),
      assignVolunteer: (year: number, volunteerUserId: string, target: VolunteerTargetRef, reason: string) =>
        req<VolunteerAssignmentItem>("POST", `/v1/manage/editions/${year}/volunteer-assignments`, { volunteerUserId, target, reason }),
      reassignVolunteer: (id: string, body: ReassignRequest) => req<VolunteerAssignmentItem>("POST", `/v1/manage/volunteer-assignments/${id}/reassign`, body),
      closeVolunteerAssignment: (id: string, reason: string) =>
        req<VolunteerAssignmentItem>("POST", `/v1/manage/volunteer-assignments/${id}/close`, { reason }),
      // Event information and documents (Phase 7; TBD-24 decides who may edit which type)
      content: (year: number) => req<ContentOverview>("GET", `/v1/manage/editions/${year}/content`),
      createContent: (year: number, body: ContentCreate) => req<ManagedContentItem>("POST", `/v1/manage/editions/${year}/content`, body),
      updateContent: (id: string, body: ContentUpdate) => req<ManagedContentItem>("PUT", `/v1/manage/content/${id}`, body),
      publishContent: (id: string, changeSummary: string) => req<ManagedContentItem>("POST", `/v1/manage/content/${id}/publish`, { changeSummary }),
      discardDraft: (id: string) => req<ManagedContentItem>("POST", `/v1/manage/content/${id}/discard-draft`),
      archiveContent: (id: string, reason: string) => req<ManagedContentItem>("POST", `/v1/manage/content/${id}/archive`, { reason }),
      contentVersions: (id: string) => req<ContentVersion[]>("GET", `/v1/manage/content/${id}/versions`),
      uploadDocument: (year: number, body: DocumentUpload) => req<ManagedDocument>("POST", `/v1/manage/editions/${year}/documents`, body),
      archiveDocument: (id: string, reason: string) => req<{ archived: true }>("POST", `/v1/manage/documents/${id}/archive`, { reason }),
      documentLink: (id: string) => req<DocumentLink>("GET", `/v1/manage/documents/${id}/link`),
      // Notices (Phase 7)
      notices: (year: number) => req<NoticesOverview>("GET", `/v1/manage/editions/${year}/notices`),
      previewNotice: (year: number, audience: NoticeAudience) => req<NoticePreview>("POST", `/v1/manage/editions/${year}/notices/preview`, { audience }),
      publishNotice: (year: number, body: NoticeCreate) => req<ManagedNotice>("POST", `/v1/manage/editions/${year}/notices`, body),
      editNotice: (id: string, body: NoticeEdit) => req<ManagedNotice>("PUT", `/v1/manage/notices/${id}`, body),
      withdrawNotice: (id: string, reason: string) => req<ManagedNotice>("POST", `/v1/manage/notices/${id}/withdraw`, { reason }),
      createNoticeGroup: (year: number, name: string, description?: string) =>
        req<NoticesOverview>("POST", `/v1/manage/editions/${year}/notice-groups`, { name, ...(description ? { description } : {}) }),
      addGroupMembers: (id: string, userIds: string[]) => req<NoticesOverview>("POST", `/v1/manage/notice-groups/${id}/members`, { userIds }),
      removeGroupMember: (id: string, userId: string) => req<NoticesOverview>("DELETE", `/v1/manage/notice-groups/${id}/members/${userId}`),
    },
    /** Jury members: their own assignments, the current pitch, and their own scores. */
    jury: {
      home: (year: number) => req<JuryHome>("GET", `/v1/editions/${year}/jury`),
      startup: (year: number, startupId: string) => req<JuryStartupProfile>("GET", `/v1/editions/${year}/jury/startups/${startupId}`),
      saveDraft: (year: number, startupId: string, body: EvaluationSave) =>
        req<JuryHome>("PUT", `/v1/editions/${year}/jury/startups/${startupId}/evaluation`, body),
      submit: (year: number, startupId: string, body: EvaluationSave) =>
        req<JuryHome>("POST", `/v1/editions/${year}/jury/startups/${startupId}/evaluation/submit`, body),
    },
    /** Customer Support dashboard (support staff; Management read-only). */
    support: {
      queue: (o: { edition?: number; status?: string; mine?: boolean } = {}) => {
        const q = new URLSearchParams();
        if (o.edition) q.set("edition", String(o.edition));
        if (o.status) q.set("status", o.status);
        if (o.mine) q.set("mine", "true");
        return req<SupportQueue>("GET", `/v1/support/tickets${q.size ? `?${q}` : ""}`);
      },
      ticket: (id: string) => req<SupportTicketDetail>("GET", `/v1/support/tickets/${id}`),
      create: (body: SupportTicketCreate) => req<SupportTicketDetail>("POST", "/v1/support/tickets", body),
      acknowledge: (id: string) => req<SupportTicketDetail>("POST", `/v1/support/tickets/${id}/acknowledge`),
      status: (id: string, body: SupportStatusUpdate) => req<SupportTicketDetail>("POST", `/v1/support/tickets/${id}/status`, body),
      assign: (id: string, assigneeId: string | null) => req<SupportTicketDetail>("POST", `/v1/support/tickets/${id}/assign`, { assigneeId }),
      note: (id: string, body: SupportNote) => req<SupportTicketDetail>("POST", `/v1/support/tickets/${id}/notes`, body),
      contact: (id: string, body: SupportContactLog) => req<SupportTicketDetail>("POST", `/v1/support/tickets/${id}/contact`, body),
      escalate: (id: string, reason: string) => req<SupportTicketDetail>("POST", `/v1/support/tickets/${id}/escalate`, { reason }),
      raisePriority: (id: string) => req<SupportTicketDetail>("POST", `/v1/support/tickets/${id}/priority`),
      findRequester: (q: string) => req<RequesterMatch[]>("GET", `/v1/support/requesters?q=${encodeURIComponent(q)}`),
      alerts: () => req<SupportAlerts>("GET", "/v1/support/alerts"),
      alertSeen: (id: string) => req<{ seen: true }>("POST", `/v1/support/alerts/${id}/seen`),
      policy: (year: number) => req<SupportPolicy>("GET", `/v1/support/editions/${year}/policy`),
      setPolicy: (year: number, body: SupportPolicy) => req<SupportPolicy>("PUT", `/v1/manage/editions/${year}/support-policy`, body),
    },
    volunteer: {
      myAssignment: (year: number) => req<MyVolunteerAssignment>("GET", `/v1/editions/${year}/volunteer/assignment`),
      myVolunteer: (year: number) => req<MyVolunteer>("GET", `/v1/editions/${year}/me/volunteer`),
    },
  };
}
export type Api = ReturnType<typeof createApi>;

const IST = "Asia/Kolkata";
/** All times are shown in IST (PRD NFR-12). */
export function formatIst(iso: string, withTime = true): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: IST, dateStyle: "medium", ...(withTime ? { timeStyle: "short" } : {}) }).format(new Date(iso));
}

/** "18–20 December 2026" from ISO dates (same month and year assumed when they match). */
export function formatDateRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00+05:30`), e = new Date(`${end}T00:00:00+05:30`);
  const day = (d: Date) => new Intl.DateTimeFormat("en-IN", { timeZone: IST, day: "numeric" }).format(d);
  const monthYear = new Intl.DateTimeFormat("en-IN", { timeZone: IST, month: "long", year: "numeric" }).format(e);
  return `${day(s)}–${day(e)} ${monthYear}`;
}
