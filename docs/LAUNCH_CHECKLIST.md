# Launch checklist: production stays closed until every item is signed off

**Status: NOT APPROVED. Do not deploy to production or enter real participant data.**

The API enforces this list in code. With `NODE_ENV=production` it refuses to start, and names each unmet item, unless all of the following hold (`apps/api/src/config.ts → productionBlockers`):

- `AUTH_MODE=supabase` (development sign-in is never allowed);
- staff MFA is on (`REQUIRE_STAFF_MFA` defaults to true and may not be `false`);
- `CORS_ORIGINS` lists only `https://` production origins;
- the privacy notice version is no longer a `draft-*` version (`PRIVACY_NOTICE_VERSION` in `packages/contracts`);
- AI ranking uses a real model (`RANKING_PROVIDER=vertex`), never the development stub, which is not an AI;
- no message provider is set to `log` (which reports messages as sent without sending them), and `DEV_NOW` is not set;
- the Help Desk uses a real model (`HELPDESK_PROVIDER=vertex`), never the development stub (not an AI) or `none` (fallback answers only);
- `LAUNCH_APPROVED=true` is set. Set it **only** after every item below is checked and signed off.

## A. Accounts and environments (TBD-36, TBD-46)

- [x] Organisation-owned Supabase **staging** project: `startup-jathara-staging` in the ISF organisation, ap-south-1, migrations 0001–0009 applied, Data API closed (see [docs/STAGING.md](/docs/STAGING.md)). Done 15 Oct 2026.
- [ ] Organisation-owned Supabase **production** project (ap-south-1) on the Pro plan, with PITR on during the critical windows (TBD-33, TBD-46; budget approval needed). Never use any personal project.
- [ ] Cloud, domain, Vercel, GitHub organisation, WhatsApp Business and Apple/Google store accounts are owned by the organisers' legal entity (TBD-36). Store accounts are **organisation** accounts (a D-U-N-S number is needed; request it early). Zeny2Labs has member access only.
- [ ] Secrets are stored in the secret manager: `SUPABASE_SERVICE_ROLE_KEY`, `SMTP_PASS` and `MSG91_AUTH_KEY` go to the API and worker services only, never to any `NEXT_PUBLIC_*` or `EXPO_PUBLIC_*` value. Ranking uses its own service account (`RANKING_VERTEX_SERVICE_ACCOUNT`, FR-RNK-12), separate from the future Help Desk's.
- [ ] Background workers are deployed: either `RUN_WORKERS=true` on an API host that keeps CPU between requests, or a separate `start:worker` service with `RUN_WORKERS=false` on the API.
- [ ] Repository made **private** until launch approval (OD-04, owner action). It is currently public.

## B. Live Supabase staging tests (B-06). The code is tested against Supabase-shaped data, not a live project.

Two tools support this section:

- **Automated server-side checks:** `pnpm --filter @sj/api staging:verify` (`apps/api/scripts/staging-verify.ts`). It covers real email OTP and SMS OTP (via a Supabase test number) sessions, JWKS keys, session refresh, sign-out revocation, the unconfirmed-email linking attack, and TOTP MFA elevation. It runs only against an approved staging project: `STAGING_SUPABASE_PROJECT_REF` must be on the approved list in `scripts/staging-guard.ts` and match the URL exactly, and `STAGING_CONFIRM` is also required. It deletes only users that it provably created, never pre-existing accounts.
- **Real phones:** [docs/DEVICE_TEST_PROTOCOL.md](/docs/DEVICE_TEST_PROTOCOL.md), cases D1–D12: keychain persistence, background refresh, sign-out, reinstall behaviour, and console MFA on phone browsers.

**What the automated checks do and do not prove.** `staging:verify` creates email OTP sessions with codes issued through Supabase's Admin API, and SMS sessions with a Supabase *test number*. That proves the session and token flow, linking and MFA. It does **not** prove that real emails arrive, that real SMS messages are delivered by carriers, or that the DLT sender and template registration works. Those are covered by device protocol D1 and D2 and the items below.

Not run yet: the staging project now exists (`startup-jathara-staging`), but its secrets and hosted API are pending (docs/STAGING.md). Run each case on staging and record the result and date:

