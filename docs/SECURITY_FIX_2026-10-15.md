# Security fix report — identity verification, account linking, activation (15 Oct 2026)

Scope: `startup-jathara-m1`. No architecture, API-contract or PRD changes. No production credentials were used and nothing was deployed.

## 1. Findings and root causes

| # | Finding | Root cause | Severity |
|---|---|---|---|
| F1 | A Supabase user could be treated as owning an email they never confirmed | The verifier accepted `user_metadata.email_verified` (user-editable via `updateUser({ data })`) and the amr method `otp`, which Supabase uses for **both** email OTP and SMS OTP. A phone-OTP user with an unconfirmed email in their profile looked "email verified". | Critical |
| F2 | Pre-created staff accounts (e.g. `management`) could be taken over | Linking matched the token email against unlinked accounts, so F1 let an attacker inherit the account's roles on first sign-in. | Critical |
| F3 | No activation enforcement | `pending_activation` accounts were linked and received their roles, so imported or invited accounts were usable without activation. Only `deactivated` was checked. | High |
| F4 | Registration stored unproven identifiers | New applicant accounts stored the token email whether verified or not. Someone could reserve another person's email before that person's account was imported, which blocked the import or the later link. | High |
| F5 | Linking accepted deactivated accounts and ambiguous matches | There was no status filter, no conflict handling (email → account A, phone → account B), and no handling of shared mobile numbers. | Medium |
| F6 | Weak JWT options for external tokens | Algorithm not pinned, `exp` not required, anonymous sessions and non-`authenticated` roles (e.g. `service_role`) accepted. | Medium |
| F7 | Release could grant edition access to a deactivated leader | The `edition_access` insert on release had no status check. | Low |

## 2. Changes

**Identity (`apps/api/src/platform/auth.ts`)**
- Responsibilities are split. A `TokenVerifier` proves who the session is (`sub`, `aal`). A new `IdentityResolver` proves which email or phone that identity controls.
- In Supabase mode the resolver reads `GET /auth/v1/admin/users/{sub}` with the server-side service-role key.
- An email or phone counts as proven only when all three hold:
  - `email_confirmed_at` / `phone_confirmed_at` is set;
  - the record's value matches the token's (phone normalised to E.164);
  - the user is not banned, deleted or anonymous, and the record id equals `sub`.
- Fails closed: a 5xx response, network error or bad JSON gives 503 `identity_unavailable`, never "verified".
- The resolver runs only for subjects not yet linked, so already-linked accounts do not depend on it.
- The JWKS verifier now:
  - accepts only ES256/RS256;
  - requires `sub` and `exp`;
  - rejects anonymous sessions and any `role` other than `authenticated`;
  - ignores `user_metadata` and `amr`.
- Dev tokens (local and tests only, refused in production) carry signed `email_verified` / `phone_verified` assertions so tests can model every case.

**Linking (`principal.ts`)**
- Linking uses proven identifiers only.
- Candidates must be unlinked and not deactivated.
- These cases are refused and audited as `identity.link_refused`:
  - email and phone match different accounts;
  - more than one candidate (shared mobile);
  - a phone-only match on an account whose email on file was not proven.
- The link is an atomic conditional update, audited as `identity.linked` with the method used.

**Activation (`principal.ts`)**
- The account status check runs before any role or edition access is loaded, on every protected request.
- Responses: `pending_activation` → 403 `account_not_active`; `deactivated` → 403 `account_deactivated`; any other state → 403 (fail closed).
- No endpoint changes account status, so a direct API request cannot activate an account.

**Registration (`modules/registration/service.ts`)**
- A new account requires a proven email or phone; otherwise 403 `identity_unverified`.
- Only proven identifiers are stored. A phone-only identity gets `email = null` and its verified mobile.

**Database (`db/migrations/0003_activation_guards.sql`, new forward-only migration)**
- DC-02 is strengthened: a decision maker must be an **active** account with a management grant.
- New trigger: `released_by` must also be an active management account.
- New triggers refuse inserts into `role_grants` and `edition_access` for deactivated accounts (hint `ACCOUNT-STATUS`).

**Selection release** — the `edition_access` grant now skips deactivated leaders (F7).

**Config** — new `SUPABASE_SERVICE_ROLE_KEY`, required when `AUTH_MODE=supabase`, server-side only. `.env.example` and README are updated.

## 3. Selection limit (inspected, unchanged)

Current behaviour:
- `PUT /selection-limit` sets the limit.
- Drafting decisions is never limited.
- `listApplications` reports `selectedTotal` (drafted + released `selected`) against `selectionLimit`.
- Release is **permitted** above the limit and returns a `warnings[]` entry.

