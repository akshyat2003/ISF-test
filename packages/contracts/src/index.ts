// Shared API contracts (Zod schemas + types) for the API, website, console and mobile app.
// Keep this a single file with no relative imports so every consumer (Node, Next.js, Expo) can load it as source.
import { z } from "zod";

// ---------------------------------------------------------------- common
export const EDITION_YEARS = [2026, 2027] as const;
export type EditionYear = (typeof EDITION_YEARS)[number];

export const ROLES = [
  "admin",
  "management",
  "startup_team_leader",
  "startup_team_member",
  "jury_member",
  "volunteer",
  "delegate",
  "customer_support",
] as const;
export type Role = (typeof ROLES)[number];

/** RFC 9457 problem details returned for every error. `code` is stable and safe to switch on. */
export type Problem = {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  errors?: { path: string; message: string }[];
  [k: string]: unknown;
};

/** Normalise an Indian 10-digit mobile or an international number to E.164; returns null if invalid. */
export function normaliseMobile(input: string): string | null {
  const s = input.replace(/[\s\-().]/g, "");
  if (/^[6-9]\d{9}$/.test(s)) return `+91${s}`;
  if (/^0[6-9]\d{9}$/.test(s)) return `+91${s.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(s)) return `+${s}`;
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  return null;
}

// ---------------------------------------------------------------- application form (edition configuration, TBD-39)
/** One question on the application form. Stored per edition in the database (migration 0007), never in client code. */
export const FormQuestion = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().min(1).max(300),
  help: z.string().max(300).optional(),
  minLength: z.number().int().min(0).max(5000),
  maxLength: z.number().int().min(1).max(5000),
});
export type FormQuestion = z.infer<typeof FormQuestion>;

export const ApplicationForm = z.object({ version: z.string().min(1).max(40), questions: z.array(FormQuestion).max(30) });
export type ApplicationForm = z.infer<typeof ApplicationForm>;

/**
 * The questions an applicant must answer for the chosen editions: the union by key. A key asked by several editions is
 * answered once and must satisfy every edition's limits.
 */
export function mergeQuestions(forms: ApplicationForm[]): FormQuestion[] {
  const byKey = new Map<string, FormQuestion>();
  for (const q of forms.flatMap((f) => f.questions)) {
    const prev = byKey.get(q.key);
    byKey.set(q.key, prev
      ? { ...prev, minLength: Math.max(prev.minLength, q.minLength), maxLength: Math.min(prev.maxLength, q.maxLength) }
      : q);
  }
  return [...byKey.values()];
}

/** Field errors (paths `formAnswers.<key>`) for answers checked against the questions; unknown keys are rejected. */
export function checkFormAnswers(questions: FormQuestion[], answers: Record<string, string>): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  const known = new Set(questions.map((q) => q.key));
  for (const k of Object.keys(answers)) if (!known.has(k)) issues.push({ path: `formAnswers.${k}`, message: "This question is not on the form" });
  for (const q of questions) {
    const v = (answers[q.key] ?? "").trim();
    if (v.length < Math.max(q.minLength, 1)) issues.push({ path: `formAnswers.${q.key}`, message: `Answer this question (at least ${Math.max(q.minLength, 1)} characters)` });
    else if (v.length > q.maxLength) issues.push({ path: `formAnswers.${q.key}`, message: `Use at most ${q.maxLength} characters` });
  }
  return issues;
}

// ---------------------------------------------------------------- public editions
export const PublicEdition = z.object({
  year: z.number().int(),
  name: z.string(),
  preEventOn: z.string().nullable(),
  eventStartsOn: z.string().nullable(),
  eventEndsOn: z.string().nullable(),
  registration: z.object({
    open: z.boolean(),
    closesAt: z.string().nullable(),
    /** false until the organisers confirm the cut-off in writing (TBD-11: 23:59:59 IST recommended, docs/DECISIONS.md). */
    closesAtConfirmed: z.boolean(),
  }),
  applicationForm: ApplicationForm,
});
export type PublicEdition = z.infer<typeof PublicEdition>;

// ---------------------------------------------------------------- registration (PRD §6, FR-REG-*)
export const YearOption = z.enum(["2026", "2027", "both"]);
export type YearOption = z.infer<typeof YearOption>;

export function yearsFor(option: YearOption): EditionYear[] {
  return option === "both" ? [2026, 2027] : [Number(option) as EditionYear];
}

/** The privacy notice version shown at registration. Draft text (docs/PRIVACY_NOTICE_DRAFT.md) awaits legal approval (TBD-32). */
export const PRIVACY_NOTICE_VERSION = "draft-2026-10-15";

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

/**
 * Registration form (TBD-39, docs/DECISIONS.md): fixed core fields plus `formAnswers`, the text answers to the edition's
 * configured questions (`PublicEdition.applicationForm`). The API checks answers against that configuration and rejects
 * unknown keys. No uploads and no links beyond the optional website.
 */
export const RegistrationRequest = z.object({
  yearOption: YearOption,
  startup: z.object({
    name: trimmed(2, 200),
    description: trimmed(20, 5000),
    website: z.string().trim().url().max(300).optional().or(z.literal("").transform(() => undefined)),
    city: trimmed(1, 100).optional(),
    state: trimmed(1, 100).optional(),
  }),
  leader: z.object({
    fullName: trimmed(1, 200),
    mobile: z
      .string()
      .trim()
      .transform((v, ctx) => {
        const n = normaliseMobile(v);
        if (!n) {
          ctx.addIssue({ code: "custom", message: "Enter a valid mobile number" });
          return z.NEVER;
        }
        return n;
      }),
  }),
  formAnswers: z.record(z.string().max(64), z.string().max(5000)).optional(),
  privacyNoticeAccepted: z.literal(true, { message: "You must accept the privacy notice" }),
  /** TBD-45: the platform is for adults; the registering leader confirms they are 18 or older. No date of birth is collected. */
  adultDeclaration: z.literal(true, { message: "You must confirm that you are 18 or older" }),
});
export type RegistrationRequest = z.input<typeof RegistrationRequest>;

/**
 * What applicants may see. Internal states and unreleased drafts collapse to "under_review" (FR-SEL-09); AI ranks,
 * scores and explanations are never shown to applicants (TBD-44). "withdrawn" is the applicant's own act (TBD-37).
 */
export const ApplicantStatus = z.enum(["under_review", "selected", "not_selected", "withdrawn"]);
export type ApplicantStatus = z.infer<typeof ApplicantStatus>;

export const INTERNAL_STATUSES = [
  "submitted",
  "under_ai_evaluation",
  "ranked",
  "flagged_manual_review",
  "decision_drafted",
  "selected",
  "not_selected",
  "withdrawn",
] as const;
export type InternalStatus = (typeof INTERNAL_STATUSES)[number];

export function applicantStatus(s: InternalStatus): ApplicantStatus {
  return s === "selected" || s === "not_selected" || s === "withdrawn" ? s : "under_review";
}

export const MyApplication = z.object({
  id: z.string(),
  edition: z.number().int(),
  status: ApplicantStatus,
  submittedAt: z.string(),
  decidedAt: z.string().nullable(),
  /** TBD-37: the applicant may withdraw this year's application until that year's event starts. */
  canWithdraw: z.boolean(),
});
export type MyApplication = z.infer<typeof MyApplication>;

export const MyApplicationsResponse = z.object({
  startup: z.object({ id: z.string(), name: z.string() }).nullable(),
  applications: z.array(MyApplication),
});
export type MyApplicationsResponse = z.infer<typeof MyApplicationsResponse>;

export const RegistrationResponse = MyApplicationsResponse.extend({ startupReused: z.boolean() });
export type RegistrationResponse = z.infer<typeof RegistrationResponse>;

// ---------------------------------------------------------------- management (PRD §7, FR-SEL-*)
export const DecisionRequest = z.object({
  outcome: z.enum(["selected", "not_selected"]),
  reason: z.string().trim().max(2000).optional(),
});
export type DecisionRequest = z.infer<typeof DecisionRequest>;

export const ReleaseRequest = z.object({
  applicationIds: z.array(z.string().uuid()).min(1).max(500).optional(),
  /**
   * TBD-19: a release that would take the edition above its selection limit is refused (409 selection_limit_exceeded)
   * unless the manager explicitly confirms it with this flag. The confirmation is audited.
   */
  confirmOverLimit: z.boolean().optional(),
});
export type ReleaseRequest = z.infer<typeof ReleaseRequest>;

export const SelectionLimitRequest = z.object({ limit: z.number().int().positive().max(10000).nullable() });

// ---------------------------------------------------------------- AI ranking (Phase 5, FR-RNK-*, TBD-01)
/** One evaluation criterion. Scores are integers from `min` to `max`, with one line of guidance per score. */
export const Criterion = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, "Use lower-case letters, digits and underscores"),
    label: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(300),
    weight: z.number().int().min(1).max(100),
    min: z.number().int().min(0).max(10),
    max: z.number().int().min(1).max(10),
    guidance: z.array(z.string().trim().min(1).max(200)).min(2).max(11),
  })
  .refine((c) => c.max > c.min, { message: "max must be greater than min", path: ["max"] })
  .refine((c) => c.guidance.length === c.max - c.min + 1, { message: "Give one line of guidance for every score", path: ["guidance"] });
export type Criterion = z.infer<typeof Criterion>;

/** Management defines the criteria and weights (FR-RNK-01). Weights are whole percentages that add up to 100. */
export const CriteriaList = z
  .array(Criterion)
  .min(1)
  .max(10)
  .superRefine((list, ctx) => {
    const keys = new Set<string>();
    list.forEach((c, i) => {
      if (keys.has(c.key)) ctx.addIssue({ code: "custom", message: "Criterion keys must be unique", path: [i, "key"] });
      keys.add(c.key);
    });
    const sum = list.reduce((a, c) => a + c.weight, 0);
    if (sum !== 100) ctx.addIssue({ code: "custom", message: `Weights must add up to 100 (they add up to ${sum})`, path: [] });
  });

export const CriteriaSetCreate = z.object({ criteria: CriteriaList, note: z.string().trim().max(500).optional() });
export type CriteriaSetCreate = z.input<typeof CriteriaSetCreate>;

export const CriteriaSet = z.object({
  id: z.string(),
  edition: z.number().int(),
  version: z.number().int(),
  criteria: z.array(Criterion),
  note: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
  usedByRuns: z.number().int(),
});
export type CriteriaSet = z.infer<typeof CriteriaSet>;

/**
 * Why an application needs a human look (FR-RNK-09, -13). `possible_prompt_injection` is scored normally but flagged;
 * the others are not ranked at all and go to manual review.
 */
export const RANKING_FLAGS = ["possible_prompt_injection", "missing_data", "ai_output_invalid", "ai_unavailable"] as const;
export type RankingFlag = (typeof RANKING_FLAGS)[number];

export const RankingRunStatus = z.enum(["queued", "running", "completed", "failed"]);
export const RankingRunSummary = z.object({
  id: z.string(),
  edition: z.number().int(),
  criteriaSetId: z.string(),
  criteriaVersion: z.number().int(),
  modelRef: z.string(),
  promptVersion: z.string(),
  status: RankingRunStatus,
  startedBy: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  cutLine: z.number().int().nullable(),
  error: z.string().nullable(),
  counts: z.object({ total: z.number().int(), scored: z.number().int(), flagged: z.number().int(), pending: z.number().int() }),
});
export type RankingRunSummary = z.infer<typeof RankingRunSummary>;

export const CriterionScore = z.object({
  key: z.string(), label: z.string(), score: z.number().int(), min: z.number().int(), max: z.number().int(), explanation: z.string(),
});
export type CriterionScore = z.infer<typeof CriterionScore>;

export const RankingResultItem = z.object({
  applicationId: z.string(),
  startupName: z.string(),
  applicationStatus: z.enum(INTERNAL_STATUSES),
  state: z.enum(["pending", "scored", "flagged"]),
  rank: z.number().int().nullable(),
  totalScore: z.number().nullable(),
  scores: z.array(CriterionScore),
  summary: z.string().nullable(),
  flags: z.array(z.string()),
});
export type RankingResultItem = z.infer<typeof RankingResultItem>;

export const RankingRunDetail = RankingRunSummary.extend({
  criteria: z.array(Criterion),
  selectionLimit: z.number().int().nullable(),
  results: z.array(RankingResultItem),
});
export type RankingRunDetail = z.infer<typeof RankingRunDetail>;

export const StartRankingRunRequest = z.object({ criteriaSetId: z.string().uuid() });
export const CutLineRequest = z.object({ cutLine: z.number().int().positive().max(10000).nullable() });

/**
 * TBD-18: an override is selecting an application ranked outside the top N, or not selecting one inside it. N is the
 * edition's selection limit, or the run's cut line when no limit is set. Without a rank or an N it cannot be decided.
 */
export function overrideOf(outcome: "selected" | "not_selected", rank: number | null, cutLine: number | null): boolean | null {
  if (rank === null || cutLine === null) return null;
  return outcome === "selected" ? rank > cutLine : rank <= cutLine;
}

// ---------------------------------------------------------------- decision corrections (TBD-37)
export const DecisionCorrectionRequest = z.object({
  outcome: z.enum(["selected", "not_selected"]),
  reason: z.string().trim().min(1, "Give the reason for the correction").max(2000),
});
export type DecisionCorrectionRequest = z.infer<typeof DecisionCorrectionRequest>;
export const CorrectionReviewRequest = z.object({ note: z.string().trim().max(2000).optional() });

export const DecisionCorrection = z.object({
  id: z.string(),
  applicationId: z.string(),
  edition: z.number().int(),
  startupName: z.string(),
  fromOutcome: z.enum(["selected", "not_selected"]),
  toOutcome: z.enum(["selected", "not_selected"]),
  reason: z.string(),
  requestedById: z.string(),
  requestedBy: z.string(),
  requestedAt: z.string(),
  status: z.enum(["pending", "applied", "rejected", "cancelled"]),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  reviewNote: z.string().nullable(),
});
export type DecisionCorrection = z.infer<typeof DecisionCorrection>;

export const OutboxStatus = z.object({
  kind: z.string(),
  channel: z.enum(["in_app", "push", "email", "sms", "whatsapp"]),
  status: z.enum(["queued", "sent", "failed", "read"]),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
});
export type OutboxStatus = z.infer<typeof OutboxStatus>;

export const ApplicationAi = z.object({
  runId: z.string(),
  criteriaVersion: z.number().int(),
  state: z.enum(["pending", "scored", "flagged"]),
  rank: z.number().int().nullable(),
  totalScore: z.number().nullable(),
  /** The N used for override detection: the selection limit, or the run's cut line when no limit is set. */
  cutLine: z.number().int().nullable(),
  scores: z.array(CriterionScore),
  summary: z.string().nullable(),
  flags: z.array(z.string()),
});
export type ApplicationAi = z.infer<typeof ApplicationAi>;

export const ManageApplication = z.object({
  id: z.string(),
  edition: z.number().int(),
  status: z.enum(INTERNAL_STATUSES),
  flags: z.array(z.string()),
  submittedAt: z.string(),
  startup: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    website: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
  }),
  leader: z.object({ id: z.string(), fullName: z.string(), email: z.string().nullable(), mobile: z.string().nullable() }),
  otherEditions: z.array(z.object({ edition: z.number().int(), status: z.enum(INTERNAL_STATUSES) })),
  decision: z
    .object({
      outcome: z.enum(["selected", "not_selected"]),
      reason: z.string().nullable(),
      decidedBy: z.string(),
      decidedAt: z.string(),
      releasedAt: z.string().nullable(),
      /** FR-SEL-08 / TBD-18: null when no AI rank or no cut line existed at decision time. */
      isOverride: z.boolean().nullable(),
      aiRankAtDecision: z.number().int().nullable(),
      correctedAt: z.string().nullable(),
    })
    .nullable(),
  formAnswers: z.record(z.string(), z.unknown()),
  /** Version of the edition's application form this application answered (null for applications made before 0007). */
  formVersion: z.string().nullable(),
  withdrawnAt: z.string().nullable(),
  /** Latest completed ranking run's view of this application (Management only; never shown to applicants). */
  ai: ApplicationAi.nullable(),
  /** FR-SEL-03: delivery status of the result messages. */
  notifications: z.array(OutboxStatus),
  corrections: z.array(DecisionCorrection),
});
export type ManageApplication = z.infer<typeof ManageApplication>;

export const ManageApplicationList = z.object({
  edition: z.number().int(),
  counts: z.record(z.string(), z.number()),
  selectionLimit: z.number().int().nullable(),
  /** Selected (released) plus drafted-as-selected. Releasing above the limit needs explicit confirmation (TBD-19). */
  selectedTotal: z.number().int(),
  items: z.array(ManageApplication),
});
export type ManageApplicationList = z.infer<typeof ManageApplicationList>;

export const ReleaseResponse = z.object({
  released: z.number().int(),
  selected: z.number().int(),
  notSelected: z.number().int(),
  warnings: z.array(z.string()),
});
export type ReleaseResponse = z.infer<typeof ReleaseResponse>;

export const NotificationItem = z.object({
  id: z.string(),
  edition: z.number().int().nullable(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});
export type NotificationItem = z.infer<typeof NotificationItem>;

// ---------------------------------------------------------------- my account (all interfaces)
export const ACCOUNT_STATUSES = ["pending_activation", "active", "deactivated"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Who the caller is. Pending accounts get `status` only: no roles or access until activated. */
export const MeResponse = z.object({
  account: z
    .object({ id: z.string(), email: z.string().nullable(), fullName: z.string(), mobile: z.string().nullable(), status: z.enum(ACCOUNT_STATUSES) })
    .nullable(),
  roles: z.array(z.enum(ROLES)),
  editionAccess: z.array(z.number().int()),
  permissions: z.array(z.string()),
  /** True when some of the caller's roles are withheld until they complete multi-factor authentication (aal2). */
  mfaRequired: z.boolean(),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const ActivationRequest = z.object({ token: z.string().trim().min(20).max(200) });
export type ActivationRequest = z.infer<typeof ActivationRequest>;

// ---------------------------------------------------------------- bulk import (PRD §5, FR-IMP-*)
export const IMPORT_CATEGORIES = ["startups", "jury", "volunteers", "delegates"] as const;
export type ImportCategory = (typeof IMPORT_CATEGORIES)[number];

/**
 * CSV column set v1 (TBD-41, docs/DECISIONS.md): recommended format, awaiting the organisers' sign-off on a real sample.
 * Every row: full_name, plus email and/or mobile (both recommended; TBD-12). Startups add startup_name and
 * position (leader | member), plus optional startup details. No password column is ever accepted (FR-IMP-07).
 */
export const IMPORT_COLUMNS: Record<ImportCategory, { required: string[]; optional: string[] }> = {
  startups: { required: ["startup_name", "position", "full_name"], optional: ["email", "mobile", "description", "website", "city", "state"] },
  jury: { required: ["full_name"], optional: ["email", "mobile"] },
  volunteers: { required: ["full_name"], optional: ["email", "mobile"] },
  delegates: { required: ["full_name"], optional: ["email", "mobile"] },
};

export const ImportPreviewRequest = z.object({
  category: z.enum(IMPORT_CATEGORIES),
  edition: z.number().int().min(2026).max(2100),
  fileName: z.string().trim().min(1).max(200),
  /** UTF-8 CSV text with a header row. */
  csv: z.string().min(1).max(2_000_000),
});
export type ImportPreviewRequest = z.infer<typeof ImportPreviewRequest>;

export const ImportIssue = z.object({ field: z.string(), reason: z.string() });
export type ImportIssue = z.infer<typeof ImportIssue>;

export const ImportRow = z.object({
  rowNumber: z.number().int(),
  data: z.record(z.string(), z.string()),
  outcome: z.enum(["valid", "invalid", "duplicate", "created", "linked", "excluded"]),
  action: z.enum(["create", "link"]).nullable(),
  errors: z.array(ImportIssue),
  warnings: z.array(ImportIssue),
});
export type ImportRow = z.infer<typeof ImportRow>;

export const ImportBatch = z.object({
  id: z.string(),
  category: z.enum(IMPORT_CATEGORIES),
  edition: z.number().int(),
  fileName: z.string(),
  fileSha256: z.string(),
  state: z.enum(["previewed", "committed", "discarded"]),
  uploadedBy: z.string(),
  uploadedAt: z.string(),
  committedAt: z.string().nullable(),
  rowCount: z.number().int(),
  errorCount: z.number().int(),
  summary: z.record(z.string(), z.number()),
});
export type ImportBatch = z.infer<typeof ImportBatch>;

export const ImportBatchDetail = ImportBatch.extend({ rows: z.array(ImportRow) });
export type ImportBatchDetail = z.infer<typeof ImportBatchDetail>;

export const ImportCommitRequest = z.object({
  /** Row numbers the Admin chose to leave out of this commit. */
  excludeRows: z.array(z.number().int().positive()).max(10000).optional(),
});
export type ImportCommitRequest = z.infer<typeof ImportCommitRequest>;

// ---------------------------------------------------------------- account administration (FR-IAM-05, -06, -09)
export const AdminUser = z.object({
  id: z.string(),
  email: z.string().nullable(),
  fullName: z.string(),
  mobile: z.string().nullable(),
  status: z.enum(ACCOUNT_STATUSES),
  signInLinked: z.boolean(),
  createdAt: z.string(),
  activatedAt: z.string().nullable(),
  roles: z.array(z.object({ grantId: z.string(), role: z.enum(ROLES), edition: z.number().int().nullable(), grantedAt: z.string() })),
  editionAccess: z.array(z.object({ edition: z.number().int(), source: z.enum(["predefined", "selected"]) })),
  activation: z.object({ issuedAt: z.string(), expiresAt: z.string() }).nullable(),
});
export type AdminUser = z.infer<typeof AdminUser>;

export const AdminUserList = z.object({ total: z.number().int(), items: z.array(AdminUser) });
export type AdminUserList = z.infer<typeof AdminUserList>;

export const RoleGrantRequest = z.object({ role: z.enum(ROLES), edition: z.number().int().min(2026).max(2100).nullable().optional() });
export type RoleGrantRequest = z.infer<typeof RoleGrantRequest>;

export const ActivationIssued = z.object({
  /**
   * Shown once, and only for manual delivery. With automated delivery (TBD-13) the code goes straight to the
   * participant's own email or mobile and the Admin never sees it. Only its hash is stored.
   */
  token: z.string().nullable(),
  expiresAt: z.string(),
  delivery: z.enum(["manual", "email", "sms"]),
});
export type ActivationIssued = z.infer<typeof ActivationIssued>;

// ---------------------------------------------------------------- sign-in identifier (TBD-12: both; SMS once DLT is approved)
export const SIGN_IN_METHODS = ["email", "phone"] as const;
export type SignInMethod = (typeof SIGN_IN_METHODS)[number];
export type SignInIdentifier = { email: string } | { phone: string };

/**
 * Which one-time-code channels an environment offers, from a comma list such as "email,phone".
 * TBD-12 (docs/DECISIONS.md): email and mobile. Deployed environments set the list explicitly: `email` until the
 * DLT-registered SMS sender is live, then `email,phone`. Unset (local development) allows both.
 * Unknown values are ignored; an empty or invalid list falls back to email only.
 */
export function parseSignInMethods(value: string | undefined | null): SignInMethod[] {
  if (value === undefined || value === null || value.trim() === "") return ["email", "phone"];
  const picked = SIGN_IN_METHODS.filter((m) => value.split(",").map((s) => s.trim().toLowerCase()).includes(m));
  return picked.length ? picked : ["email"];
}

export const DevSessionRequest = z
  .object({
    email: z.string().trim().toLowerCase().email().optional(),
    phone: z.string().trim().optional(),
    mfa: z.boolean().optional(),
  })
  .refine((b) => !!b.email !== !!b.phone, { message: "Provide either an email or a mobile number" });
export type DevSessionRequest = z.input<typeof DevSessionRequest>;

// ---------------------------------------------------------------- post-sign-in redirects (open-redirect protection)
/** Internal destinations each web interface may return to after sign-in or MFA. Anything else falls back. */
export const WEB_RETURN_PATHS = ["/", "/register", "/status", "/activate", "/privacy"] as const;
export const CONSOLE_RETURN_PATHS = ["/", "/applications", "/ranking", "/jury", "/volunteers", "/content", "/notices", "/support", "/users", "/imports"] as const;

const REDIRECT_BASE = "https://internal.invalid";

/**
 * Returns `next` only if it is a same-origin path on the allow-list (exact path or a sub-path of an entry);
 * otherwise `fallback`. Rejects absolute and scheme URLs, protocol-relative `//host`, backslashes, control
 * characters and anything that resolves to another origin, so a crafted sign-in or MFA link cannot send a
 * freshly authenticated user to an external site.
 */
export function safeReturnPath(next: string | null | undefined, allowed: readonly string[], fallback: string): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 512) return fallback;
  // eslint-disable-next-line no-control-regex
  if (!next.startsWith("/") || next.startsWith("//") || /[\\\u0000-\u001F\u007F]/.test(next)) return fallback;
  let url: URL;
  try {
    url = new URL(next, REDIRECT_BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== REDIRECT_BASE) return fallback;
  const path = url.pathname;
  const permitted = allowed.some((p) => (p === "/" ? path === "/" : path === p || path.startsWith(`${p}/`)));
  return permitted ? `${path}${url.search}${url.hash}` : fallback;
}

