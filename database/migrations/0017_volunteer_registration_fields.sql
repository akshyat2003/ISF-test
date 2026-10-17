-- 0017_volunteer_registration_fields.sql: add volunteer registration fields (redg_no, roll_no, organisation_name)
alter table user_accounts add column if not exists redg_no text;
alter table user_accounts add column if not exists roll_no text;
alter table user_accounts add column if not exists organisation_name text;