This matches PRD FR-SEL-04 as written ("warn"). It is not a security or integrity defect:
- only an active management account can release, and DB trigger DC-02 enforces this;
- every release is audited;
- the count is computed in the same transaction.

The behaviour was kept at the time. **TBD-19 was resolved later on 15 Oct 2026** ([DECISIONS.md](/docs/DECISIONS.md)): a release above the limit now needs explicit, audited confirmation (`confirmOverLimit`), pending Management approval of the policy.

## 4. Tests added

- `apps/api/test/auth.test.ts` (updated). These old cases asserted the insecure behaviour and were replaced with stricter ones:
  - forged `user_metadata.email_verified` + amr `otp` → no verification;
  - phone normalisation;
  - rejection of anonymous sessions, wrong audience, `service_role`, missing `exp` and HS256 tokens.
- `apps/api/test/security.test.ts` (new):
  - **Resolver with a fake Admin API:**
    - email confirmed, unconfirmed or mismatched;
    - phone OTP (phone confirmed, email unconfirmed), phone unconfirmed or mismatched;
    - id mismatch, banned, deleted, anonymous, 404;
    - 500 or network error → 503;
    - service-key header and URL-encoded `sub`.
  - **Linking attacks:**
    - unverified email → no link and no roles;
    - verified email → link;
    - already-linked account cannot be re-linked (409 `email_in_use` on registration);
    - deactivated account never linked;
    - email/phone conflict refused and audited;
    - phone-only links to a single email-less account;
    - phone cannot claim an account with an email on file;
    - shared mobile refused (`ambiguous`);
    - unverified phone ignored;
    - identity outage → 503 for new identities while linked accounts keep working.
  - **Full stack with Supabase-shaped ES256 tokens:** a forged-claim attacker cannot take over a staff account. They can register only with their confirmed phone, and their email is not stored.
  - **Registration:** no proven identifier → 403 and nothing created; phone-only → 201 with `email = null`.
  - **Activation matrix:**
    - all 8 roles × {pending, deactivated} × 10 protected endpoints → 403 with the right code;
    - status and grants unchanged afterwards and no application created (no bypass);
    - all 8 roles × active → expected access only.
  - **Pending account:** links on verified sign-in but stays locked.
  - **DB triggers:** pending manager cannot decide or release (DC-02); grants and edition access refused for deactivated accounts (`ACCOUNT-STATUS`).

## 5. Verification results (at the time of the fix, commit b9fe754)

All commands were run on 15 Oct 2026 in the build workspace against a local PostgreSQL 16 server (`scripts/dev-db.sh`, 127.0.0.1:54329). No hosted or production services were used.

| Command | Result |
|---|---|
| `pnpm -r typecheck` | ✅ 6 of 6 packages pass (contracts, client, web-session, api, web, console) |
| `pnpm --filter @sj/api test` (real Postgres, fresh DB per file) | ✅ **81 of 81 pass in 5 files**. This is 34 more than the 47 before the fix: `security.test.ts` adds 35, and `auth.test.ts` lost one test (the "links pending account → 200" case, which expected the insecure behaviour). The first run had 2 failures; both were test-fixture bugs: one test granted roles to an already-deactivated account, which the new trigger correctly refused, and one fixture email was duplicated. The fixtures were fixed; no product code changed. |
| Mutation check: each fix reverted temporarily, then `security.test.ts` re-run | Activation check removed → 9 tests fail. Unconfirmed email trusted → 3 fail. Linking-conflict refusal removed → 2 fail. Source restored afterwards and verified identical to the fixed version. |
| `pnpm db:migrate` (dev DB) | ✅ `applied: 0003_activation_guards.sql` |
| `pnpm -r build` | ✅ API bundle, website and console production builds all done |
| `python3 scripts/e2e_smoke.py <dir>` against the production builds (API :4000, web :3000, console :3001) | ✅ `E2E smoke passed`. Covers website registration → console review → decision → release → applicant status. |

Not run: CI on GitHub (no repository linked) and Supabase staging (no project provisioned; see §6).

## 6. Remaining risks

