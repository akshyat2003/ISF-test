import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createSql } from "./db/client.js";
import { devIdentityResolver, devVerifier, supabaseIdentityResolver, supabaseVerifier } from "./platform/auth.js";
import { rankingModelFrom, sendersFrom, startWorkers } from "./workers.js";

const config = loadConfig();
const sql = createSql(config.databaseUrl);
const supabase = config.authMode === "supabase";
const verifier = supabase ? supabaseVerifier(config.supabaseUrl!) : devVerifier(config.devAuthSecret!);
const identity = supabase
  ? supabaseIdentityResolver({ supabaseUrl: config.supabaseUrl!, serviceRoleKey: config.supabaseServiceRoleKey! })
  : devIdentityResolver;
// DEV_NOW pins the clock for local testing only (refused outside AUTH_MODE=dev and in production).
const clock = () => config.devNow ?? new Date();
const app = await buildApp({ config, sql, verifier, identity, clock });
const stopWorkers = config.runWorkers
  ? startWorkers({ sql, model: rankingModelFrom(config), senders: await sendersFrom(config, (m) => app.log.info(m)), clock, log: app.log,
      pushReceipts: config.push.provider === "expo" ? { accessToken: config.push.expoAccessToken } : undefined })
  : async () => {};

const close = async () => {
  await stopWorkers();
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on("SIGTERM", close);
process.on("SIGINT", close);

await app.listen({ port: config.port, host: "0.0.0.0" });