// ================================================================ Phase 6: jury evaluation (FR-JRY-*; TBD-20, -21, -43)
// Jury scoring is decision support for the event only. It is kept apart from AI ranking and from selection decisions:
// none of these types appears in the application/selection contracts, and no selection rule reads them.

/** One scoring parameter. Weights are relative (a parameter's share is weight / sum of weights). */
export const JuryParameter = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, "Use lower-case letters, digits and underscores"),
    label: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(300),
    weight: z.number().int().min(1).max(100),
    min: z.number().int().min(0).max(100),
    max: z.number().int().min(1).max(100),
  })
  .refine((p) => p.max > p.min, { message: "max must be greater than min", path: ["max"] });
export type JuryParameter = z.infer<typeof JuryParameter>;

export const JuryParameterList = z
  .array(JuryParameter)
  .min(1)
  .max(12)
  .superRefine((list, ctx) => {
    const keys = new Set<string>();
    list.forEach((p, i) => {
      if (keys.has(p.key)) ctx.addIssue({ code: "custom", message: "Parameter keys must be unique", path: [i, "key"] });
      keys.add(p.key);
    });
  });

export const RubricCreate = z.object({
  parameters: JuryParameterList,
  commentsAllowed: z.boolean().default(true),
  note: z.string().trim().max(500).optional(),
});
export type RubricCreate = z.input<typeof RubricCreate>;

