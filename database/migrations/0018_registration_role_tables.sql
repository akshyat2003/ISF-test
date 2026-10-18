-- 0018_registration_role_tables.sql: Dedicated tables for registration profiles & team members
-- 1. startup_team_leaders
-- 2. volunteers
-- 3. student_innovators
-- 4. student_team_members
-- 5. startup_team_members (add user_id reference)

-- 1. Startup Team Leaders
create table if not exists startup_team_leaders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_accounts(id) on delete cascade,
  startup_id uuid references startups(id) on delete set null,
  team_name text not null,
  full_name text not null,
  email text not null,
  mobile text,
  alt_mobile text,
  domain text,
  city text,
  state text,
  country text default 'India',
  linkedin_url text,
  photo_url text,
  edition_id smallint default 2026,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_startup_team_leaders_user unique (user_id)
);

create index if not exists idx_startup_team_leaders_email on startup_team_leaders(lower(email));
create index if not exists idx_startup_team_leaders_startup on startup_team_leaders(startup_id);
alter table startup_team_leaders enable row level security;

-- 2. Volunteers
create table if not exists volunteers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_accounts(id) on delete cascade,
  full_name text not null,
  email text not null,
  mobile text not null,
  alt_mobile text not null,
  organisation_name text not null,
  redg_no text not null,
  roll_no text not null,
  city text not null,
  state text not null,
  country text not null default 'India',
  linkedin_url text,
  photo_url text,
  edition_id smallint default 2026,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_volunteers_user unique (user_id)
);

create index if not exists idx_volunteers_email on volunteers(lower(email));
create index if not exists idx_volunteers_redg_no on volunteers(redg_no);
alter table volunteers enable row level security;

-- 3. Student Innovators
create table if not exists student_innovators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_accounts(id) on delete cascade,
  startup_id uuid references startups(id) on delete set null,
  team_name text not null,
  full_name text not null,
  email text not null,
  mobile text not null,
  alt_mobile text not null,
  domain text not null,
  city text not null,
  state text not null,
  country text not null default 'India',
  linkedin_url text,
  photo_url text,
  edition_id smallint default 2026,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_student_innovators_user unique (user_id)
);

create index if not exists idx_student_innovators_email on student_innovators(lower(email));
create index if not exists idx_student_innovators_startup on student_innovators(startup_id);
alter table student_innovators enable row level security;

-- 4. Student Team Members
create table if not exists student_team_members (
  id uuid primary key default gen_random_uuid(),
  student_innovator_id uuid references student_innovators(id) on delete cascade,
  leader_user_id uuid references user_accounts(id) on delete cascade,
  user_id uuid references user_accounts(id) on delete cascade,
  team_name text,
  name text not null,
  photo_url text,
  phone text not null,
  email text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_student_team_members_leader on student_team_members(leader_user_id);
create index if not exists idx_student_team_members_innovator on student_team_members(student_innovator_id);
create index if not exists idx_student_team_members_user on student_team_members(user_id);
alter table student_team_members enable row level security;

-- 5. Startup Team Members: link to user_accounts
alter table startup_team_members add column if not exists user_id uuid references user_accounts(id) on delete cascade;
create index if not exists idx_startup_team_members_user on startup_team_members(user_id);
