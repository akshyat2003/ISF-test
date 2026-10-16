// Standalone worker process: `pnpm --filter @sj/api start:worker` (or `dev:worker`). Runs the same background loops
// as the API's in-process workers, for hosts that throttle CPU between HTTP requests.
import { loadConfig } from "./config.js";
import { createSql } from "./db/client.js";
import { rankingModelFrom, sendersFrom, startWorkers } from "./workers.js";

const config = loadConfig();
const sql = createSql(config.databaseUrl, { max: 4 });
const log = { info: (m: string) => console.log(m), error: (o: unknown, m: string) => console.error(m, o) };
const clock = () => config.devNow ?? new Date();
const stop = startWorkers({ sql, model: rankingModelFrom(config), senders: await sendersFrom(config, log.info), clock, log,
  pushReceipts: config.push.provider === "expo" ? { accessToken: config.push.expoAccessToken } : undefined });
const close = async () => {
  await stop();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on("SIGTERM", close);
process.on("SIGINT", close);
log.info("worker started");