export const Rubric = z.object({
  id: z.string(),
  edition: z.number().int(),
  version: z.number().int(),
  parameters: z.array(JuryParameter),
  commentsAllowed: z.boolean(),
  note: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
  usedByEvaluations: z.number().int(),
});
export type Rubric = z.infer<typeof Rubric>;

/** Weighted, range-normalised total from 0 to 100 (2 decimals), computed on the server from the rubric used. */
export function juryTotal(parameters: JuryParameter[], scores: Record<string, number>): number {
  const weights = parameters.reduce((a, p) => a + p.weight, 0);
  const total = parameters.reduce((sum, p) => sum + (p.weight * ((scores[p.key] ?? p.min) - p.min)) / (p.max - p.min), 0);
  return Math.round((total / weights) * 100 * 100) / 100;
}

/**
 * Field errors for jury scores (paths `scores.<key>`): unknown keys rejected, every value an integer within range;
 * with `complete`, every parameter must be scored (submission).
 */
export function checkJuryScores(parameters: JuryParameter[], scores: Record<string, unknown>, opts: { complete: boolean }) {
  const issues: { path: string; message: string }[] = [];
  const known = new Set(parameters.map((p) => p.key));
  for (const k of Object.keys(scores)) if (!known.has(k)) issues.push({ path: `scores.${k}`, message: "Not a parameter of this rubric" });
  for (const p of parameters) {
    const v = scores[p.key];
    if (v === undefined || v === null) {
      if (opts.complete) issues.push({ path: `scores.${p.key}`, message: `Score ${p.label} (${p.min}–${p.max})` });
    } else if (typeof v !== "number" || !Number.isInteger(v) || v < p.min || v > p.max) {
      issues.push({ path: `scores.${p.key}`, message: `Use a whole number from ${p.min} to ${p.max}` });
    }
  }
  return issues;
}

