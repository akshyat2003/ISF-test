import { PRIVACY_NOTICE_VERSION } from "@sj/contracts";
import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().default(4000),
  AUTH_MODE: z.enum(["dev", "supabase"]).default("dev"),
  DEV_AUTH_SECRET: z.string().min(32).optional(),
  SUPABASE_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  // Server-side secret used only to read authoritative user records (email/phone confirmation). Never expose to clients.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional().or(z.literal("").transform(() => undefined)),
  // Staff MFA (FR-IAM-11). Defaults to on in production and may not be turned off there (checked in loadConfig).
  REQUIRE_STAFF_MFA: z.enum(["true", "false"]).optional().or(z.literal("").transform(() => undefined)),   // empty = unset (.env.example)
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:3001"),
  LOG_LEVEL: z.string().default("info"),
  REGISTRATION_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  // Activation codes are single-use and time-limited (FR-IAM-10). 72 hours is the recommended validity (TBD-13,
  // docs/DECISIONS.md), awaiting organiser approval; it stays configurable.
  ACTIVATION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(72),
  ACTIVATION_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  // Explicit sign-off that every item in docs/LAUNCH_CHECKLIST.md is complete. Required to start in production.
  LAUNCH_APPROVED: z.enum(["true", "false"]).optional().or(z.literal("").transform(() => undefined)),   // empty = unset (.env.example)
  // Background workers (ranking runs, email/SMS outbox) in this process. Run `pnpm --filter @sj/api start:worker` as a
  // separate service instead and set this to false where the host throttles CPU between requests (Cloud Run).
  RUN_WORKERS: z.enum(["true", "false"]).default("true"),
  // Development only: pin the API's clock (ISO date-time), e.g. to exercise the post-deadline ranking flow locally.
  DEV_NOW: z.string().datetime({ offset: true }).optional().or(z.literal("").transform(() => undefined)),
  // Public website, used in links inside result messages.
  PUBLIC_WEB_URL: z.string().url().default("http://localhost:3000"),
  // ---- AI ranking (TBD-35). Separate configuration from the Help Desk (FR-RNK-12). `stub` is NOT an AI and is
  // refused in production.
  RANKING_PROVIDER: z.enum(["stub", "vertex"]).default("stub"),
  RANKING_VERTEX_PROJECT: z.string().optional(),
  RANKING_VERTEX_LOCATION: z.string().default("asia-south1"),
  RANKING_VERTEX_MODEL: z.string().optional(),
  RANKING_VERTEX_ACCESS_TOKEN: z.string().optional().or(z.literal("").transform(() => undefined)),
  // FR-RNK-12: a service account used only for ranking (impersonated by the runtime identity); recommended in production.
  RANKING_VERTEX_SERVICE_ACCOUNT: z.string().email().optional().or(z.literal("").transform(() => undefined)),
  // ---- Email/SMS outbox (TBD-13, TBD-14, TBD-35). `none` keeps messages queued; `log` is development only.
  NOTIFY_EMAIL_PROVIDER: z.enum(["none", "log", "smtp"]).default("none"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  NOTIFY_EMAIL_FROM: z.string().optional(),
  NOTIFY_SMS_PROVIDER: z.enum(["none", "log", "msg91"]).default("none"),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_TEMPLATE_RESULT: z.string().optional(),
  MSG91_TEMPLATE_CORRECTION: z.string().optional(),
  MSG91_TEMPLATE_ACTIVATION: z.string().optional(),
  MSG91_TEMPLATE_ASSIGNMENT: z.string().optional(),
  // Phase 7: push notifications through the Expo push service (TBD-52) and document storage (TBD-51).
  PUSH_PROVIDER: z.enum(["none", "log", "expo"]).default("none"),
  EXPO_ACCESS_TOKEN: z.string().optional().or(z.literal("").transform(() => undefined)),
  STORAGE_PROVIDER: z.enum(["database", "supabase"]).default("database"),
  STORAGE_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,62}$/).default("event-documents"),
  // Signs the short-lived document links of the database storage adapter. Random per process when unset.
  FILE_LINK_SECRET: z.string().min(32).optional().or(z.literal("").transform(() => undefined)),
  // ---- Phase 8: AI Help Desk (TBD-35, TBD-54). Separate configuration and credentials from ranking (FR-HD-20).
  // `stub` is NOT an AI (development only, refused in production); `none` answers with official links and offers a person.
  HELPDESK_PROVIDER: z.enum(["none", "stub", "vertex"]).default("stub"),
  HELPDESK_VERTEX_PROJECT: z.string().optional(),
  HELPDESK_VERTEX_LOCATION: z.string().default("asia-south1"),
  HELPDESK_VERTEX_MODEL: z.string().optional(),
  HELPDESK_VERTEX_ACCESS_TOKEN: z.string().optional().or(z.literal("").transform(() => undefined)),
  HELPDESK_VERTEX_SERVICE_ACCOUNT: z.string().email().optional().or(z.literal("").transform(() => undefined)),
  // Questions per minute per signed-in user (SEC-05). The emergency control is never rate-limited.
  HELPDESK_RATE_LIMIT: z.coerce.number().int().positive().default(20),
});