1. **Staging validation pending.** The Admin API record shape, phone format and JWKS behaviour are tested against fakes modelled on Supabase docs, not against a real project (B-06). Run the sign-in matrix (email OTP, SMS OTP, both) on staging before launch.
2. **Admin API dependency for first sign-in.** Every request from a not-yet-linked identity (applicants before they register) calls the Admin API: there is no cache, and Supabase rate limits apply. An outage gives 503 for those users only. If load testing shows pressure, add a short-TTL cache keyed by `sub`.
3. **Service-role key is a high-value secret.** It must be held in Secret Manager for the API service only, never in web or console builds, and rotated if exposed.
4. **Activation flow not built (B-09).** Pending accounts are correctly locked out but cannot activate yet. Imports must not create staff as `pending_activation` until B-09 ships, or those staff stay locked.
5. **Email change after linking.** Linked accounts are matched by `sub`. If a user changes their email in Supabase, `user_accounts.email` is not re-synced. This is acceptable for M1; revisit with profile management.
6. **Selection-limit policy TBD-19** (see §3).
7. **Existing pending grants.** Pending accounts may hold pre-assigned grants (from imports). They stay inert because the API never loads them for non-active accounts, but any future non-API path must also check status.

## 7. Reproduce

```bash
pnpm install --frozen-lockfile
pnpm db:start && pnpm db:migrate        # local Postgres 16 on 127.0.0.1:54329
pnpm -r typecheck
pnpm --filter @sj/api test              # real Postgres, one fresh database per test file
pnpm -r build
# browser e2e: start API (:4000), web (:3000), console (:3001), then
python3 scripts/e2e_smoke.py /tmp/shots
```

## 8. Reconciliation: status as of the CI-green release (later on 15 Oct 2026)

This section brings the report up to date with work done after the fix. Sections 1–7 above are kept as the record of the original fix.

### Findings F1–F7

| # | Status now |
|---|---|
| F1 Unverified email claims trusted | ✅ Fixed. The authoritative Admin API record is used, and SMS OTP is now supported end to end, so phone-only identities are handled explicitly rather than incidentally. |
| F2 Staff-account takeover via linking | ✅ Fixed and tested, including phone-only linking and conflict refusal. |
| F3 No activation enforcement | ✅ Fixed. The activation flow now exists too (Phase 3): single-use, time-limited codes, hash-only storage, single use enforced by the database. |
| F4 Unproven identifiers stored at registration | ✅ Fixed. |
| F5 Linking deactivated or ambiguous accounts | ✅ Fixed. |
| F6 Weak JWT options | ✅ Fixed. |
| F7 Edition access for deactivated leaders | ✅ Fixed, with a DB trigger as backstop. |

### Remaining risks (§6), updated

1. **Live Supabase staging validation**: **still open.** This is now launch checklist §B, and production refuses to start without sign-off.
2. **Admin API dependency at first sign-in**: still open (to be measured in the load test).
3. **Service-role key handling**: still open, operational; checklist §A.
4. **Activation flow not built**: ✅ **resolved** (Phase 3).
5. **Email change after linking not re-synced**: still open, accepted for now.
6. **Selection-limit policy TBD-19**: ✅ **decided** (DECISIONS.md): confirmation required above the limit, audited; built and tested (AT-15). The policy awaits Management approval.
7. **Pending accounts' pre-assigned grants**: still inert; the API never loads roles for non-active accounts (tested for all 8 roles).

### Hardening added since the fix

- **Staff MFA in production (FR-IAM-11):**
  - `REQUIRE_STAFF_MFA` defaults to on in production and the API refuses to start if it is set to `false`.
  - `GET /v1/me` reports `mfaRequired`, and the console routes staff to a TOTP step (enrol and verify with Supabase).
  - Every privileged endpoint answers `mfa_required` without aal2. This is verified by API tests and by a browser test against an API with MFA enforced.
- **Production launch gate.** The API will not start in production until the launch checklist is complete:
  - Supabase sign-in, MFA on, and HTTPS-only origins are configured;
  - the privacy notice is no longer a draft;
  - `LAUNCH_APPROVED=true` has been set.
- **Native session storage.** Supabase sessions in the mobile app are kept in the device keychain/keystore, split into chunks below the 2 KB per-entry limit. An incomplete write reads as signed out. AsyncStorage was removed.
- **Import hardening.** Malformed rows are rejected per row, and the column-count result is kept at commit:
  - values beyond the header (column shift);
  - control characters;
  - unreadable (non-UTF-8) text;
  - cells over 5,000 characters;
  - spreadsheet-formula prefixes (`=`, `+`, `@`).
- **Migration runner.** Line-ending differences no longer look like edits; real edits are still refused.

