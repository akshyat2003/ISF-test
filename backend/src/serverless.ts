import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createSql } from "./db/client.js";
import { devIdentityResolver, devVerifier, supabaseIdentityResolver, supabaseVerifier } from "./platform/auth.js";
import type { FastifyInstance } from "fastify";

let cachedApp: FastifyInstance | null = null;

export async function getFastifyServerlessApp(): Promise<FastifyInstance> {
  if (cachedApp) return cachedApp;
  const config = loadConfig();
  const sql = createSql(config.databaseUrl);
  const supabase = config.authMode === "supabase";
  const verifier = supabase ? supabaseVerifier(config.supabaseUrl!) : devVerifier(config.devAuthSecret!);
  const identity = supabase
    ? supabaseIdentityResolver({ supabaseUrl: config.supabaseUrl!, serviceRoleKey: config.supabaseServiceRoleKey! })
    : devIdentityResolver;
  cachedApp = await buildApp({ config, sql, verifier, identity, logger: false });
  await cachedApp.ready();
  return cachedApp;
}
