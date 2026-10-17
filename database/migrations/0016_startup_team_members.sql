-- 0016_startup_team_members.sql: Add leader photo, structured team members JSON, and startup_team_members table

alter table user_accounts add column if not exists photo_url text;
alter table user_accounts add column if not exists team_members_json jsonb;

create table if not exists startup_team_members (
  id uuid primary key default gen_random_uuid(),
  startup_id uuid references startups(id) on delete cascade,
  leader_user_id uuid references user_accounts(id) on delete cascade,
  name text not null,
  photo_url text,
  phone text not null,
  email text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_startup_team_members_leader on startup_team_members(leader_user_id);
create index if not exists idx_startup_team_members_startup on startup_team_members(startup_id);