export type Config = {
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  port: number;
  authMode: "dev" | "supabase";
  devAuthSecret?: string;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  requireStaffMfa: boolean;
  corsOrigins: string[];
  logLevel: string;
  registrationRateLimit: number;
  activationTtlHours: number;
  activationRateLimit: number;
  runWorkers: boolean;
  devNow?: Date;
  publicWebUrl: string;
  ranking: { provider: "stub" | "vertex"; vertex?: { project: string; location: string; model: string; accessToken?: string; serviceAccount?: string } };
  email: { provider: "none" | "log" | "smtp"; smtp?: { host: string; port: number; user?: string; pass?: string; from: string } };
  sms: { provider: "none" | "log" | "msg91"; msg91?: { authKey: string; templates: Record<string, string | undefined> } };
  push: { provider: "none" | "log" | "expo"; expoAccessToken?: string };
  storage: { provider: "database" | "supabase"; bucket: string; fileLinkSecret?: string };
  helpdesk: {
    provider: "none" | "stub" | "vertex";
    vertex?: { project: string; location: string; model: string; accessToken?: string; serviceAccount?: string };
    rateLimit: number;
  };
};

/**
 * Fail-closed launch gate: in production the API refuses to start until the launch checks are complete
 * (docs/LAUNCH_CHECKLIST.md). Each unmet item is listed so the operator knows exactly what is missing.
 */