### Verification now

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` on a clean copy | ✅ (this failed in the first GitHub Actions run because the lockfile was stale; fixed) |
| `pnpm -r typecheck` | ✅ 7 of 7 packages |
| `pnpm --filter @sj/api test` (real PostgreSQL) | ✅ 129 of 129, in 9 files |
| `pnpm --filter @sj/mobile test` | ✅ 4 of 4 (keychain chunking) |
| `pnpm -r build` plus the mobile web/Android/iOS bundles | ✅ |
| Browser end-to-end | ✅ `e2e_smoke`, `e2e_admin`, `e2e_phone`, `e2e_mobile`, `e2e_mfa` (with `REQUIRE_STAFF_MFA=true`) |
| GitHub Actions | ✅ green on `main` (see the Actions tab for the run of this commit) |

Not verified: anything that needs a live Supabase project, an SMS provider, real devices or production infrastructure. Launch checklist §B covers these.

### Review follow-up (15 Oct 2026, after §8)

| Item | Resolution |
|---|---|
| **Open redirect** after sign-in or MFA. The `next` parameter was passed straight to `router.push`, `router.replace` and `window.location.assign` on the website sign-in, console sign-in and console MFA pages. | ✅ Fixed. All three now use `safeReturnPath`, which allows only approved internal paths. Absolute, `//host`, backslash, control-character, encoded-slash and dot-segment variants fall back to a safe page. 18 tests. |
| **Formula injection:** a leading `-` was not rejected. | ✅ Import validation now rejects `=`, `+`, `-`, `@`, tab and carriage return, and their full-width forms, in exportable text fields (regression test included). Mobile numbers and emails keep their own rules. `platform/csv-export.ts` escapes every exported cell; it is tested, and its use for all future exports is a project rule. |
| **Real-device and live-Supabase validation.** | ⏳ Still open by design. `staging:verify` (automated, tested guards, RFC 6238 TOTP) and DEVICE_TEST_PROTOCOL.md (D1–D12) are ready to run once an organiser-owned staging project exists. Production stays closed until they are signed off (launch gate). |

### Second review follow-up (15 Oct 2026)

| Item | Resolution |
|---|---|
| **Critical:** `staging:verify` could delete a pre-existing staff user. Disposability was inferred from the email prefix; the SMS check also deleted whichever user owned the test number. | ✅ Fixed. Cleanup now deletes only users the run **provably** created: a successful `createUser`, or a new user on a run-generated address or an unused test number, created after the run started (`CreatedUsers` in `scripts/staging-guard.ts`; 6 tests). Staff accounts are never recorded. The verifier had **not** been run against any project before the fix. |
| **High:** staging-only protection relied on a confirmation phrase and a single blocked ref. | ✅ Fixed. `STAGING_SUPABASE_PROJECT_REF` must be on the reviewed allow-list `APPROVED_STAGING_REFS` (currently only `chiafggvergjwliqvlwv`), and the URL must be exactly `https://<ref>.supabase.co`. The confirmation phrase and the blocked list remain as extra safeguards. 12 refusal tests, plus a live check that wrong targets abort before any network call. |
| Broken device-protocol link | ✅ Links between docs now use repo-root paths (`/docs/...`), which resolve on GitHub and from copies outside `docs/`. |
| Clarifications | ✅ The checklist states that automated OTP checks prove the session flow, not email, carrier or DLT delivery (manual items D1/D2 were added). It also states that the launch gate enforces configuration only, and that `LAUNCH_APPROVED` is a tightly controlled human attestation. |

### Third review follow-up (15 Oct 2026)

| Item | Resolution |
|---|---|
| **Cleanup could fail silently.** `deleteUser` errors, which come back in the result object, were ignored, and ids were dropped from tracking anyway. The TOTP `deleteFactor` result was ignored too. | ✅ Fixed. `CreatedUsers.deleteOwned` drops an id only after a confirmed deletion; error results and thrown exceptions keep it tracked. `cleanupAll` returns every failure, and the verifier records a **FAIL** for any cleanup failure, which makes the exit code non-zero. A failed factor removal is reported the same way. `forget()` was removed, so the only way to untrack an id is a confirmed delete. |
| **Invalid timestamps fail closed.** An invalid `created_at` became an `Invalid Date`, which compares as false and could pass the "created after start" check. | ✅ Fixed. `createdAtOrAfter` requires `Number.isFinite`, for email and phone ownership alike, and an invalid run start time is rejected. Regression tests cover malformed, empty, missing and older timestamps. |

Tests: `test/staging-guard.test.ts` has 26 cases. Mutation checks confirm them: restoring the old timestamp comparison, or ignoring delete errors, makes the tests fail. API total: 192.

Launch status: **NOT APPROVED.**