export const JuryAssignmentRequest = z.object({ juryUserId: z.string().uuid(), startupId: z.string().uuid() });
export type JuryAssignmentRequest = z.infer<typeof JuryAssignmentRequest>;

export const PitchSlotRequest = z.object({
  startupId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  venue: z.string().trim().max(200).nullable().optional(),
});
export type PitchSlotRequest = z.input<typeof PitchSlotRequest>;
export const PitchSlotUpdate = z.object({
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  venue: z.string().trim().max(200).nullable().optional(),
});
export type PitchSlotUpdate = z.input<typeof PitchSlotUpdate>;

export const EvaluationSave = z.object({
  scores: z.record(z.string().max(64), z.number()),
  comments: z.string().trim().max(2000).optional(),
});
export type EvaluationSave = z.input<typeof EvaluationSave>;

export const ReopenRequest = z.object({ reason: z.string().trim().min(1, "Give the reason for reopening").max(2000) });

export const PitchSlot = z.object({
  id: z.string(),
  startupId: z.string(),
  startupName: z.string(),
  startsAt: z.string().nullable(),
  venue: z.string().nullable(),
  state: z.enum(["scheduled", "pitching", "done"]),
});
export type PitchSlot = z.infer<typeof PitchSlot>;

export const EvaluationState = z.enum(["draft", "submitted", "reopened"]);

export const JuryOverview = z.object({
  edition: z.number().int(),
  rubrics: z.array(Rubric),
  /** The latest approved rubric version: what jurors score with now. */
  activeRubricId: z.string().nullable(),
  jurors: z.array(z.object({ id: z.string(), fullName: z.string(), status: z.enum(ACCOUNT_STATUSES), assigned: z.number().int() })),
  startups: z.array(z.object({ id: z.string(), name: z.string(), origin: z.enum(["predefined", "applicant"]) })),
  assignments: z.array(z.object({
    id: z.string(), juryUserId: z.string(), juryName: z.string(), startupId: z.string(), startupName: z.string(), createdAt: z.string(),
    evaluation: z.object({ id: z.string(), state: EvaluationState, totalScore: z.number().nullable(), submittedAt: z.string().nullable() }).nullable(),
  })),
  slots: z.array(PitchSlot),
  currentPitch: PitchSlot.nullable(),
});
export type JuryOverview = z.infer<typeof JuryOverview>;

export const EvaluationDetail = z.object({
  id: z.string(),
  assignmentId: z.string(),
  startupId: z.string(),
  startupName: z.string(),
  juryUserId: z.string(),
  juryName: z.string(),
  state: EvaluationState,
  rubricId: z.string(),
  rubricVersion: z.number().int(),
  scores: z.record(z.string(), z.number()),
  comments: z.string().nullable(),
  totalScore: z.number().nullable(),
  submittedAt: z.string().nullable(),
  reopenedAt: z.string().nullable(),
  reopenReason: z.string().nullable(),
});
export type EvaluationDetail = z.infer<typeof EvaluationDetail>;

