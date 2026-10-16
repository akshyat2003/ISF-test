// Background work in the same codebase as the API (ADR-001): AI ranking runs, the email/SMS/push outbox and (Phase 8)
// the support acknowledgement sweep that re-alerts and escalates unacknowledged tickets. The domain
// tables are the queues (ranking_runs, notifications), claimed with FOR UPDATE SKIP LOCKED, so several worker
// processes can run safely side by side.
import type { Config } from "./config.js";
import type { Sql } from "./db/client.js";
import { checkPushReceipts, dispatchOutbox, expoPushSender, logSender, msg91Sender, smtpSender, type ExpoPushOptions, type MessageSender } from "./modules/notifications/outbox.js";
import { stubModel, vertexModel, type RankingModel } from "./modules/ranking/model.js";
import { processNextRankingRun } from "./modules/ranking/worker.js";
import { sweepSupport } from "./modules/support/sweep.js";

export function rankingModelFrom(config: Config): RankingModel {
  return config.ranking.provider === "vertex" ? vertexModel(config.ranking.vertex!) : stubModel();
}

export async function sendersFrom(config: Config, log: (m: string) => void): Promise<MessageSender[]> {
  const out: MessageSender[] = [];
  if (config.email.provider === "smtp") out.push(await smtpSender(config.email.smtp!));
  if (config.email.provider === "log") out.push(logSender("email", log));
  if (config.sms.provider === "msg91") out.push(msg91Sender(config.sms.msg91!));
  if (config.sms.provider === "log") out.push(logSender("sms", log));
  if (config.push.provider === "expo") out.push(expoPushSender({ accessToken: config.push.expoAccessToken }));
  if (config.push.provider === "log") out.push(logSender("push", log));
  return out;
}

/** Which channels can deliver automatically (decides whether activation codes are sent or handed over, TBD-13). */
export const automatedChannels = (config: Config) => ({ email: config.email.provider !== "none", sms: config.sms.provider !== "none" });

/**
 * True when this database user can switch to the restricted ranking role (migrations 0008, 0009). Without it, every
 * ranking run would stay queued, so the workers say so loudly at start-up instead of failing quietly on each tick.
 */
export async function rankingRoleUsable(sql: Sql): Promise<boolean> {
  try {
    await sql.begin(async (tx) => { await tx`set local role sj_ranking_worker`; });
    return true;
  } catch {
    return false;
  }
}

export function startWorkers(o: {
  sql: Sql; model: RankingModel; senders: MessageSender[]; clock: () => Date; log: { info(m: string): void; error(o: unknown, m: string): void };
  intervalMs?: number;
  /** Set when push goes through Expo: receipts are checked about once a minute. */
  pushReceipts?: ExpoPushOptions;
}): () => Promise<void> {
  let stopped = false;
  let busy: Promise<void> | null = null;
  let lastReceipts = 0;
  void rankingRoleUsable(o.sql).then((ok) => {
    if (!ok) o.log.error({}, "ranking worker cannot SET ROLE sj_ranking_worker: ranking runs will stay queued. Run the migrations (0009) as the API's database user.");
  });
  const tick = async () => {
    try {
      while (!stopped && (await processNextRankingRun(o.sql, o.model, o.clock))) o.log.info("ranking run processed");
      if (!stopped) {
        const r = await dispatchOutbox(o.sql, o.senders, o.clock());
        if (r.sent || r.failed || r.retrying) o.log.info(`outbox: ${r.sent} sent, ${r.retrying} retrying, ${r.failed} failed`);
      }
      if (!stopped) {
        const s = await sweepSupport(o.sql, o.clock());
        if (s.escalated || s.reminders || s.overdue) o.log.info(`support sweep: ${s.escalated} escalated, ${s.reminders} re-alerted, ${s.overdue} overdue`);
      }
      if (!stopped && o.pushReceipts && Date.now() - lastReceipts > 60_000) {
        lastReceipts = Date.now();
        const rc = await checkPushReceipts(o.sql, o.pushReceipts, o.clock());
        if (rc.checked) o.log.info(`push receipts: ${rc.checked} checked, ${rc.failed} failed`);
      }
    } catch (err) {
      o.log.error({ err }, "background worker tick failed");
    }
  };
  const timer = setInterval(() => { if (!busy) busy = tick().finally(() => { busy = null; }); }, o.intervalMs ?? 3000);
  return async () => {
    stopped = true;
    clearInterval(timer);
    await busy;
  };
}