- [ ] Email OTP sign-in: a new applicant registers; their email is stored only after Supabase confirms it.
- [ ] **Real email delivery:** OTP emails arrive at Gmail, Outlook and an institutional (e.g. GIET) inbox within a minute and not in spam. Custom SMTP and sender domain are configured (D1).
- [ ] SMS OTP sign-in (needs the DLT-registered sender and template through Supabase's Send SMS hook, TBD-35): the phone-only applicant flow works; no email is stored. Only then set the sign-in channels to `email,phone` (TBD-12).
- [ ] **Real SMS delivery:** OTP SMS arrives on Jio, Airtel, Vi and BSNL numbers via the DLT-approved sender ID and template (D2). A test number does not count.
- [ ] An unconfirmed email in the user's own metadata does **not** link to a pre-created staff account.
- [ ] An imported participant signs in with the confirmed email/mobile, the account links, the activation code works, and the code can't be reused.
- [ ] Email and phone matching different accounts → refused and audited (`identity.link_refused`).
- [ ] JWKS verification passes with the project's real signing keys (ES256/RS256); anonymous sessions are rejected.
- [ ] Admin API outage → 503 for unlinked identities only. Check the rate limits against the expected sign-up volume.
- [ ] Staff TOTP MFA: enrol, verify, get aal2; without aal2 → `mfa_required` on every privileged endpoint.
- [ ] Mobile app on a real Android and iPhone: every case in [docs/DEVICE_TEST_PROTOCOL.md](/docs/DEVICE_TEST_PROTOCOL.md) (D1–D12) passes, and the iOS reinstall behaviour (D8) is decided.
- [ ] `staging:verify` reports 0 failures and 0 skips, with all optional settings provided.

**Phase 5 providers, live** (the adapters are tested only against recorded request formats):

- [ ] **Ranking model chosen by evaluation** (TBD-35): `pnpm --filter @sj/api ranking:eval` passes every check against the Vertex AI model and region to be used, and the report is kept as evidence. The data-processing terms for Vertex AI are reviewed (Legal, cross-border processing).
- [ ] A ranking run on staging with the real model over a synthetic cohort completes. Results look sensible to a Management reviewer, and steering attempts are flagged.
- [ ] **Result and activation email through Amazon SES**: a release and an activation code reach Gmail, Outlook and an institutional inbox, not spam, and show as `sent` in the console. SES production access granted; SPF, DKIM and DMARC pass.
- [ ] **Result and activation SMS through MSG91**: DLT templates for the result, correction and activation messages are registered and their ids configured. Messages arrive on Jio, Airtel, Vi and BSNL. Failures show as `failed` in the console after the retries.
- [ ] **Document storage** (TBD-51): a **private** Supabase Storage bucket `event-documents` exists (not public); the API runs with `STORAGE_PROVIDER=supabase`. An Admin uploads a jury-only PDF; a juror opens it through the app; a volunteer and the public get "not found"; a copied link stops working after 60 seconds.
- [ ] **Help Desk model** (TBD-35, TBD-54): a Vertex AI model in asia-south1 with a Help Desk-only service account (`HELPDESK_VERTEX_SERVICE_ACCOUNT`, separate from ranking). An evaluation on staging with the real model shows: answers grounded only in published information and the person's own records; injection and data-extraction attempts refused; emergency wording routed to 112 without the model; no other person's contact details in any answer. Keep the transcript set as evidence. Not built yet: an automated Help Desk evaluation script like `ranking:eval`.
- [ ] **Emergency and support on staging** (Phase 8): migrations 0011 and 0012 applied; a test emergency from a real phone shows 112 first (also in airplane mode), reaches the Support page within one poll, re-alerts and escalates to Management at the configured window, and is acknowledged and resolved. `112` dials from the app on a real Android and iPhone.
- [ ] **Push notifications** (TBD-52): an EAS project with FCM credentials and an APNs key under the organisation's accounts; `PUSH_PROVIDER=expo` (and `EXPO_ACCESS_TOKEN` if enhanced push security is on). With development or store builds on a real Android phone and a real iPhone: a jury-only notice arrives as a push on a juror's phone and not on a volunteer's; the console shows it as handed to the push service; uninstalling the app leads to a `failed` receipt and the device being disabled.

## C. Decision approvals ([docs/DECISIONS.md](/docs/DECISIONS.md))

Every TBD now has a recommended decision, and the code follows it. **None has been approved.** Tick an item only when the named approver confirms it in writing, and record who and when in the sign-off table.

**Before the registration website goes live:**

- [ ] **Legal: privacy notice approved** (TBD-32, DPDP review; draft in [docs/PRIVACY_NOTICE_DRAFT.md](/docs/PRIVACY_NOTICE_DRAFT.md)), together with the retention schedule, the 18+ policy (TBD-45) and vendors' cross-border processing (TBD-35). Publish it on `/privacy` and bump `PRIVACY_NOTICE_VERSION` to the approved version.
- [ ] **Organisers: 2026 cut-off** 5 Nov 2026 23:59:59 IST (TBD-11). Then set `event_editions.closes_at_confirmed = true`.
- [ ] **Organisers:** sign-in channels (TBD-12; set `NEXT_PUBLIC_SIGNIN_METHODS` / `EXPO_PUBLIC_SIGNIN_METHODS`), Junicorn rules not applied (TBD-08), website-only registration before 5 Nov (TBD-38), adults only (TBD-45), account-owning entity (TBD-36).
- [ ] **Management: application form wording** (TBD-39; the six questions in migration 0007; change them only before the first application, because the form freezes after that), duplicate rule (TBD-15), selection-limit confirmation (TBD-19).

**Before the phase that uses them:**

- [ ] **Organisers:** activation delivery and 72 h validity (TBD-13); import column set v1 signed off on a real sample (TBD-41); team-member onboarding after selection (TBD-16); delegate scope and no QR/allocation modules (TBD-04, TBD-30); content ownership (TBD-24); Help Desk on the website as a WhatsApp link (TBD-25); English only (TBD-26); export permissions (TBD-31); descope checkpoints (OD-05).
- [ ] **Organisers, before Phase 8 goes live (built 16 Oct 2026):** venue emergency numbers (campus security, medical, control room), published by the Admin as emergency contacts (TBD-07); acknowledgement windows and escalation contacts, set by Management per edition (TBD-27; built defaults 5/30/120 min are not approved); support roster, on-call cover and alert channel (TBD-28; only dashboard alerts are built, no SMS); emergency control behaviour (TBD-55) and re-alert mechanics (TBD-57). **Management:** Help Desk answer scope (TBD-54) and ticket lifecycle (TBD-56).
- [ ] **WhatsApp Help Desk** (separate workstream): not part of this repository's Phase 8 delivery. Track its readiness, provider account (TBD-35/36) and the website link (TBD-25) in that workstream.
- [ ] **Management, before results are released (by 20 Nov, TBD-40):** criteria set approved by 6 Nov (TBD-01); result channels and wording (TBD-14); override reasons (TBD-18); correction and withdrawal policy (TBD-37), with the correction process built; scores never shared (TBD-44).
- [ ] **Management, later phases:** TBD-05, TBD-10, TBD-17, TBD-29, TBD-42.
- [ ] **Management, before the event (jury and volunteers, built in Phase 6):** approve a jury rubric version in the console (TBD-43; jurors cannot score until then) and the rubric-change rule (TBD-50); pitch assignment and the "currently pitching" operators (TBD-20, TBD-21); volunteer pool, roles and reassignment rules (TBD-22, TBD-23, TBD-47); assignment message wording and a registered DLT template for `MSG91_TEMPLATE_ASSIGNMENT` (TBD-48); the contact fields shared between volunteers and targets, also for the privacy notice (TBD-49, with Legal).
- [ ] **Organisers and Management, before event information goes live (built in Phase 7):** review and publish the seeded tentative programme, then keep it current (TBD-06); content ownership (TBD-24); document formats and size (TBD-51); notice channels and authorised groups (TBD-29); draft, correction and push-timing rules (TBD-53); push provider and its accounts (TBD-52, TBD-36). The Admin publishes the venue emergency numbers (TBD-07).
- [ ] **Budget:** hosting and budget ceiling (TBD-46), PITR windows and service targets (TBD-33), vendor contracts and DPAs (TBD-35).

## D. Security and operations

- [ ] Independent security review / penetration test of the API, console and app; findings closed.
- [ ] Any CSV/spreadsheet export added later uses `apps/api/src/platform/csv-export.ts` (formula-injection escaping). Reviewed in code review.
- [ ] Load test at the agreed peak (registration close, event days).
- [ ] Backups and point-in-time recovery on; restore drill done on staging (AT-36).
- [ ] Monitoring, error reporting and uptime checks in place; on-call contact named.
- [ ] CI is green on the release commit (typecheck, API tests on Postgres, mobile unit tests, builds).
- [ ] Browser end-to-end suite run against **staging** (`scripts/e2e_*.py`).
- [ ] Mobile: sign-out on the first launch after a reinstall is built (OD-02), and device case D8 shows "signed out" on both platforms.

## Sign-off

| Item group | Owner | Date | Evidence |
|---|---|---|---|
| A. Accounts and environments | | | |
| B. Live staging tests | | | |
| C. Content and policy | | | |
| D. Security and operations | | | |

Only when every row above is filled in: set `LAUNCH_APPROVED=true` in the production API environment.

### What the code enforces and what it does not

`apps/api/src/config.ts` refuses a production start unless these configuration facts hold:

- `AUTH_MODE=supabase`;
- staff MFA is on;
- `CORS_ORIGINS` is HTTPS-only;
- the privacy notice version is not a draft;
- `RANKING_PROVIDER=vertex` (not the stub), no `log` message or push provider, no `DEV_NOW`;
- `HELPDESK_PROVIDER=vertex` (not the stub or `none`);
- `STORAGE_PROVIDER=supabase` (the database document store is for development only);
- `LAUNCH_APPROVED=true`.

It **cannot** check that the operational items above have evidence and signatures. `LAUNCH_APPROVED` is therefore a human attestation, and it must be tightly controlled:

- Only the named release owner may set it, in the production secret store.
- Write access to that store is limited to the release owner and one deputy.
- Every change is audit-logged by the platform.
- It is set only after the sign-off table above is complete, and the date and approver are recorded in the release notes.
- It is never set in staging, CI, `.env.example` or local `.env` files.
