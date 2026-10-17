-- 0015_registration_profiles.sql: Support all attendee and applicant registration categories
-- Categories: Startup Founder & Innovators, Volunteers, Student Innovators, Investors & VCs, Corporate Delegates, Mentors, Ecosystem Observers, Management
alter table user_accounts add column if not exists category text;
alter table user_accounts add column if not exists team_name text;
alter table user_accounts add column if not exists team_members text;
alter table user_accounts add column if not exists domain text;
alter table user_accounts add column if not exists alt_mobile text;
alter table user_accounts add column if not exists city text;
alter table user_accounts add column if not exists state text;
alter table user_accounts add column if not exists country text default 'India';
alter table user_accounts add column if not exists linkedin_url text;
