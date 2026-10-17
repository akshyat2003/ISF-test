-- 0013_seed_admins.sql: Pre-seed administrator accounts for Udbhav Console
insert into user_accounts (email, full_name, status, auth_subject)
values
  ('sarangeeamartya@gmail.com', 'Amartya Sarangee', 'active', 'dev|sarangeeamartya@gmail.com'),
  ('arushkumar450@gmail.com', 'Arush Kumar', 'active', 'dev|arushkumar450@gmail.com'),
  ('akshatrajpati@gmail.com', 'Akshat Rajpati', 'active', 'dev|akshatrajpati@gmail.com')
on conflict (lower(email)) where email is not null do update
  set status = 'active', full_name = excluded.full_name, auth_subject = coalesce(user_accounts.auth_subject, excluded.auth_subject);

-- Grant Admin & Management roles to all three accounts
insert into role_grants (user_id, role)
select u.id, 'admin'
from user_accounts u
where lower(u.email) in ('sarangeeamartya@gmail.com', 'arushkumar450@gmail.com', 'akshatrajpati@gmail.com')
  and not exists (
    select 1 from role_grants rg
    where rg.user_id = u.id and rg.role = 'admin' and rg.revoked_at is null
  );

insert into role_grants (user_id, role)
select u.id, 'management'
from user_accounts u
where lower(u.email) in ('sarangeeamartya@gmail.com', 'arushkumar450@gmail.com', 'akshatrajpati@gmail.com')
  and not exists (
    select 1 from role_grants rg
    where rg.user_id = u.id and rg.role = 'management' and rg.revoked_at is null
  );

-- Grant Edition 2026 access
insert into edition_access (user_id, edition_id, source)
select u.id, 2026, 'predefined'
from user_accounts u
where lower(u.email) in ('sarangeeamartya@gmail.com', 'arushkumar450@gmail.com', 'akshatrajpati@gmail.com')
on conflict (user_id, edition_id) do nothing;