/** FR-JRY-16: per-startup score summaries for Management, as decision support only. Never a winner (FR-JRY-10). */
export const EvaluationReview = z.object({
  edition: z.number().int(),
  startups: z.array(z.object({
    startupId: z.string(),
    startupName: z.string(),
    assigned: z.number().int(),
    submitted: z.number().int(),
    /** Summaries per rubric version: totals from different versions are never mixed. */
    byRubric: z.array(z.object({
      rubricId: z.string(), version: z.number().int(), count: z.number().int(), averageTotal: z.number(),
      parameters: z.array(z.object({ key: z.string(), label: z.string(), average: z.number(), min: z.number(), max: z.number() })),
    })),
  })),
  evaluations: z.array(EvaluationDetail),
});
export type EvaluationReview = z.infer<typeof EvaluationReview>;

/** What a juror sees for an edition: own assignments, the pitch schedule, the current pitch and own evaluations only. */
export const JuryHome = z.object({
  edition: z.number().int(),
  rubric: z.object({ id: z.string(), version: z.number().int(), parameters: z.array(JuryParameter), commentsAllowed: z.boolean() }).nullable(),
  currentPitch: z.object({ startupId: z.string(), startupName: z.string(), venue: z.string().nullable(), assigned: z.boolean() }).nullable(),
  startups: z.array(z.object({
    startupId: z.string(),
    name: z.string(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    slot: z.object({ startsAt: z.string().nullable(), venue: z.string().nullable(), state: z.enum(["scheduled", "pitching", "done"]) }).nullable(),
    evaluation: z.object({
      state: EvaluationState, scores: z.record(z.string(), z.number()), comments: z.string().nullable(), totalScore: z.number().nullable(),
      submittedAt: z.string().nullable(), rubricVersion: z.number().int(),
    }).nullable(),
  })),
});
export type JuryHome = z.infer<typeof JuryHome>;

/** The authorised startup and founder information a juror may review (FR-JRY-04). No contact details, no AI data. */
export const JuryStartupProfile = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  website: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  origin: z.enum(["predefined", "applicant"]),
  founders: z.array(z.object({ fullName: z.string(), position: z.enum(["leader", "member"]) })),
  answers: z.array(z.object({ question: z.string(), answer: z.string() })),
  assigned: z.boolean(),
});
export type JuryStartupProfile = z.infer<typeof JuryStartupProfile>;

// ================================================================ Phase 6: volunteer assignment (FR-VOL-*; TBD-22, -23)
export const VolunteerTargetRef = z.object({ type: z.enum(["startup", "jury"]), id: z.string().uuid() });
export type VolunteerTargetRef = z.infer<typeof VolunteerTargetRef>;
export const VolunteerTarget = VolunteerTargetRef.extend({ name: z.string() });
export type VolunteerTarget = z.infer<typeof VolunteerTarget>;
export const PersonRef = z.object({ id: z.string(), name: z.string() });

export const VolunteerAssignmentItem = z.object({
  id: z.string(),
  edition: z.number().int(),
  state: z.enum(["draft", "active", "closed"]),
  volunteer: PersonRef,
  target: VolunteerTarget,
  runId: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  reason: z.string().nullable(),
  activatedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  closedBy: z.string().nullable(),
  closeReason: z.string().nullable(),
  replacesId: z.string().nullable(),
  /** FR-NOT-04: delivery status of the messages about this assignment, exactly as recorded. */
  notifications: z.array(z.object({ recipient: z.enum(["volunteer", "target"]), channel: z.string(), status: z.string(), sentAt: z.string().nullable() })),
});
export type VolunteerAssignmentItem = z.infer<typeof VolunteerAssignmentItem>;

export const VolunteerRun = z.object({
  id: z.string(),
  edition: z.number().int(),
  state: z.enum(["draft", "approved", "discarded"]),
  seed: z.string(),
  startedBy: z.string(),
  createdAt: z.string(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  volunteerCount: z.number().int(),
  targetCount: z.number().int(),
  pairs: z.array(VolunteerAssignmentItem),
  /** FR-VOL-06: targets left without a volunteer because there were not enough. Never hidden by doubling up. */
  unassignedTargets: z.array(VolunteerTarget),
  /** FR-VOL-16: volunteers left over when they outnumber the targets. */
  surplusVolunteers: z.array(PersonRef),
});
export type VolunteerRun = z.infer<typeof VolunteerRun>;

export const VolunteerOverview = z.object({
  edition: z.number().int(),
  draftRun: VolunteerRun.nullable(),
  runs: z.array(z.object({ id: z.string(), state: z.enum(["draft", "approved", "discarded"]), createdAt: z.string(), startedBy: z.string(),
    reviewedBy: z.string().nullable(), pairs: z.number().int(), unassignedTargets: z.number().int(), surplusVolunteers: z.number().int() })),
  active: z.array(VolunteerAssignmentItem),
  /** Targets with no open assignment now (TBD-22 pool): what still needs a volunteer. */
  unassignedTargets: z.array(VolunteerTarget),
  freeVolunteers: z.array(PersonRef),
  history: z.array(VolunteerAssignmentItem),
});
export type VolunteerOverview = z.infer<typeof VolunteerOverview>;

const assignmentReason = z.string().trim().min(1, "Give the reason").max(2000);
export const ReassignRequest = z
  .object({ reason: assignmentReason, volunteerUserId: z.string().uuid().optional(), target: VolunteerTargetRef.optional() })
  .refine((r) => r.volunteerUserId || r.target, { message: "Choose a new volunteer, a new target, or both" });
export type ReassignRequest = z.infer<typeof ReassignRequest>;
export const ManualAssignRequest = z.object({ volunteerUserId: z.string().uuid(), target: VolunteerTargetRef, reason: assignmentReason });
export type ManualAssignRequest = z.infer<typeof ManualAssignRequest>;
export const CloseAssignmentRequest = z.object({ reason: assignmentReason });

/** A volunteer's own assignment, with the target's authorised coordination contact (FR-VOL-12, TBD-49). */
export const MyVolunteerAssignment = z.object({
  edition: z.number().int(),
  assignment: z.object({
    target: z.object({ type: z.enum(["startup", "jury"]), name: z.string(), contactName: z.string(), mobile: z.string().nullable() }),
    since: z.string(),
  }).nullable(),
});
export type MyVolunteerAssignment = z.infer<typeof MyVolunteerAssignment>;

/** The volunteer assigned to the caller's startup (leader) or to the caller as a juror (FR-VOL-12, TBD-49). */
export const MyVolunteer = z.object({
  edition: z.number().int(),
  volunteer: z.object({ name: z.string(), mobile: z.string().nullable(), for: z.enum(["startup", "jury"]) }).nullable(),
});
export type MyVolunteer = z.infer<typeof MyVolunteer>;

// ================================================================ Phase 7: event information (FR-EVT-*; TBD-06, -24, -51)
// One official copy of the event information, served to the website and the app alike (FR-EVT-01, -02). Every edit
// is a draft until published; each publish is a new version with editor, time and change summary (FR-EVT-16).

export const CONTENT_TYPES = ["schedule_item", "venue", "meal", "accommodation", "travel", "safety_guideline", "emergency_contact", "page"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];
/** TBD-24: Admin maintains the official source information; Management maintains operational information. */
export const SOURCE_CONTENT_TYPES: readonly ContentType[] = ["safety_guideline", "emergency_contact", "page"];
export const OPERATIONAL_CONTENT_TYPES: readonly ContentType[] = ["schedule_item", "venue", "meal", "accommodation", "travel"];
export const CONTENT_TYPE_LABEL: Record<ContentType, string> = {
  schedule_item: "Schedule", venue: "Venues", meal: "Food", accommodation: "Accommodation", travel: "Travel and transport",
  safety_guideline: "Safety guidelines", emergency_contact: "Emergency contacts", page: "Information pages",
};

/** Who sees an item or document (FR-EVT-17): the public, every participant of the edition, or participants in roles. */
export const CONTENT_AUDIENCES = ["public", "participants", "startup_team_leader", "startup_team_member", "jury_member", "volunteer", "delegate"] as const;
export type ContentAudience = (typeof CONTENT_AUDIENCES)[number];
export const PARTICIPANT_ROLES = ["startup_team_leader", "startup_team_member", "jury_member", "volunteer", "delegate"] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];
export const AUDIENCE_LABEL: Record<ContentAudience, string> = {
  public: "Public (website and app)", participants: "All participants", startup_team_leader: "Startup leaders",
  startup_team_member: "Startup members", jury_member: "Jury members", volunteer: "Volunteers", delegate: "Delegates",
};
export const AudienceList = z.array(z.enum(CONTENT_AUDIENCES)).min(1).max(6)
  .refine((a) => new Set(a).size === a.length, "Each audience once")
  .refine((a) => !(a.includes("public") && a.length > 1) && !(a.includes("participants") && a.length > 1),
    "Public or All participants already include everyone; choose it alone");

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-18");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time like 09:30");
const text = (max: number) => z.string().trim().max(max);
const timeOrder = (b: { startTime?: string | null; endTime?: string | null }) => !b.startTime || !b.endTime || b.endTime > b.startTime;

