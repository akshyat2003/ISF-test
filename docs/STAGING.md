# Staging environment

| Item | Value |
|---|---|
| Supabase organisation | **ISF** (free plan) |
| Project | `startup-jathara-staging` · ref `chiafggvergjwliqvlwv` · **Mumbai (ap-south-1)** · created 15 Oct 2026 |
| API URL | `https://chiafggvergjwliqvlwv.supabase.co` |
| Publishable key (public) | `sb_publishable_g70WFso8X3RevFDQhNAxxw_aGhcSxk_`. Safe to ship in web and app builds; it grants no table access (see below). |
| JWT signing | Asymmetric **ES256** key published at `/auth/v1/.well-known/jwks.json`, as the API's verifier requires |
| Database schema | Migrations 0001–0010 applied and recorded in `schema_migrations` with the same checksums as `db/migrations`, so `pnpm db:migrate` sees staging as up to date. 0010 (Phase 6) was applied on 15 Oct 2026 in one transaction with its checksum row; afterwards 2 unapproved draft rubrics, the 7 new triggers and 3 new indexes were present, `sj_ranking_worker`, `anon` and `authenticated` had no privilege on the jury and volunteer tables, and every table still had RLS on. **0011 (Phase 7) is not applied yet** (step 5 below) |
| Data API | Closed. All 32 tables have row-level security on with no policies, and `anon`/`authenticated` hold no privileges (checked in SQL on 15 Oct 2026; Supabase security advisor shows only the expected "RLS enabled, no policy" notes) |

Also in the ISF organisation: "Amartya2005's Project" (Sydney, ap-southeast-2) was created automatically, is empty, and is **paused** to free the free-plan project slot. Restore or delete it from the dashboard as you prefer. The personal "n8n" organisation and its project are not used.

## Still to do before staging tests can run (owner: whoever holds the ISF Supabase account)

1. **Secrets** (dashboard → Project settings). Never commit these, and never put them in `NEXT_PUBLIC_*` or `EXPO_PUBLIC_*`:
   - the service-role / secret key → `SUPABASE_SERVICE_ROLE_KEY` for the staging API and `STAGING_SUPABASE_SERVICE_ROLE_KEY` for `staging:verify`;
   - the database password and connection string → `DATABASE_URL` for the staging API. Use the session pooler or a direct connection; postgres.js needs session mode.
2. **Auth settings** (dashboard → Authentication):
   - email OTP: set the email template to show `{{ .Token }}` (the 6-digit code), because the apps use codes, not links;
   - SMS OTP: the DLT-registered sender through Supabase's **Send SMS hook** (TBD-35: an Indian DLT-compliant aggregator, default MSG91), plus one or more **test phone numbers** with fixed OTPs for automated tests;
   - custom SMTP (TBD-35: Amazon SES, ap-south-1), because Supabase's built-in email only reaches project team members;
   - MFA: TOTP enabled;
   - for the device protocol run, temporarily shorten the JWT expiry to 300 s.
3. **Host the staging API** (AUTH_MODE=supabase, REQUIRE_STAFF_MFA=true, NODE_ENV=staging), plus the website and console with `NEXT_PUBLIC_AUTH_MODE=supabase`, `NEXT_PUBLIC_SIGNIN_METHODS=email` (TBD-12) and the URL and key above. Recommended hosting (TBD-46): Cloud Run asia-south1 for the API, scaled to zero, and a Vercel preview for the web apps. It awaits organisation-owned accounts (TBD-36).
4. **Phase 5 settings** for the staging API: `RANKING_PROVIDER=vertex` with the staging project's model settings once the Google Cloud account exists (until then `stub`, which is not an AI); `NOTIFY_EMAIL_PROVIDER=smtp` with Amazon SES once it exists (until then `none`: messages stay queued); `RUN_WORKERS=true`, or a separate `start:worker` service. The ranking worker uses the database role `sj_ranking_worker` (migration 0008). Migration 0009 gives the migrating user a membership with SET, so it can switch to that role. Checked on staging on 15 Oct 2026: `postgres` can `SET ROLE sj_ranking_worker`, and inside that role reading `selection_decisions` or `user_accounts` is refused (42501). The API's database user must be the user that ran the migrations; the workers log an error at start-up if it cannot switch roles.
5. **Phase 7** (not done yet): apply migration `0011_event_content_notices.sql` (checksum `8f3cc63d0f4cfa3cb5ad18d9b0efcb174a67c24c9159268f07d945ec07f354e1`) with its `schema_migrations` row, like 0010. Create a **private** Storage bucket `event-documents` and run the staging API with `STORAGE_PROVIDER=supabase`. Push stays `PUSH_PROVIDER=none` until an EAS project and FCM/APNs credentials exist under the organisation's accounts (TBD-52); the in-app inbox works without it.
6. **Phase 8** (not done yet): apply migration `0012_helpdesk_support.sql` (checksum `26ce5b49e292278ea87f36604df61505161e8afa80addb0a32cbfd5ccb39d4b4`) after 0011, with its `schema_migrations` row. Set `HELPDESK_PROVIDER` (`vertex` with `HELPDESK_VERTEX_PROJECT`, `HELPDESK_VERTEX_MODEL` and a Help Desk-only service account once the Google Cloud account exists; until then `stub`, which is not an AI, or `none`). Add at least one Customer Support account and the Admin-published venue emergency numbers once the organisers supply them. Not applied by the Phase 8 delivery: staging changes need authorisation.
7. Seed one Management account (and one never-signed-in Management account for the linking-attack check), then run `pnpm --filter @sj/api staging:verify` and the [device protocol](/docs/DEVICE_TEST_PROTOCOL.md).

## Running `staging:verify` safely

```bash
STAGING_CONFIRM=this-is-staging \
STAGING_SUPABASE_PROJECT_REF=chiafggvergjwliqvlwv \
STAGING_SUPABASE_URL=https://chiafggvergjwliqvlwv.supabase.co \
STAGING_SUPABASE_ANON_KEY=sb_publishable_... STAGING_SUPABASE_SERVICE_ROLE_KEY=... \
STAGING_API_URL=https://<staging-api> \
pnpm --filter @sj/api staging:verify
```

- The project ref must be on `APPROVED_STAGING_REFS` in `apps/api/scripts/staging-guard.ts`, and the URL must be exactly `https://<ref>.supabase.co`. Approving another project is a reviewed code change.
- Cleanup deletes only users this run provably created: a successful `createUser`, or a new account on an address the run generated (or a test phone number unused before the run). Staff accounts and any pre-existing users are never deleted.