export function productionBlockers(e: z.output<typeof Env>, privacyNoticeVersion = PRIVACY_NOTICE_VERSION): string[] {
  const blockers: string[] = [];
  if (e.AUTH_MODE !== "supabase") blockers.push("AUTH_MODE must be supabase (development sign-in is never allowed in production)");
  if (e.REQUIRE_STAFF_MFA === "false") blockers.push("REQUIRE_STAFF_MFA=false is not allowed: staff roles must use MFA (FR-IAM-11)");
  const origins = e.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  if (!origins.length || origins.some((o) => !o.startsWith("https://") || /localhost|127\.0\.0\.1/.test(o))) {
    blockers.push("CORS_ORIGINS must list only the production https:// origins");
  }
  if (privacyNoticeVersion.startsWith("draft")) {
    blockers.push(`the privacy notice is still a draft (${privacyNoticeVersion}); publish the approved text and version first (TBD-32)`);
  }
  if (e.RANKING_PROVIDER !== "vertex") blockers.push("RANKING_PROVIDER must be vertex: the stub is not an AI and is for development only (TBD-35)");
  if (e.NOTIFY_EMAIL_PROVIDER === "log" || e.NOTIFY_SMS_PROVIDER === "log") {
    blockers.push("NOTIFY_EMAIL_PROVIDER / NOTIFY_SMS_PROVIDER=log is for development only: it reports messages as sent without sending them");
  }
  if (e.PUSH_PROVIDER === "log") blockers.push("PUSH_PROVIDER=log is for development only: it reports push messages as sent without sending them");
  if (e.STORAGE_PROVIDER !== "supabase") blockers.push("STORAGE_PROVIDER must be supabase: the database adapter is for development only (TBD-51)");
  if (e.HELPDESK_PROVIDER !== "vertex") {
    blockers.push("HELPDESK_PROVIDER must be vertex: the stub is not an AI and `none` gives only fallback answers (TBD-35, TBD-54)");
  }
  if (e.DEV_NOW) blockers.push("DEV_NOW must not be set in production");
  if (e.LAUNCH_APPROVED !== "true") {
    blockers.push("LAUNCH_APPROVED=true is not set: complete and sign off docs/LAUNCH_CHECKLIST.md (live Supabase staging tests, approved privacy text, remaining launch checks)");
  }
  return blockers;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, opts: { privacyNoticeVersion?: string } = {}): Config {
  const e = Env.parse(env);
  if (e.NODE_ENV === "production") {
    const blockers = productionBlockers(e, opts.privacyNoticeVersion);
    if (blockers.length) throw new Error(`Production start refused. Launch checks incomplete:\n- ${blockers.join("\n- ")}`);
  }
  if (e.AUTH_MODE === "dev") {
    if (e.NODE_ENV === "production") throw new Error("AUTH_MODE=dev is not allowed when NODE_ENV=production");
    if (!e.DEV_AUTH_SECRET) throw new Error("DEV_AUTH_SECRET (>= 32 chars) is required when AUTH_MODE=dev");
  }
  const production = e.NODE_ENV === "production";
  if (production && e.REQUIRE_STAFF_MFA === "false") {
    throw new Error("REQUIRE_STAFF_MFA=false is not allowed when NODE_ENV=production: staff roles must use MFA (FR-IAM-11)");
  }
  const requireStaffMfa = e.REQUIRE_STAFF_MFA ? e.REQUIRE_STAFF_MFA === "true" : production;
  if (e.AUTH_MODE === "supabase" && (!e.SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when AUTH_MODE=supabase");
  }
  if (e.DEV_NOW && (production || e.AUTH_MODE !== "dev")) throw new Error("DEV_NOW is allowed only with AUTH_MODE=dev outside production");
  if (e.RANKING_PROVIDER === "vertex" && (!e.RANKING_VERTEX_PROJECT || !e.RANKING_VERTEX_MODEL)) {
    throw new Error("RANKING_VERTEX_PROJECT and RANKING_VERTEX_MODEL are required when RANKING_PROVIDER=vertex");
  }
  if (e.HELPDESK_PROVIDER === "vertex" && (!e.HELPDESK_VERTEX_PROJECT || !e.HELPDESK_VERTEX_MODEL)) {
    throw new Error("HELPDESK_VERTEX_PROJECT and HELPDESK_VERTEX_MODEL are required when HELPDESK_PROVIDER=vertex");
  }
  if (e.NOTIFY_EMAIL_PROVIDER === "smtp" && (!e.SMTP_HOST || !e.NOTIFY_EMAIL_FROM)) {
    throw new Error("SMTP_HOST and NOTIFY_EMAIL_FROM are required when NOTIFY_EMAIL_PROVIDER=smtp");
  }
  if (e.STORAGE_PROVIDER === "supabase" && (!e.SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when STORAGE_PROVIDER=supabase");
  }
  if (e.NOTIFY_SMS_PROVIDER === "msg91" && !e.MSG91_AUTH_KEY) throw new Error("MSG91_AUTH_KEY is required when NOTIFY_SMS_PROVIDER=msg91");
  return {
    nodeEnv: e.NODE_ENV,
    databaseUrl: e.DATABASE_URL,
    port: e.PORT,
    authMode: e.AUTH_MODE,
    devAuthSecret: e.DEV_AUTH_SECRET,
    supabaseUrl: e.SUPABASE_URL,
    supabaseServiceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
    requireStaffMfa,
    corsOrigins: e.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    logLevel: e.LOG_LEVEL,
    registrationRateLimit: e.REGISTRATION_RATE_LIMIT,
    activationTtlHours: e.ACTIVATION_TTL_HOURS,
    activationRateLimit: e.ACTIVATION_RATE_LIMIT,
    runWorkers: e.RUN_WORKERS === "true",
    devNow: e.DEV_NOW ? new Date(e.DEV_NOW) : undefined,
    publicWebUrl: e.PUBLIC_WEB_URL.replace(/\/$/, ""),
    ranking: {
      provider: e.RANKING_PROVIDER,
      vertex: e.RANKING_PROVIDER === "vertex"
        ? {
            project: e.RANKING_VERTEX_PROJECT!, location: e.RANKING_VERTEX_LOCATION, model: e.RANKING_VERTEX_MODEL!,
            accessToken: e.RANKING_VERTEX_ACCESS_TOKEN, serviceAccount: e.RANKING_VERTEX_SERVICE_ACCOUNT,
          }
        : undefined,
    },
    email: {
      provider: e.NOTIFY_EMAIL_PROVIDER,
      smtp: e.NOTIFY_EMAIL_PROVIDER === "smtp"
        ? { host: e.SMTP_HOST!, port: e.SMTP_PORT, user: e.SMTP_USER, pass: e.SMTP_PASS, from: e.NOTIFY_EMAIL_FROM! }
        : undefined,
    },
    sms: {
      provider: e.NOTIFY_SMS_PROVIDER,
      msg91: e.NOTIFY_SMS_PROVIDER === "msg91"
        ? { authKey: e.MSG91_AUTH_KEY!, templates: {
            selection_result: e.MSG91_TEMPLATE_RESULT, decision_corrected: e.MSG91_TEMPLATE_CORRECTION, activation: e.MSG91_TEMPLATE_ACTIVATION,
            volunteer_assigned: e.MSG91_TEMPLATE_ASSIGNMENT, volunteer_for_you: e.MSG91_TEMPLATE_ASSIGNMENT,
            volunteer_assignment_ended: e.MSG91_TEMPLATE_ASSIGNMENT, volunteer_removed: e.MSG91_TEMPLATE_ASSIGNMENT,
          } }
        : undefined,
    },
    push: { provider: e.PUSH_PROVIDER, expoAccessToken: e.EXPO_ACCESS_TOKEN },
    storage: { provider: e.STORAGE_PROVIDER, bucket: e.STORAGE_BUCKET, fileLinkSecret: e.FILE_LINK_SECRET },
    helpdesk: {
      provider: e.HELPDESK_PROVIDER,
      vertex: e.HELPDESK_PROVIDER === "vertex"
        ? {
            project: e.HELPDESK_VERTEX_PROJECT!, location: e.HELPDESK_VERTEX_LOCATION, model: e.HELPDESK_VERTEX_MODEL!,
            accessToken: e.HELPDESK_VERTEX_ACCESS_TOKEN, serviceAccount: e.HELPDESK_VERTEX_SERVICE_ACCOUNT,
          }
        : undefined,
      rateLimit: e.HELPDESK_RATE_LIMIT,
    },
  };
}