export const ScheduleBody = z.object({
  day: isoDay, startTime: hhmm.nullish(), endTime: hhmm.nullish(), venue: text(200).nullish(), details: text(2000).nullish(),
  /** Shown as "Tentative" until Management confirms it (TBD-06). */
  tentative: z.boolean().default(false),
  /** Order within a day when times are not set. */
  order: z.number().int().min(0).max(999).default(0),
}).strict().refine(timeOrder, { message: "The end time must be after the start time", path: ["endTime"] });
export const MealBody = z.object({
  day: isoDay, meal: z.enum(["breakfast", "lunch", "dinner", "snacks", "other"]), startTime: hhmm.nullish(), endTime: hhmm.nullish(),
  venue: text(200).nullish(), menu: z.array(text(200).min(1)).max(40).default([]), notes: text(1000).nullish(),
}).strict().refine(timeOrder, { message: "The end time must be after the start time", path: ["endTime"] });
/** OD-03: a static map link only (https), no maps SDK. */
export const VenueBody = z.object({
  address: text(300).nullish(), mapUrl: z.string().url().max(500).refine((u) => u.startsWith("https://"), "Use an https:// link").nullish(),
  notes: text(2000).nullish(),
}).strict();
export const TextBody = z.object({ text: text(8000).min(1, "Write the information"), address: text(300).nullish() }).strict();
export const EmergencyBody = z.object({
  phone: z.string().trim().regex(/^\+?[0-9 -]{3,20}$/, "Use digits, optionally starting with +"), available: text(200).nullish(), notes: text(500).nullish(),
}).strict();

export function contentBodySchema(type: ContentType): z.ZodType<Record<string, unknown>> {
  switch (type) {
    case "schedule_item": return ScheduleBody as never;
    case "meal": return MealBody as never;
    case "venue": return VenueBody as never;
    case "emergency_contact": return EmergencyBody as never;
    default: return TextBody as never;
  }
}

export const ContentCreate = z.object({
  type: z.enum(CONTENT_TYPES), title: z.string().trim().min(1, "Give it a title").max(200), audience: AudienceList, body: z.record(z.string(), z.unknown()),
});
export type ContentCreate = z.infer<typeof ContentCreate>;
export const ContentUpdate = ContentCreate.omit({ type: true });
export type ContentUpdate = z.infer<typeof ContentUpdate>;
export const PublishRequest = z.object({ changeSummary: z.string().trim().min(1, "Say what changed").max(500) });
export const ArchiveRequest = z.object({ reason: z.string().trim().min(1, "Give the reason").max(500) });

export const ContentDraft = z.object({ title: z.string(), body: z.record(z.string(), z.unknown()), audience: z.array(z.enum(CONTENT_AUDIENCES)) });
export const ManagedContentItem = z.object({
  id: z.string(), edition: z.number().int(), type: z.enum(CONTENT_TYPES), state: z.enum(["draft", "published", "archived"]),
  version: z.number().int(),
  /** What users see now (null if never published). */
  live: ContentDraft.nullable(),
  publishedAt: z.string().nullable(),
  changeSummary: z.string().nullable(),
  /** Pending edits, not visible to users until published. */
  draft: ContentDraft.nullable(), draftBy: z.string().nullable(), draftAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  /** Whether the caller may edit this type (TBD-24). */
  canEdit: z.boolean(),
});
export type ManagedContentItem = z.infer<typeof ManagedContentItem>;
export const ContentVersion = z.object({
  version: z.number().int(), title: z.string(), body: z.record(z.string(), z.unknown()), audience: z.array(z.string()),
  changeSummary: z.string().nullable(), publishedBy: z.string().nullable(), publishedAt: z.string(),
});
export type ContentVersion = z.infer<typeof ContentVersion>;

export const DOCUMENT_TYPES = { "application/pdf": "PDF", "image/png": "PNG image", "image/jpeg": "JPEG image" } as const;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DocumentUpload = z.object({
  title: z.string().trim().min(1, "Give it a title").max(200), description: z.string().trim().max(500).optional(),
  audience: AudienceList, fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(Object.keys(DOCUMENT_TYPES) as ["application/pdf", "image/png", "image/jpeg"]),
  /** File content, base64. Checked against the declared type on the server. */
  dataBase64: z.string().min(1).max(Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4 + 4),
  replacesId: z.string().uuid().optional(),
});
export type DocumentUpload = z.infer<typeof DocumentUpload>;
export const EventDocument = z.object({
  id: z.string(), title: z.string(), description: z.string().nullable(), fileName: z.string(), contentType: z.string(),
  sizeBytes: z.number().int(), version: z.number().int(), uploadedAt: z.string(),
});
export type EventDocument = z.infer<typeof EventDocument>;
export const ManagedDocument = EventDocument.extend({
  edition: z.number().int(), audience: z.array(z.enum(CONTENT_AUDIENCES)), uploadedBy: z.string().nullable(),
  replacesId: z.string().nullable(), archivedAt: z.string().nullable(), canEdit: z.boolean(),
});
export type ManagedDocument = z.infer<typeof ManagedDocument>;
/** A short-lived link to one document (SEC-08). Open it at once; it stops working after `expiresAt`. */
export const DocumentLink = z.object({ url: z.string(), expiresAt: z.string() });
export type DocumentLink = z.infer<typeof DocumentLink>;

