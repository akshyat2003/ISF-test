import { createSql } from "../src/db/client.js";

const url =
  process.env.DATABASE_URL ||
  "postgresql://postgres.wdeslbtyyeqpjdgnaieg:n0fE3G5tjwyXTt5C@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require";

const sql = createSql(url, { max: 2 });

async function run() {
  console.log("Applying columns to user_accounts table...");
  await sql`alter table user_accounts add column if not exists category text`;
  await sql`alter table user_accounts add column if not exists team_name text`;
  await sql`alter table user_accounts add column if not exists team_members text`;
  await sql`alter table user_accounts add column if not exists domain text`;
  await sql`alter table user_accounts add column if not exists alt_mobile text`;
  await sql`alter table user_accounts add column if not exists city text`;
  await sql`alter table user_accounts add column if not exists state text`;
  await sql`alter table user_accounts add column if not exists country text default 'India'`;
  await sql`alter table user_accounts add column if not exists linkedin_url text`;
  console.log("SUCCESS: All registration profile columns added!");
  await sql.end({ timeout: 5 });
}

run().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
