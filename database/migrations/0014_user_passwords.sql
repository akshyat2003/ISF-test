-- 0014_user_passwords.sql: Add password_hash column to user_accounts for password updates
alter table user_accounts add column if not exists password_hash text;

-- Seed default password (Udbhav@2026) for the 3 admins if not set
-- Format: salt:scrypt_hash_64_bytes
-- Udbhav@2026 hash with salt 4e5f6a7b8c9d0e1f
update user_accounts
set password_hash = '4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b:a479ffceb11dc8a264a7c06eb6ff1067b0b2e887e4119d5c3453715c0e7fe7c231e679ec6914589255474dbe8cb7979ea7fbf1832049d115e5804fc9a9572b9a'
where lower(email) in ('sarangeeamartya@gmail.com', 'arushkumar450@gmail.com', 'akshatrajpati@gmail.com')
  and password_hash is null;