/** Event days with their official labels (FR-EVT-03, AT-37): 17 Dec 2026 is the pre-event day. */
export function eventDays(e: { preEventOn: string | null; eventStartsOn: string | null; eventEndsOn: string | null }) {
  const first = e.preEventOn ?? e.eventStartsOn;
  if (!first || !e.eventEndsOn) return [] as { date: string; label: string; preEvent: boolean }[];
  const out: { date: string; label: string; preEvent: boolean }[] = [];
  for (let d = new Date(`${first}T00:00:00Z`); d <= new Date(`${e.eventEndsOn}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
    const date = d.toISOString().slice(0, 10);
    out.push({ date, label: dayLabel(date, date === e.preEventOn && e.preEventOn !== e.eventStartsOn), preEvent: date === e.preEventOn && e.preEventOn !== e.eventStartsOn });
  }
  return out;
}
export function dayLabel(date: string, preEvent: boolean): string {
  const d = new Date(`${date}T00:00:00Z`);
  const s = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
  return preEvent ? `${s} · Pre-event day` : s;
}

const PublishedItem = z.object({ id: z.string(), title: z.string(), version: z.number().int(), updatedAt: z.string() });
export const EventInfo = z.object({
  edition: z.object({ year: z.number().int(), name: z.string(), days: z.array(z.object({ date: z.string(), label: z.string(), preEvent: z.boolean() })) }),
  schedule: z.array(z.object({ date: z.string(), label: z.string(), preEvent: z.boolean(),
    items: z.array(PublishedItem.extend({ body: ScheduleBody })), meals: z.array(PublishedItem.extend({ body: MealBody })) })),
  venues: z.array(PublishedItem.extend({ body: VenueBody })),
  accommodation: z.array(PublishedItem.extend({ body: TextBody })),
  travel: z.array(PublishedItem.extend({ body: TextBody })),
  safety: z.array(PublishedItem.extend({ body: TextBody })),
  /** 112 is always first (TBD-07); it is not editable content. */
  emergency: z.array(z.object({ id: z.string().nullable(), title: z.string(), phone: z.string(), available: z.string().nullish(), notes: z.string().nullish() })),
  pages: z.array(PublishedItem.extend({ body: TextBody })),
  documents: z.array(EventDocument),
  /** The most recent publish among what this viewer can see (FR-EVT-16 "last updated"). */
  lastUpdated: z.string().nullable(),
});
export type EventInfo = z.infer<typeof EventInfo>;
export const NATIONAL_EMERGENCY = { title: "National emergency number (police, fire, ambulance)", phone: "112" } as const;

// ================================================================ Phase 7: notices and push (FR-NOT-*; TBD-29, -52)
export const NoticeAudience = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("everyone") }),
  z.object({ kind: z.literal("roles"), roles: z.array(z.enum(PARTICIPANT_ROLES)).min(1).max(5).refine((r) => new Set(r).size === r.length, "Each role once") }),
  z.object({ kind: z.literal("group"), groupId: z.string().uuid() }),
]);
export type NoticeAudience = z.infer<typeof NoticeAudience>;
export const NoticeCreate = z.object({
  title: z.string().trim().min(1, "Give it a title").max(200), body: z.string().trim().min(1, "Write the notice").max(4000),
  audience: NoticeAudience, sendPush: z.boolean().default(false),
});
export type NoticeCreate = z.input<typeof NoticeCreate>;
export const NoticeEdit = z.object({
  title: z.string().trim().min(1).max(200).optional(), body: z.string().trim().min(1).max(4000).optional(),
  reason: z.string().trim().min(1, "Say why you are correcting it").max(500),
}).refine((e) => e.title !== undefined || e.body !== undefined, "Change the title or the text");
export type NoticeEdit = z.infer<typeof NoticeEdit>;
export const NoticeWithdraw = z.object({ reason: z.string().trim().min(1, "Give the reason").max(500) });
export const NoticePreview = z.object({ recipients: z.number().int(), withDevice: z.number().int(), devices: z.number().int() });
export type NoticePreview = z.infer<typeof NoticePreview>;
export const DeliveryCounts = z.object({ queued: z.number().int(), sent: z.number().int(), failed: z.number().int(), cancelled: z.number().int() });
export const ManagedNotice = z.object({
  id: z.string(), edition: z.number().int(), title: z.string(), body: z.string(), audience: NoticeAudience, audienceLabel: z.string(),
  sendPush: z.boolean(), publishedBy: z.string(), publishedAt: z.string(), editedBy: z.string().nullable(), editedAt: z.string().nullable(),
  withdrawnBy: z.string().nullable(), withdrawnAt: z.string().nullable(), withdrawReason: z.string().nullable(),
  recipients: z.number().int(),
  /** FR-NOT-04: in-app = in the inbox (read = opened); push = handed to the push service, which is not proof of delivery. */
  delivery: z.object({ inApp: z.object({ total: z.number().int(), read: z.number().int() }), push: DeliveryCounts }),
});
export type ManagedNotice = z.infer<typeof ManagedNotice>;
export const NoticeGroupCreate = z.object({ name: z.string().trim().min(1, "Name the group").max(100), description: z.string().trim().max(300).optional() });
export const GroupMembersAdd = z.object({ userIds: z.array(z.string().uuid()).min(1).max(500) });
export const ParticipantRef = z.object({ id: z.string(), fullName: z.string(), roles: z.array(z.enum(ROLES)) });
export type ParticipantRef = z.infer<typeof ParticipantRef>;
export const NoticeGroup = z.object({
  id: z.string(), edition: z.number().int(), name: z.string(), description: z.string().nullable(), createdBy: z.string(), createdAt: z.string(),
  members: z.array(ParticipantRef),
});
export type NoticeGroup = z.infer<typeof NoticeGroup>;
export const NoticesOverview = z.object({
  edition: z.number().int(), notices: z.array(ManagedNotice), groups: z.array(NoticeGroup), participants: z.array(ParticipantRef),
});
export type NoticesOverview = z.infer<typeof NoticesOverview>;
export const PushTokenRegister = z.object({
  token: z.string().regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/, "Not an Expo push token"), platform: z.enum(["android", "ios"]),
});
export type PushTokenRegister = z.infer<typeof PushTokenRegister>;

/** The console's view of one edition's event information: everything, drafts included, with edit rights per type. */
export const ContentOverview = z.object({
  edition: z.number().int(),
  days: z.array(z.object({ date: z.string(), label: z.string(), preEvent: z.boolean() })),
  items: z.array(ManagedContentItem),
  documents: z.array(ManagedDocument),
  canEditSource: z.boolean(),
  canEditOperational: z.boolean(),
});
export type ContentOverview = z.infer<typeof ContentOverview>;

// ================================================================ Phase 8: support tickets and emergencies (FR-SUP-*, FR-HD-10/11)
export const TICKET_STATUSES = ["Open", "Acknowledged", "In Progress", "Resolved"] as const;   // DC-08: the four confirmed statuses
export const TicketStatus = z.enum(TICKET_STATUSES);
export type TicketStatus = z.infer<typeof TicketStatus>;
export const TICKET_SOURCES = ["help_desk", "emergency_control", "requester", "support_staff"] as const;
export type TicketSource = (typeof TICKET_SOURCES)[number];
/** Human-friendly ticket reference shown to requesters and staff. */
export const ticketRef = (n: number) => `SJ-${String(n).padStart(6, "0")}`;

/**
 * Acknowledgement windows and re-alert intervals in minutes, per edition (TBD-27). The defaults are the recommendation
 * in docs/DECISIONS.md, awaiting organiser approval.
 */
export const SupportPolicy = z.object({
  emergencyAckMinutes: z.number().int().min(1).max(10080),
  highAckMinutes: z.number().int().min(1).max(10080),
  normalAckMinutes: z.number().int().min(1).max(10080),
  emergencyRealertMinutes: z.number().int().min(1).max(10080),
  highRealertMinutes: z.number().int().min(1).max(10080),
  maxRealerts: z.number().int().min(1).max(100),
}).strict()
  .refine((p) => p.emergencyAckMinutes <= p.highAckMinutes, { message: "Emergencies must be acknowledged no later than high-priority tickets", path: ["emergencyAckMinutes"] })
  .refine((p) => p.highAckMinutes <= p.normalAckMinutes, { message: "High-priority tickets must be acknowledged no later than normal ones", path: ["highAckMinutes"] });
export type SupportPolicy = z.infer<typeof SupportPolicy>;

/** One emergency contact. 112 is always first and is not editable content (TBD-07). */
export const EmergencyContact = z.object({ title: z.string(), phone: z.string(), available: z.string().nullish(), notes: z.string().nullish() });
export type EmergencyContact = z.infer<typeof EmergencyContact>;

/** The app's emergency control (FR-HD-10/11). `clientRequestId` makes retries of the same tap harmless. */
export const EmergencyReport = z.object({
  clientRequestId: z.string().uuid(),
  message: z.string().trim().max(1000).optional(),
});
export type EmergencyReport = z.infer<typeof EmergencyReport>;
export const TicketRef = z.object({ id: z.string(), ref: z.string() });
export type TicketRef = z.infer<typeof TicketRef>;
export const EmergencyResponse = z.object({
  /** Shown at once, 112 first. Never wait for anything else before showing these. */
  contacts: z.array(EmergencyContact),
  /** Null when the alert could not be recorded: the screen then says so and still shows the contacts. */
  ticket: TicketRef.nullable(),
  /** How many support staff (or Management, if no support staff are active) were alerted. */
  alerted: z.number().int(),
  /** The requester already had an open emergency ticket: the new report was added to it and staff re-alerted. */
  reportedAgain: z.boolean(),
});
export type EmergencyResponse = z.infer<typeof EmergencyResponse>;

export const RequesterTicketCreate = z.object({
  edition: z.number().int().min(2026).max(2100),
  subject: z.string().trim().min(1, "Say briefly what you need help with").max(200),
  description: z.string().trim().max(4000).optional(),
});
export type RequesterTicketCreate = z.infer<typeof RequesterTicketCreate>;
export const TicketText = z.object({ text: z.string().trim().min(1, "Write a message").max(2000) });

/** What a requester sees of their own ticket (FR-SUP-15): status and messages meant for them, never internal notes. */
export const MyTicket = z.object({
  id: z.string(), ref: z.string(), edition: z.number().int().nullable(), subject: z.string(), status: TicketStatus,
  priority: z.enum(["normal", "high"]), isEmergency: z.boolean(), createdAt: z.string(), updatedAt: z.string(),
  updates: z.array(z.object({ at: z.string(), kind: z.enum(["created", "status", "reply", "requester_note"]), text: z.string() })),
});
export type MyTicket = z.infer<typeof MyTicket>;

export const SupportTicketSummary = z.object({
  id: z.string(), ref: z.string(), edition: z.number().int().nullable(), subject: z.string(), status: TicketStatus,
  priority: z.enum(["normal", "high"]), isEmergency: z.boolean(), source: z.enum(TICKET_SOURCES).nullable(),
  requesterName: z.string(), assignee: z.object({ id: z.string(), name: z.string() }).nullable(),
  createdAt: z.string(), ackDueAt: z.string().nullable(), acknowledgedAt: z.string().nullable(),
  /** Still Open after its acknowledgement window. */
  overdue: z.boolean(),
  escalation: z.object({ to: z.literal("management"), level: z.number().int(), at: z.string(), reason: z.string(), by: z.string().nullable() }).nullable(),
});
export type SupportTicketSummary = z.infer<typeof SupportTicketSummary>;

export const SupportTicketDetail = SupportTicketSummary.extend({
  description: z.string().nullable(),
  /** FR-SUP-02: the authorised requester details: identity, contact, roles and own startup. Nothing else. */
  requester: z.object({
    id: z.string(), name: z.string(), email: z.string().nullable(), mobile: z.string().nullable(), roles: z.array(z.enum(ROLES)),
    startup: z.string().nullable(),
  }).nullable(),
  contact: z.object({ name: z.string(), phone: z.string().nullable() }).nullable(),
  acknowledgedBy: z.string().nullable(), resolvedBy: z.string().nullable(), resolvedAt: z.string().nullable(), resolutionNote: z.string().nullable(),
  events: z.array(z.object({ id: z.string(), kind: z.string(), actor: z.string().nullable(), at: z.string(), detail: z.record(z.string(), z.unknown()) })),
  /** FR-HD-16: the Help Desk conversation the ticket came from (questions and answers only). */
  transcript: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string(), at: z.string() })).nullable(),
  alerts: z.object({ sent: z.number().int(), seen: z.number().int(), rounds: z.number().int() }),
  canEdit: z.boolean(),
});
export type SupportTicketDetail = z.infer<typeof SupportTicketDetail>;

export const SupportQueue = z.object({
  tickets: z.array(SupportTicketSummary),
  counts: z.object({ open: z.number().int(), unacknowledgedEmergencies: z.number().int(), overdue: z.number().int(), escalated: z.number().int() }),
  staff: z.array(z.object({ id: z.string(), name: z.string() })),
  canEdit: z.boolean(),
});
export type SupportQueue = z.infer<typeof SupportQueue>;

export const SupportStatusUpdate = z.object({
  status: z.enum(["In Progress", "Resolved"]),
  note: z.string().trim().max(4000).optional(),
}).refine((u) => u.status !== "Resolved" || !!u.note?.trim(), { message: "Write the resolution notes", path: ["note"] });
export type SupportStatusUpdate = z.infer<typeof SupportStatusUpdate>;
export const SupportAssign = z.object({ assigneeId: z.string().uuid().nullable() });
export const SupportNote = z.object({ text: z.string().trim().min(1, "Write the note").max(4000), visibility: z.enum(["internal", "requester"]) });
export type SupportNote = z.infer<typeof SupportNote>;
export const SupportContactLog = z.object({
  method: z.enum(["phone", "email", "in_person", "other"]),
  outcome: z.string().trim().min(1, "Say what happened").max(2000),
});
export type SupportContactLog = z.infer<typeof SupportContactLog>;
export const SupportEscalate = z.object({ reason: z.string().trim().min(1, "Give the reason").max(1000) });
export const SupportTicketCreate = z.object({
  edition: z.number().int().min(2026).max(2100),
  subject: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  priority: z.enum(["normal", "high"]).default("normal"),
  isEmergency: z.boolean().default(false),
  requesterId: z.string().uuid().optional(),
  contact: z.object({ name: z.string().trim().min(1).max(120), phone: z.string().trim().regex(/^\+?[0-9 ()-]{3,20}$/, "Use digits").optional() }).optional(),
}).refine((t) => !!t.requesterId !== !!t.contact, { message: "Choose an account or enter the caller's name, not both", path: ["requesterId"] })
  .refine((t) => !t.isEmergency || t.priority === "high", { message: "Emergencies are high priority", path: ["priority"] });
export type SupportTicketCreate = z.input<typeof SupportTicketCreate>;
export const RequesterMatch = z.object({ id: z.string(), name: z.string(), roles: z.array(z.enum(ROLES)) });
export type RequesterMatch = z.infer<typeof RequesterMatch>;

export const SupportAlert = z.object({
  id: z.string(), ticketId: z.string(), ref: z.string(), subject: z.string(), isEmergency: z.boolean(), status: TicketStatus,
  reason: z.enum(["emergency", "high_priority", "reminder", "escalation", "overdue", "no_support_staff", "reported_again"]),
  round: z.number().int(), createdAt: z.string(),
});
export type SupportAlert = z.infer<typeof SupportAlert>;
export const SupportAlerts = z.object({ alerts: z.array(SupportAlert), unacknowledgedEmergencies: z.number().int() });
export type SupportAlerts = z.infer<typeof SupportAlerts>;

// ================================================================ Phase 8: AI Help Desk, mobile app (FR-HD-*)
export const HelpDeskAsk = z.object({
  edition: z.number().int().min(2026).max(2100),
  text: z.string().trim().min(1, "Type a question").max(1000),
  conversationId: z.string().uuid().optional(),
});
export type HelpDeskAsk = z.infer<typeof HelpDeskAsk>;
export const HELPDESK_REPLY_KINDS = ["answer", "not_found", "fallback", "emergency", "escalated", "refused"] as const;
export const HelpDeskMessage = z.object({
  id: z.string(), role: z.enum(["user", "assistant"]), text: z.string(), at: z.string(), kind: z.enum(HELPDESK_REPLY_KINDS).nullable(),
});
export type HelpDeskMessage = z.infer<typeof HelpDeskMessage>;
export const HelpDeskReply = z.object({
  conversationId: z.string(),
  message: HelpDeskMessage,
  /** Official information the answer was grounded in. */
  sources: z.array(z.object({ title: z.string(), section: z.string() })),
  emergency: EmergencyResponse.nullable(),
  ticket: TicketRef.nullable(),
  /** "stub" = development stand-in, not an AI; "none" = no assistant configured (fallback answers only). */
  provider: z.enum(["vertex", "stub", "none"]),
  /** Offer "Ask a person" (creates a ticket with this conversation). */
  canAskPerson: z.boolean(),
});
export type HelpDeskReply = z.infer<typeof HelpDeskReply>;
export const HelpDeskConversation = z.object({ conversationId: z.string().nullable(), messages: z.array(HelpDeskMessage) });
export type HelpDeskConversation = z.infer<typeof HelpDeskConversation>;
export const HelpDeskEscalate = z.object({ note: z.string().trim().max(1000).optional() });
