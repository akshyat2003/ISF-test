# Startup Jathara Platform: Technical Design and Feature Guide

| | |
|---|---|
| **Product** | Startup Jathara event platform for International Startup Foundation (ISF), built by Zeny2Labs |
| **Covers** | Everything built up to and including **Phase 8** (commit `a18d52a`, 16 Oct 2026) |
| **Production status** | **NOT APPROVED.** Nothing is deployed to production. The API refuses a production start until [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) is signed off. |
| **Sources of truth** | The requirements document (`Startup_Jathara_Requirements_Revised_v4`) and the PRD (`ISF_Event_Operations_Platform_PRD_v0.1`). Every open point has a recorded decision in [DECISIONS.md](DECISIONS.md). |
| **Related documents** | [ARCHITECTURE.md](ARCHITECTURE.md) (ADR-001, locked) · [PHASES.md](PHASES.md) · [EXECUTION_PLAN.md](EXECUTION_PLAN.md) · [DECISIONS.md](DECISIONS.md) · [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) · [STAGING.md](STAGING.md) · [SECURITY_FIX_2026-10-15.md](SECURITY_FIX_2026-10-15.md) · [DEVICE_TEST_PROTOCOL.md](DEVICE_TEST_PROTOCOL.md) · [PRIVACY_NOTICE_DRAFT.md](PRIVACY_NOTICE_DRAFT.md) |

This guide explains **how the platform is built and what each feature does**, in one place. It describes the code as it is, not as planned. Planned work is listed only in [§12](#12-not-built-yet).

---

## 0. Keeping this guide current

This file is maintained with the code. A change is not finished until this guide matches it.

**Update it in the same commit as the change when you:**

| You changed… | Update… |
|---|---|
| A feature, rule or screen | Its section in [§6](#6-features) (status, rules, screens, tests) |
| An API route or its permission | [§7](#7-api-reference) |
| A role or permission | [§4.3](#43-authorisation) |
| A migration | [§5.2](#52-migrations) and, if tables or rules changed, [§5.1](#51-tables-by-area) |
| An environment variable | [§10.3](#103-environment-variables) |
| Tests or browser flows | [§9](#9-testing-and-verification), with numbers **from an actual run** |
| Anything that finishes a phase | The changelog below and [§12](#12-not-built-yet) |

**Rules for writing it:**
- Describe what the code does now. If something is planned, say "not built yet".
- A rule still awaiting approval is labelled with its decision ID (for example "TBD-43, awaiting Management"). Never present it as confirmed.
- Never record a test result, deployment or approval that was not verified.
- Never put secrets, passwords, service-role keys or real participant data in this file.

### Changelog

| Date | Commit | Change to the platform | Guide version |
|---|---|---|---|
| 15 Oct 2026 | `c25f309` | Phases 1–4: foundation, registration and selection, Admin imports and activation, Expo mobile app, security hardening | — |
| 15 Oct 2026 | `96e8d48`, `4e92049` | Phone OTP, keychain sessions, production MFA policy, import hardening, launch gate, open-redirect fix, formula-injection hardening, staging verifier | — |
| 15 Oct 2026 | `ead054f`…`e5b1a61` | Supabase staging (ISF org, Mumbai): Data API locked down, function `search_path` pinned, staging guard | — |
| 15 Oct 2026 | `805a0fc`, `9c3416e` | Every TBD decided; application form as edition configuration; 18+ declaration; selection-limit confirmation | — |
| 15 Oct 2026 | `75dd860` | Phase 5: AI ranking, override reasons, two-person corrections, withdrawal, email/SMS outbox | — |
| 15 Oct 2026 | `785a329` | Phase 6: jury evaluation and volunteer assignment | 1.0 (this guide created) |
| 16 Oct 2026 | `f29884a`, `93ba3c0` | Phase 7: event information, documents, notices and push notifications (`93ba3c0`: a test made independent of database collation) | 1.1 |
| 16 Oct 2026 | `a18d52a` | Phase 8: AI Help Desk in the app, support tickets and Customer Support dashboard, emergency control, re-alerts and escalation. WhatsApp excluded (separate workstream) | 1.2 |

---

## 1. What the platform is

Startup Jathara is ISF's startup event. The 2026 edition runs on **18–20 December 2026** at GIET University, Gunupur, with a pre-event day on 17 December. The platform supports the 2026 and 2027 editions side by side.

The requirements describe **five interfaces on one system**:

| Interface | Where it lives | Status |
|---|---|---|
| Public website | `apps/web` (Next.js) | Built: programme and event information, registration, status, activation, privacy notice |
| Android and iOS app | `apps/mobile` (Expo, one codebase) | Built: sign-in, activation, home, event information, registration, status, messages and notices (with push), jury, volunteers. Not yet in app stores. |
| Admin dashboard | `apps/console` (Next.js), Admin sections | Built: accounts, imports, source event information and documents |
| Management dashboard | `apps/console`, Management sections | Built: applications, AI ranking, jury, volunteers, operational event information, notices |
| Customer Support dashboard | `apps/console`, Support sections | Not built yet (Phase 8) |

The console is **one access-controlled web app** that shows each person only the sections their roles allow (ADR-001). The API enforces every permission; hiding a menu item is never a control.

---

## 2. Architecture

The architecture is fixed by **ADR-001** ([ARCHITECTURE.md](ARCHITECTURE.md)). Changing it needs a new ADR.

```
 Public website ─────────┐  Next.js 16 (apps/web)
 Console (Admin, Mgmt,  ─┤  Next.js 16 (apps/console)              HTTPS + JSON, Bearer JWT
   Support)              │                                         ─────────────────────────▶  API: Fastify 5 modular monolith (apps/api)
 Android + iOS app ──────┘  Expo SDK 57 (apps/mobile)                                              │
                                                                                                    ├─ PostgreSQL (all data; rules as constraints and triggers)
 Identity: Supabase Auth (email/phone OTP, TOTP MFA) ── JWT ──▶ API verifies (JWKS)               ├─ Workers in the same codebase: AI ranking, email/SMS/push outbox
                                                                                                    ├─ Private file storage: Supabase Storage (documents)
                                                                                                    └─ Providers behind adapters: Vertex AI, SMTP (SES), MSG91, Expo push
```

**Principles that every feature follows:**
1. **One API, one database.** No interface talks to the database. Every client uses the typed client in `packages/client`.
2. **Contracts first.** Every request and response is a Zod schema in `packages/contracts`, shared by the API, website, console and app.
3. **Rules live in the database too.** Critical business rules are constraints or triggers, so they hold for any caller, including direct SQL.
4. **Default deny.** A route without a matching permission cannot be reached. Accounts must be `active`.
5. **Configuration, not code.** Dates, deadlines, limits and form questions are edition data.
6. **AI never decides.** AI ranking recommends; Management decides. Jury scores are kept apart from AI ranking and selection.
7. **Everything privileged is audited** in an append-only table.

### 2.1 Technology stack

| Layer | Choice (pinned) |
|---|---|
| Language | TypeScript 5.9, Node 22, pnpm 10 workspaces |
| API | Fastify 5.12, postgres.js, Zod 4.6, `@fastify/rate-limit` |
| Database | PostgreSQL 16 locally and in CI; Supabase PostgreSQL 17 on staging |
| Website and console | Next.js 16.4, React 19.3 |
| Mobile | Expo SDK 57 (React Native, expo-router), `expo-secure-store`, `expo-notifications` |
| Identity | Supabase Auth (email OTP, SMS OTP, TOTP MFA); a local development token mode |
| AI ranking | Google Vertex AI adapter, plus a development stub that is **not an AI** |
| Email / SMS / push | SMTP adapter (Amazon SES planned), MSG91 adapter (DLT templates), Expo push service adapter (FCM/APNs) |
| Files | Supabase Storage, private bucket, 60-second signed links (a database store for development only) |
| Tests | Vitest on real PostgreSQL; Playwright (Python) browser flows |
| CI | GitHub Actions (`.github/workflows/ci.yml`) |

---

## 3. Repository layout

```
apps/
  api/          Fastify API, domain modules, workers, migrations runner, seed, tests
    src/
      app.ts            every route and its guards
      config.ts         environment parsing and the production launch gate
      main.ts           API process; worker.ts: standalone worker process; workers.ts: worker loops
      db/               client.ts, migrate.ts (checksummed, forward-only), seed.ts (development only)
      platform/         auth.ts, principal.ts, permissions.ts, audit.ts, errors.ts, csv-export.ts
      modules/          accounts, editions, imports, registration, selection, ranking, notifications, jury, volunteers, content, notices
    scripts/            ranking-eval.ts, staging-verify.ts, staging-guard.ts, totp.ts
    test/               Vitest suites (one fresh database per file)
  web/          public website (programme, register, status, activate, sign-in, privacy)
  console/      Admin and Management console (applications, ranking, jury, volunteers, event info, notices, users, imports, MFA)
  mobile/       Expo app (sign-in, activation, home, event information, register, status, messages, jury, volunteer; push registration)
packages/
  contracts/    Zod schemas and shared pure functions (statuses, score checks, totals, safe redirects)
  client/       typed HTTP client used by every interface
  web-session/  browser sign-in shared by website and console (dev tokens or Supabase OTP + MFA)
db/migrations/  0001…0011, forward-only SQL
scripts/        dev-db.sh (local PostgreSQL) and the browser end-to-end flows (e2e_*.py)
docs/           design, decisions, phases, launch checklist, staging, this guide
```

Each API module owns its tables and is reached only through its service functions. A new business area is a new module, contract types and screens, never a separate service.

---

## 4. Cross-cutting design

### 4.1 Identity and sign-in

- **Two modes.** `AUTH_MODE=supabase` verifies Supabase JWTs against the project's JWKS (ES256). `AUTH_MODE=dev` uses API-issued development tokens for local work; the API refuses dev mode in production.
- **Sign-in methods** (TBD-12): one-time codes by email or by mobile number. Deployed environments offer email only until a DLT-registered SMS sender is live.
- **Token claims are not proof of verification.** The token tells the API *who* the session is (`sub`) and how strongly it authenticated (`aal`). Whether an email or phone is verified is read from the Supabase Admin API user record (`email_confirmed_at`, `phone_confirmed_at`), using the server-side service-role key. An outage there returns 503; the API never guesses.
- **Linking imported accounts.** A pre-created account (from an Admin import) links to a new sign-in only through a verified email or phone, only if unambiguous, and never to a deactivated account. Refusals are audited. See [SECURITY_FIX_2026-10-15.md](SECURITY_FIX_2026-10-15.md).
- **Activation.** Imported accounts start as `pending_activation`. The person signs in and enters a single-use activation code (only its hash is stored; default validity 72 h, TBD-13). Activation is enforced before any role is loaded, for every protected route, and backed by database triggers (migration 0003).
- **Staff MFA** (FR-IAM-11): Admin, Management and Customer Support need an `aal2` (TOTP) session when `REQUIRE_STAFF_MFA=true`, which is mandatory in production. The console steps the user up when a route returns `mfa_required`.
- **Sessions on devices.** The app keeps its session in the device keychain/keystore (`expo-secure-store`, chunked). Web builds use browser storage (for development and testing only).

### 4.2 Accounts, roles and edition access

- **Account status:** `pending_activation`, `active`, `deactivated`.
- **Eight roles:** `admin`, `management`, `customer_support` (staff roles) and `startup_team_leader`, `startup_team_member`, `jury_member`, `volunteer`, `delegate` (participant roles).
- **Role grants** (`role_grants`) are global or scoped to one edition, and are revoked rather than deleted.
- **Edition access** (`edition_access`) decides which event a participant belongs to. It comes from an import (`predefined`) or from a released selection. Participant routes under `/v1/editions/:year/…` require access to that year.
- **Nobody can change their own roles or status.**

### 4.3 Authorisation

Default deny: each route names one permission (`requirePermission`), and participant routes also check edition access (`requireEditionAccess`). On top of that, services check relationships (for example "this juror is assigned to this startup").

| Role | Permissions |
|---|---|
| Any signed-in user | `registration.submit`, `application.read_own`, `application.withdraw_own`, `notification.read_own`, `push.register_own`, `helpdesk.use`, `support.request_own`, `emergency.report` |
| `admin` | `import.manage`, `user.read`, `user.manage`, `role.assign`, `activation.issue`, `volunteer.read`, `volunteer.generate`, `content.read_all`, `content.manage_source` |
| `management` | `application.read_all`, `decision.draft`, `decision.release`, `selection_limit.configure`, `criteria.manage`, `ranking.run`, `ranking.read`, `decision.correct`, `jury.manage`, `jury.review`, `volunteer.read`, `volunteer.generate`, `volunteer.review`, `volunteer.reassign`, `content.read_all`, `content.manage_operational`, `notice.publish`, `support.review` (read-only), `support.alerts`, `support.configure` |
| `startup_team_leader` | `volunteer.my_volunteer` |
| `jury_member` | `jury.evaluate`, `volunteer.my_volunteer` |
| `volunteer` | `volunteer.my_assignment` |
| `customer_support` | `support.handle`, `support.alerts` |
| `startup_team_member`, `delegate` | no role-specific permissions. They use the event information, notices, Help Desk and support their edition access and audiences allow |

The Admin has **no** Management permissions unless separately granted the `management` role (FR-IAM-06). Event information is split by type (TBD-24): `content.manage_source` covers documents, emergency contacts, safety guidelines and pages; `content.manage_operational` covers the schedule, venues, food, accommodation and travel. The service checks the type on every write. The Admin has no support permissions. `emergency.report` is deliberately not gated on a role or edition access (TBD-55). Source: `apps/api/src/platform/permissions.ts`.

### 4.4 Audit

`audit_events` is append-only: a trigger rejects UPDATE and DELETE (DC-13). Every privileged write records the actor, action, entity, edition and a data payload, inside the same transaction as the change.

### 4.5 Errors

Errors are RFC 9457 problem responses with a stable `code` (for example `no_edition_access`, `mfa_required`, `registration_open`, `override_reason_required`, `draft_run_exists`). Validation errors carry field paths (`errors: [{path, message}]`) that the screens show next to the field. Database rule violations map to 409 `rule_violation` (trigger, with the hint) or 409 `conflict` (unique index).

### 4.6 Configuration and the production launch gate

`apps/api/src/config.ts` parses the environment. With `NODE_ENV=production` the API **refuses to start** unless:
- `AUTH_MODE=supabase`, staff MFA on, `CORS_ORIGINS` HTTPS-only;
- the privacy notice version is not a draft;
- `RANKING_PROVIDER=vertex` (not the stub), no `log` message or push provider, no `DEV_NOW`;
- `HELPDESK_PROVIDER=vertex` (not the stub, which is not an AI, or `none`);
- `STORAGE_PROVIDER=supabase` (the database document store is for development only);
- `LAUNCH_APPROVED=true`, a human attestation set only after [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) is signed off. It is never set in staging, CI, `.env.example` or `.env`.

### 4.7 Other protections

| Protection | How |
|---|---|
| Supabase Data API closed | Migration 0005: RLS on every table with no policies; `anon` and `authenticated` hold no privileges. All access goes through the API. |
| Function hijacking | Migration 0006 and every later function pin `search_path = public, pg_temp`. |
| Open redirects | Any return path from a URL goes through `safeReturnPath` with an allow-list (`WEB_RETURN_PATHS`, `CONSOLE_RETURN_PATHS`). |
| CSV/formula injection | Imports reject formula prefixes; any export must use `platform/csv-export.ts`. |
| Rate limits | Registration, activation and Help Desk questions are rate-limited per minute (configurable). The emergency endpoint is never rate-limited. |
| AI Help Desk | Scoped server-side tools only; deterministic emergency, human-request and injection checks before the model; structured output; answers containing contact details or identifiers not in the data given to the model are blocked and audited (TBD-54). |
| Files | Uploads are checked against their declared type (PDF, PNG, JPEG; 10 MB). Files are never public: a viewer gets a 60-second link after an audience check; a document outside their audience is "not found". |
| Untrusted text | Event information and notices are shown as plain text, never as HTML; map links must be `https://`. |
| Time | All dates are shown in IST (Asia/Kolkata). `DEV_NOW` pins the clock in local development only. |

---

## 5. Data model

### 5.1 Tables by area

| Area | Tables | Key rules (DC = data constraint in the PRD) |
|---|---|---|
| Editions | `event_editions` | 2026 and 2027; dates, deadline, selection limit and the application form are data |
| Identity | `user_accounts`, `role_grants`, `edition_access`, `activation_tokens`, `phone_identities` | Activation guards (0003); single-use hashed codes |
| Startups | `startups`, `startup_memberships` | One leader per startup (unique index) |
| Registration and selection | `applications`, `selection_decisions`, `decision_corrections` | One application per startup per edition; released decisions immutable except an applied two-person correction (DC-02, TBD-37) |
| Imports | `import_batches`, `import_rows` | Validate → preview → commit |
| AI ranking | `criteria_sets`, `ranking_runs`, `ranking_results` | Approved criteria frozen; runs use an approved set of their own edition |
| Jury | `scoring_rubrics`, `jury_assignments`, `evaluations`, `pitch_slots` | Approved rubrics frozen; submitted evaluations locked (DC-10); one live pitch and one slot per startup per edition |
| Volunteers | `assignment_runs`, `volunteer_assignments` | Exactly one target per assignment; one open assignment per volunteer and per target (DC-04…06); history never overwritten (DC-07); one draft run per edition |
| Event information | `content_items`, `content_versions`, `documents`, `document_blobs` (development store only) | Live content changes only by publishing a new version; versions append-only; schedule and meal days within the event days; documents replaced, never edited; nothing deleted |
| Notices and push | `notices`, `notice_groups`, `notice_group_members`, `push_tokens` | A notice keeps its audience, edition and push choice; withdrawn notices are final; group members must take part in the edition; one account per device token |
| Messages | `notifications` | In-app and outbox (email, SMS, push) with status (`queued`, `sent`, `failed`, `cancelled`), provider reference, receipt check and idempotency key; notice rows link to their notice |
| Audit | `audit_events` | Append-only (DC-13) |
| Help Desk | `helpdesk_conversations`, `helpdesk_messages` | One conversation per person, channel and edition; app conversations need an account; messages append-only (deleted only by retention) |
| Support | `support_tickets`, `ticket_events`, `support_alerts`; `event_editions.support_policy` | Four statuses only (DC-08); lifecycle, final resolution, priority/emergency only raised, escalation never withdrawn, staff-only acknowledgement and assignment (trigger); history and alerts append-only; one alert per recipient, reason and round; policy checked |

### 5.2 Migrations

Migrations are **forward-only and checksummed**: `migrate.ts` refuses to run if an applied file was edited (line endings are normalised first). A change is always a new migration.

| File | Purpose | On staging |
|---|---|---|
| `0001_foundation.sql` | Editions, identity, roles, startups, applications, decisions, notifications, audit | ✅ |
| `0002_operations.sql` | Tables for later milestones, created early so their rules are enforced and tested | ✅ |
| `0003_activation_guards.sql` | Database backstops for account activation | ✅ |
| `0004_accounts_imports.sql` | Imports, activation codes, account administration | ✅ |
| `0005_lockdown_data_api.sql` | Close the Supabase Data API | ✅ |
| `0006_function_search_path.sql` | Pin `search_path` on functions | ✅ |
| `0007_application_form.sql` | Application form as edition configuration (TBD-39) | ✅ |
| `0008_ranking_selection.sql` | AI ranking, ranking worker role, override reasons, corrections, withdrawal, outbox | ✅ |
| `0009_ranking_worker_set_role.sql` | Let the non-superuser API role `SET ROLE sj_ranking_worker` | ✅ |
| `0010_jury_volunteers.sql` | Jury and volunteer rules, rubric v1 draft, history | ✅ (15 Oct 2026) |
| `0011_event_content_notices.sql` | Event information drafts and versions, documents, groups, notice rules, push devices and delivery, tentative 2026 programme (drafts) | ❌ not yet (applied with the staging deployment) |
| `0012_helpdesk_support.sql` | Support policy per edition, Help Desk conversations and messages, ticket model and lifecycle trigger, append-only history, support alerts | ❌ not yet (staging changes need authorisation) |

How to apply to staging is in [STAGING.md](STAGING.md).

---

## 6. Features

Each feature lists its status, rules, screens, API and tests. "Decision" means a recorded default in [DECISIONS.md](DECISIONS.md); most still await approval.

### 6.1 Editions and the public website

- **Status:** built.
- `GET /v1/public/editions` returns each edition with dates and a **server-computed** registration window, plus the application form questions.
- 2026 registration closes **5 Nov 2026, 23:59:59 IST, inclusive** (TBD-11). 2027 stays open until Management sets a deadline (TBD-05).
- The website (`apps/web`) has: home, programme and event information (Phase 7), registration, status, sign-in, activation and the draft privacy notice. Privacy text is a draft awaiting Legal (TBD-32).

### 6.2 Startup registration

- **Status:** built (website and app).
- An applicant registers a new startup for **2026, 2027 or both**. "Both" creates two independent applications in one transaction: all or nothing.
- The form's six questions come from edition configuration (TBD-39) and are frozen once applications exist. No uploads or links apart from an optional website. Answers are validated against the configuration; unknown keys are rejected.
- Applicants confirm they are **18 or older** (TBD-45). No date of birth is stored.
- **Duplicates:** one startup per leader account and one application per startup per edition (blocked, also by a unique constraint and safe under simultaneous submits). A matching normalised startup name is **flagged** for Management, not blocked (TBD-15).
- The deadline is enforced on the server, including direct API calls.
- Applicants see only `under_review`, `selected`, `not_selected` or `withdrawn`. Internal states and unreleased drafts show as `under_review`; AI scores are never shown (TBD-44).
- **Tests:** `registration.test.ts`, `application-form.test.ts`; browser: `e2e_smoke.py`, `e2e_mobile.py`.

### 6.3 Management review, selection and release

- **Status:** built (console).
- **Internal statuses:** `submitted` → `under_ai_evaluation` → `ranked` or `flagged_manual_review` → `decision_drafted` → `selected` / `not_selected`; `withdrawn` by the applicant.
- Management drafts a decision per application, then **releases** them. Only release changes what applicants see, grants event access to selected startups, and sends the result (in-app plus email/SMS, TBD-14).
- Decisions, drafts and releases are refused while that edition's registration is open (`409 registration_open`, TBD-42).
- **Selection limit:** configurable per edition. Drafting is never blocked; a release above the limit needs explicit, audited confirmation (`confirmOverLimit`, TBD-19).
- **Override reasons** (TBD-18): selecting below the cut line or not selecting within it needs a written reason; the rank, the line and the override flag are stored with the decision.
- The 2026 and 2027 applications of one startup never affect each other.
- **Tests:** `selection.test.ts`, `ranking.test.ts`; browser: `e2e_smoke.py`, `e2e_ranking.py`.

### 6.4 Corrections and withdrawals

- **Status:** built.
- A released decision changes only through a **correction** with a written reason, approved by a **second** Management member (TBD-37). The rule is enforced in the API, by a check constraint and by a trigger. Edition access follows the corrected outcome, and the applicant is told again.
- Applicants can withdraw one year's application (website or app) until that year's event starts. A withdrawn application leaves ranking and decisions.
- **Tests:** `corrections.test.ts`; browser: `e2e_ranking.py`, `e2e_mobile.py`.

### 6.5 Admin: imports, accounts and activation

- **Status:** built (console).
- **CSV import** of predefined startups, jury members, volunteers and delegates for one edition: validate → preview → commit. Column set v1 (TBD-41): every row has `full_name` plus email and/or mobile; startup rows add `startup_name` and `position` (leader or member).
- Errors are reported per row and field. Duplicates within the file and against existing records are detected; shared mobile numbers are flagged; password columns, shifted columns, control characters, oversized cells and formula prefixes are rejected.
- Imported people get the edition's role and access, and start as `pending_activation`.
- **Accounts:** search, view, grant and revoke roles (global or per edition), deactivate and reactivate, issue an activation code. When the person's channel has a provider, the code goes into the outbox and the Admin never sees it; otherwise it is shown once for manual hand-over (TBD-13).
- **Tests:** `imports.test.ts`, `accounts.test.ts`, `security.test.ts`; browser: `e2e_admin.py`.

### 6.6 Mobile app

- **Status:** built for Android, iOS and web export; **not submitted to stores** (needs organisation-owned accounts, TBD-36).
- Screens: sign-in (email or mobile), activation, role-aware home, event information (Phase 7), registration, per-year status and withdrawal, messages and notices with read marking (Phase 7), jury (Phase 6), volunteer (Phase 6), **Emergency, Help and My requests (Phase 8)**. An Emergency button is in the header of every screen. Staff are pointed to the console.
- **Push** (Phase 7): after sign-in the app asks for notification permission and registers its Expo push token; sign-out removes it. Needs a development or store build with an EAS project; it quietly does nothing in web builds, simulators and Expo Go on Android.
- **Not built:** sign-out on the first launch after a reinstall (OD-02). Required before store submission.
- **Tests:** `apps/mobile/lib/*.test.ts` (keychain chunking, scoring helpers, emergency contacts, offline cache and retries); browser: `e2e_mobile.py`, `e2e_jury_volunteers.py`; real devices: [DEVICE_TEST_PROTOCOL.md](DEVICE_TEST_PROTOCOL.md) (not yet run on live staging).

### 6.7 AI ranking

- **Status:** built; live model not verified (needs the Google Cloud account, TBD-35).
- **Criteria sets** (TBD-01): versioned. Draft v1 ships unapproved: five criteria, 20 % each, scored 1–5. Management creates and approves versions; approved versions are frozen.
- **Runs:** Management starts a run over the **whole edition** after its registration closes. The worker sends each application **as data only**: no names, contacts or links, and contact details inside answers are redacted. Embedded instructions are flagged (`possible_prompt_injection`), never obeyed.
- The model returns text only. The worker validates it (one in-range integer per criterion), retries once, and otherwise flags the application for manual review (`ai_output_invalid`, `ai_unavailable`, `missing_data`). Totals and ranks are computed **outside** the model.
- **The AI cannot decide:** every worker statement runs as the database role `sj_ranking_worker`, which cannot write decisions, read accounts or contact data, or move an application outside the AI-evaluation states (AT-11).
- **Providers:** `vertex` (optionally with a ranking-only service account) or `stub` for development. The stub is **not an AI**, is labelled in the console and is refused in production.
- `pnpm --filter @sj/api ranking:eval` checks a provider on synthetic applications (schema validity, stability, steering resistance, ordering).
- **Console:** AI ranking page (criteria, approval, runs) and run page (ranks, criterion scores, explanations, flags, cut line).
- **Tests:** `ranking.test.ts`, `ranking-model.test.ts`, `ranking-eval.test.ts`, `ranking-role-grant.test.ts`; browser: `e2e_ranking.py`.

### 6.8 Messages: in-app and the email/SMS/push outbox

- **Status:** built; live providers not verified (TBD-35, TBD-52).
- **In-app** notices are written with status `sent` (they are in the inbox at once).
- **Email/SMS** messages are written to the `notifications` outbox **in the same transaction** as the event that causes them, then delivered by the worker with retries (up to 6 attempts with backoff). One message per person: email if they have one, otherwise SMS.
- **Truthful status:** without a configured provider a message stays `queued`; it is never reported as sent. Management sees each message's status.
- SMS uses DLT templates by id (`MSG91_TEMPLATE_*`) and carries no outcome, only a prompt to sign in. A missing template id fails the message rather than sending something else. Activation codes are scrubbed from the outbox after delivery.
- **Push** (Phase 7) uses the same outbox: one row per device, sent through the Expo push service. "Sent" means Expo accepted it (a ticket); the worker checks the receipt about 15 minutes later and marks failures; a device that no longer exists fails at once and is disabled. A notice withdrawn before sending cancels its queued pushes (`cancelled`).
- Idempotency keys make re-sends harmless.
- Message wording is **draft** (TBD-14, TBD-48).
- **Tests:** `outbox.test.ts`, `notices.test.ts`, plus status checks in selection, correction and volunteer tests.

### 6.9 Jury evaluation (Phase 6)

- **Status:** built (API, console, app).
- **Rubric** (TBD-43, awaiting Management): versioned. Draft v1 ships **unapproved** for 2026 and 2027: innovation, feasibility, scalability, market relevance, impact and pitch delivery, integers 1–10, equal relative weights, comments allowed. Jurors cannot score until Management approves a version (`409 no_rubric`). Approved versions are frozen by a trigger.
- **Total:** weights are relative (a parameter counts weight ÷ sum of weights). The server computes a 0–100 total, normalised per parameter range, and stores the rubric version with each evaluation.
- **Rubric changes** (TBD-50): submitted evaluations keep their version; drafts and reopened evaluations use the latest approved version when next saved.
- **Assignments** (TBD-20): Management assigns jurors to startups one by one. The API and a trigger check that both take part in the edition. An assignment with an evaluation cannot be removed.
- **Juror scope** (AT-16): a juror sees only their assigned startups, the pitch schedule and the startup currently pitching. Any other profile returns 404. Profiles show founders' names and the edition's application answers, **with no contact details and no AI data**. Scoring is limited to assigned startups.
- **Scoring** (AT-17): save a draft; submit when every parameter has an in-range whole number. A submitted evaluation is **locked** (API and trigger). Only Management can **reopen** one, with a written reason; the audit keeps the previous scores. Two simultaneous submissions of one assignment produce one evaluation. Each juror sees only their own scores.
- **Pitch schedule** (TBD-21): one slot per startup. Starting a pitch finishes any other live pitch of the edition in the same transaction (also a unique index).
- **Review** (AT-18): per-startup averages per rubric version, and the submitted evaluations. **No winner is computed.**
- **Separation from AI ranking and selection:** no ranking, selection or release code reads jury data; `sj_ranking_worker` has no privilege on any jury table; tests show scoring changes no application, decision or ranking row.
- **Console:** Jury page (rubrics, assignments, pitch schedule, review, reopen). **App:** jury list with the current pitch, startup profile and scoring form.
- **Tests:** `jury.test.ts` (26 cases), `schema.test.ts`; browser: `e2e_jury_volunteers.py`.

### 6.10 Volunteer assignment (Phase 6)

- **Status:** built (API, console, app).
- **Pool** (TBD-22, awaiting Management): every startup whose leader has access to the edition, plus every jury member of the edition, without an open volunteer. **No priority.**
- **Generation:** Admin or Management (TBD-47) generates a run. Volunteers and targets are shuffled with a **seeded, unbiased shuffle** (HMAC-SHA256 stream, Fisher–Yates with rejection sampling) and paired one-to-one. The seed and the sorted inputs are stored, so a run can be reproduced. A person is never paired with themselves.
- **Shortage and surplus:** remaining targets are listed as **unassigned**; extra volunteers are listed as surplus. Nobody is ever doubled up (AT-20).
- **Draft review** (AT-23): a run is a draft that participants cannot see. Only Management saves it (activating the pairs and notifying both sides) or discards it. One draft per edition.
- **Changes** (TBD-23, Management only): assign a free volunteer to an unassigned target by hand (reason required); **reassign** (the old row is closed with actor, time and reason; a new row points back to it with `replaces_id`); **end** an assignment (the target becomes unassigned again). Closed rows cannot be changed or deleted.
- **Database guarantees** (AT-21): exactly one target per assignment (check constraint); at most one open assignment per volunteer, per startup and per jury member (unique indexes); eligibility checked by a trigger.
- **Concurrency:** every mutation locks the edition row, so simultaneous generate, save, assign and reassign requests run one at a time; unique indexes are the backstop. Tested with simultaneous requests.
- **Messages** (TBD-48): in-app plus one email/SMS to the volunteer and to the target (startup leader or jury member) when an assignment starts, changes or ends. The console shows each message's recorded status.
- **What participants see** (TBD-49, awaiting Management and Legal): a volunteer sees their saved assignment with the coordinating person's name and mobile number; a startup leader or juror sees their volunteer's name and mobile number. Never email addresses.
- **Console:** Volunteers page (generate, draft review with shortage and surplus, save, current assignments with message statuses, reassign, end, assign by hand, history, runs). **App:** "My volunteer assignment" and "My volunteer".
- **Tests:** `volunteers.test.ts` (28 cases including shuffle unit tests and concurrency), `schema.test.ts`; browser: `e2e_jury_volunteers.py`.

### 6.11 Event information (Phase 7)

- **Status:** built (API, console, website, app).
- **Types:** schedule items (day, start and end time, venue, details, "tentative", order), venues (address, https map link, notes), food (day, meal, times, venue, menu), accommodation, travel, safety guidelines, emergency contacts and information pages. Each body is validated by type; unknown fields are refused.
- **Who edits** (TBD-24): the Admin edits safety guidelines, emergency contacts and pages; Management edits the schedule, venues, food, accommodation and travel. Both read everything in the console. Enforced per type on the server (`403 content_not_yours`).
- **Drafts and versions** (FR-EVT-16, TBD-53): every edit is a draft that nobody else sees; publishing needs a change summary and creates version n+1 (who, when, what changed); drafts can be discarded; items are archived, never deleted. A trigger allows the live version to change only by a publish.
- **Audiences** (FR-EVT-17): public, all participants of the edition, or participant roles. The website shows public items; the app shows public items plus what the person's edition access and roles allow.
- **One copy everywhere** (FR-EVT-01, -02, AT-24): website and app read the same published data with a "last updated" time; a change needs no release.
- **Dates** (FR-EVT-03, AT-37): days come from the edition, with 17 December 2026 labelled "Pre-event day". Days outside the event are refused (API and trigger).
- **Seeded programme** (TBD-06): the RQ §2 programme as unpublished drafts marked "Tentative", with no invented times or venues.
- **Emergency** (TBD-07): 112 is always first, not editable; the Admin adds venue numbers.
- **Console:** Event info page (type tabs, drafts, publish with summary, history, archive). **Website:** Programme page. **App:** Event information screen with tap-to-call.
- **Tests:** `content.test.ts`; browser: `e2e_event_notices.py`.

### 6.12 Documents (Phase 7)

- **Status:** built; the Supabase Storage bucket is not yet verified live (TBD-51).
- The Admin uploads PDF, PNG or JPEG files up to 10 MB with a title, description and audience. The server checks the file's first bytes against its type and records its size and SHA-256.
- A new version replaces the old one (the old one is archived and kept); documents are never edited (trigger).
- Viewers get a **60-second link** after an audience check (`GET …/documents/:id/link`); an out-of-audience, archived or other-edition document is "not found". Staff can open any document from the console.
- Storage adapters: `supabase` (private bucket, signed URLs) for staging and production; `database` for development and tests, whose links are signed by the API (`/v1/files/<id>.<expiry>.<signature>`) and refused in production.
- **Tests:** `content.test.ts` (including the Supabase request format); browser: `e2e_event_notices.py`.

### 6.13 Notices and push notifications (Phase 7)

- **Status:** built; push not verified on real devices (TBD-52).
- **Audiences** (FR-NOT-01, TBD-29): everyone taking part in the edition, one or more participant roles, or one authorised group. Recipients are worked out on the server within the edition: unrevoked access, a matching role or membership, not deactivated (FR-NOT-05, AT-09). Staff and applicants without access get nothing. An audience with nobody in it is refused.
- **Before publishing:** Management checks the recipient count and how many have the app with notifications on.
- **Delivery** (FR-NOT-02, -04): each recipient gets an in-app notice; with push, one push per device registered at that moment. The console shows inbox reach and opens, and push status per device.
- **Corrections and withdrawals** (FR-NOT-06, TBD-53): the text can be corrected with a reason (inboxes and unsent pushes show the new text); the audience cannot change. A withdrawal hides the notice from inboxes and cancels unsent pushes. Both are audited; notices are never deleted (trigger).
- **Authorised groups** (FR-NOT-08): named per edition by Management; only participants of the edition can be members (API and trigger).
- **Devices:** the app registers its token after sign-in (`POST /v1/me/push-tokens`) and removes it at sign-out; a token belongs to the account last signed in on that device.
- **Console:** Notices page (compose, recipient check, delivery figures, correct, withdraw, groups). **App:** notices in Messages, marked read when opened.
- **Tests:** `notices.test.ts` (17 cases including Expo request format, receipts and permanent failures); browser: `e2e_event_notices.py`.

### 6.14 Emergency control (Phase 8)

- **Status:** built; venue emergency numbers not yet supplied (TBD-07, awaiting Organisers).
- **Always reachable** (FR-HD-10, TBD-55): an Emergency button in the header of every app screen, signed in or not. Its screen shows **Call 112** first; nothing is awaited before it can be pressed, offline included. The Admin-published emergency contacts follow, cached on the device from the last load. No number is ever invented.
- **Alerting the team** (FR-HD-11, AT-31): a second, explicit tap with an optional description raises a high-priority emergency ticket and alerts every active Customer Support account (Management if none is active). The response always carries the contacts, 112 first; if the ticket cannot be recorded the person is told and still sees 112. Retries reuse one request id (same ticket). One open emergency per person: a new report is added to it and re-alerts at once. Concurrent reports from one person open one ticket (advisory lock).
- **Help Desk path:** emergency wording in the chat gets the same 112-first answer and ticket without any model call.
- **Tests:** `support.test.ts` (emergency control), `helpdesk.test.ts` (AT-31), `apps/mobile/lib/emergency.test.ts`; browser: `e2e_support.py` (offline, then online).

### 6.15 AI Help Desk in the app (Phase 8)

- **Status:** built; **live model not verified** (Vertex AI account, TBD-35). The development `stub` is not an AI and is labelled as such in the app. **WhatsApp is not part of this build** (separate workstream).
- **Sources** (FR-HD-05…07, -13, -14, TBD-54): server-side tools, each checking role and edition access and taking no identifier from the question: published event information for the person's audience, emergency contacts, and the person's own application status, startup, volunteer or assignment, jury schedule (own evaluations' state only) and tickets. No tool reads AI ranking data, others' scores, contacts or applications.
- **Order of checks:** emergency wording → 112 and the emergency path; "talk to a person" → ticket; injection or data-extraction wording → fixed refusal (audited `helpdesk.request_refused`); then the tools and the model.
- **Model:** fixed instructions; tool results passed as data; JSON output (`answer`, `outcome`). Invalid output, timeout, provider error or no provider → fallback answer with "Ask a person". Output leak check: a phone number, email or identifier not present in the data given → blocked (audited `helpdesk.output_blocked`). Separate `HELPDESK_*` configuration and service account (FR-HD-20).
- **Ask a person** (FR-HD-08, AT-30): one open ticket per conversation, with the transcript (questions and answers only) visible to support.
- **Records:** conversations per person and edition; messages append-only; per-person rate limit.
- **Tests:** `helpdesk.test.ts` (24: own-data answers, isolation between people and editions, injection, blocked leaks, provider failures, rate limit, escalation, emergency); browser: `e2e_support.py`.

### 6.16 Support tickets and the Customer Support dashboard (Phase 8)

- **Status:** built. Windows, escalation contacts and roster awaiting Organisers (TBD-27, TBD-28).
- **Raising tickets:** from the app ("My requests" or the Help Desk), from the emergency control, or by support staff for a caller or walk-in (FR-SUP-14), linked to an account only by exact email or mobile match.
- **Lifecycle** (DC-08, TBD-56, AT-32): Open → Acknowledged → In Progress → Resolved, or Acknowledged → Resolved. Concurrent acknowledgements: one succeeds, the other gets 409. Resolution needs notes and is final. Priority and the emergency flag only go up. Assignment only to active Customer Support. Escalation to Management is an attribute that cannot be withdrawn. Database trigger plus API.
- **Workspace** (FR-SUP-02…11): requester name, email, mobile, roles and own startup only (every view audited `support.ticket_viewed`); description; Help Desk transcript; full history; internal notes; replies to the requester (in-app notification); contact log; manual escalation; priority raise.
- **Alerts and escalation** (FR-SUP-13, TBD-27, TBD-57): new urgent tickets alert every support person; a worker sweep re-alerts unacknowledged urgent tickets (defaults: emergency every 1 min, high every 10 min, at most 20 rounds), escalates them to all active Management at the window (defaults 5 and 30 min; recorded with no human actor) and flags normal tickets overdue once (default 120 min). Each ticket is row-locked while swept. Defaults are configuration awaiting approval; no working-day calendar, duty-lead role or SMS alerts are built.
- **Roles:** Customer Support works tickets; Management reviews read-only, sees alerts and sets the windows per edition (audited); the Admin has no access. Requesters see only their own tickets, status changes and replies, never internal notes.
- **Console:** Support page (queue, alert banner with 15-second polling, raise for a caller, windows for Management) and ticket page. **App:** My requests.
- **Tests:** `support.test.ts` (26, including concurrent acknowledgement, concurrent sweeps and the acknowledge-versus-sweep race); browser: `e2e_support.py`.

---

## 7. API reference

All routes are under `/v1`, JSON, with a Bearer token unless marked public. Guards: **auth** (valid token, active account), **perm** (permission), **edition** (access to `:year`).

### Public and own account

| Method | Path | Guard |
|---|---|---|
| GET | `/healthz` | public |
| GET | `/v1/public/editions` | public |
| POST | `/v1/me/registrations` | `registration.submit` (rate-limited) |
| GET | `/v1/me/applications` | `application.read_own` |
| POST | `/v1/me/applications/:id/withdraw` | `application.withdraw_own` |
| GET | `/v1/me/notifications` | `notification.read_own` |
| POST | `/v1/me/notifications/:id/read` | `notification.read_own` (own messages only) |
| POST / DELETE | `/v1/me/push-tokens` | `push.register_own` |
| GET | `/v1/public/editions/:year/event`, `/v1/public/editions/:year/documents/:id/link` | public (public items only) |
| GET | `/v1/editions/:year/event`, `/v1/editions/:year/documents/:id/link` | auth + edition (filtered by audience) |
| GET | `/v1/files/:token` | the signed token (development document store only) |
| GET | `/v1/me` | auth (pending accounts allowed) |
| POST | `/v1/me/activation` | auth, pending account (rate-limited) |
| GET | `/v1/editions/:year/me` | auth + edition |
| POST | `/v1/dev/session` | development only, refused in production |

### Admin

| Method | Path | Permission |
|---|---|---|
| GET | `/v1/admin/users`, `/v1/admin/users/:id` | `user.read` |
| POST / DELETE | `/v1/admin/users/:id/roles`, `/v1/admin/users/:id/roles/:grantId` | `role.assign` |
| POST | `/v1/admin/users/:id/deactivate`, `/reactivate` | `user.manage` |
| POST | `/v1/admin/users/:id/activation` | `activation.issue` |
| GET | `/v1/admin/imports`, `/v1/admin/imports/:id`, `/v1/admin/imports/templates/:category` | `import.manage` |
| POST | `/v1/admin/imports`, `/v1/admin/imports/:id/commit`, `/discard` | `import.manage` |

### Management: applications, decisions and corrections

| Method | Path | Permission |
|---|---|---|
| GET | `/v1/manage/editions/:year/applications`, `/v1/manage/applications/:id` | `application.read_all` |
| PUT / DELETE | `/v1/manage/applications/:id/decision` | `decision.draft` |
| POST | `/v1/manage/editions/:year/decisions/release` | `decision.release` |
| PUT | `/v1/manage/editions/:year/selection-limit` | `selection_limit.configure` |
| GET | `/v1/manage/editions/:year/corrections` | `decision.correct` |
| POST | `/v1/manage/applications/:id/corrections`, `/v1/manage/corrections/:id/approve`, `/reject`, `/cancel` | `decision.correct` |

### Management: AI ranking

| Method | Path | Permission |
|---|---|---|
| GET | `/v1/manage/editions/:year/criteria-sets` | `ranking.read` |
| POST | `/v1/manage/editions/:year/criteria-sets`, `/v1/manage/criteria-sets/:id/approve` | `criteria.manage` |
| GET | `/v1/manage/editions/:year/ranking-runs`, `/v1/manage/ranking-runs/:id` | `ranking.read` |
| POST / PUT | `/v1/manage/editions/:year/ranking-runs`, `/v1/manage/ranking-runs/:id/cut-line` | `ranking.run` |

### Management: jury

| Method | Path | Permission |
|---|---|---|
| GET | `/v1/manage/editions/:year/jury` | `jury.manage` |
| POST | `/v1/manage/editions/:year/rubrics`, `/v1/manage/rubrics/:id/approve` | `jury.manage` |
| POST / DELETE | `/v1/manage/editions/:year/jury-assignments`, `/v1/manage/jury-assignments/:id` | `jury.manage` |
| POST / PUT / DELETE | `/v1/manage/editions/:year/pitch-slots`, `/v1/manage/pitch-slots/:id` | `jury.manage` |
| POST | `/v1/manage/pitch-slots/:id/start`, `/finish` | `jury.manage` |
| GET | `/v1/manage/editions/:year/evaluations` | `jury.review` |
| POST | `/v1/manage/evaluations/:id/reopen` | `jury.review` |

### Jurors

| Method | Path | Guard |
|---|---|---|
| GET | `/v1/editions/:year/jury` | `jury.evaluate` + edition |
| GET | `/v1/editions/:year/jury/startups/:startupId` | `jury.evaluate` + edition + assigned or currently pitching |
| PUT | `/v1/editions/:year/jury/startups/:startupId/evaluation` (draft) | `jury.evaluate` + edition + assigned |
| POST | `/v1/editions/:year/jury/startups/:startupId/evaluation/submit` | `jury.evaluate` + edition + assigned |

### Volunteers

| Method | Path | Permission |
|---|---|---|
| GET | `/v1/manage/editions/:year/volunteers`, `/v1/manage/volunteer-runs/:id` | `volunteer.read` |
| POST | `/v1/manage/editions/:year/volunteer-runs`, `/v1/manage/volunteer-runs/:id/discard` | `volunteer.generate` |
| POST | `/v1/manage/volunteer-runs/:id/approve` | `volunteer.review` |
| POST | `/v1/manage/editions/:year/volunteer-assignments`, `/v1/manage/volunteer-assignments/:id/reassign`, `/close` | `volunteer.reassign` |
| GET | `/v1/editions/:year/volunteer/assignment` | `volunteer.my_assignment` + edition |
| GET | `/v1/editions/:year/me/volunteer` | `volunteer.my_volunteer` + edition |

### Event information and documents (Admin and Management)

| Method | Path | Guard |
|---|---|---|
| GET | `/v1/manage/editions/:year/content`, `/v1/manage/content/:id/versions`, `/v1/manage/documents/:id/link` | `content.read_all` |
| POST / PUT | `/v1/manage/editions/:year/content`, `/v1/manage/content/:id` | `content.read_all` + edit right for the type (TBD-24) |
| POST | `/v1/manage/content/:id/publish`, `/discard-draft`, `/archive` | `content.read_all` + edit right for the type |
| POST | `/v1/manage/editions/:year/documents`, `/v1/manage/documents/:id/archive` | `content.read_all` + `content.manage_source` |

### Notices (Management)

| Method | Path | Permission |
|---|---|---|
| GET / POST | `/v1/manage/editions/:year/notices`, `/v1/manage/editions/:year/notices/preview` | `notice.publish` |
| PUT | `/v1/manage/notices/:id` (correct text, reason required) | `notice.publish` |
| POST | `/v1/manage/notices/:id/withdraw` | `notice.publish` |
| POST / DELETE | `/v1/manage/editions/:year/notice-groups`, `/v1/manage/notice-groups/:id/members`, `/v1/manage/notice-groups/:id/members/:userId` | `notice.publish` |

### Help Desk, own tickets and emergency

| Method | Path | Guard |
|---|---|---|
| POST | `/v1/helpdesk/messages` | `helpdesk.use` + account (rate-limited per person) |
| GET | `/v1/helpdesk/conversation?edition=` | `helpdesk.use` + account (own conversation only) |
| POST | `/v1/helpdesk/conversations/:id/escalate?edition=` | `helpdesk.use` + account (own conversation only) |
| POST | `/v1/editions/:year/emergency` | `emergency.report` (no edition or role gate, never rate-limited) |
| GET / POST | `/v1/me/tickets` | `support.request_own` + account |
| POST | `/v1/me/tickets/:id/notes` | `support.request_own` (own tickets only) |

### Customer Support and Management

| Method | Path | Permission |
|---|---|---|
| GET | `/v1/support/tickets`, `/v1/support/tickets/:id`, `/v1/support/editions/:year/policy` | `support.handle` or `support.review` |
| POST | `/v1/support/tickets`, `/:id/acknowledge`, `/status`, `/assign`, `/notes`, `/contact`, `/escalate`, `/priority` | `support.handle` |
| GET | `/v1/support/requesters?q=` (exact email or mobile) | `support.handle` |
| GET / POST | `/v1/support/alerts`, `/v1/support/alerts/:id/seen` | `support.alerts` (own alerts only) |
| PUT | `/v1/manage/editions/:year/support-policy` | `support.configure` |

Request and response shapes: `packages/contracts/src/index.ts`. Typed calls: `packages/client/src/index.ts`.

---

## 8. Background workers

- Four jobs: **AI ranking runs**, the **email/SMS/push outbox**, (with `PUSH_PROVIDER=expo`) an **Expo receipt check** about once a minute, and the **support sweep** (re-alerts, automatic escalation, overdue flags; one row lock per ticket). The domain tables are the queues (`ranking_runs`, `notifications`), claimed with `FOR UPDATE SKIP LOCKED`, so several workers can run side by side.
- They run inside the API process (`RUN_WORKERS=true`) or as a separate process (`pnpm --filter @sj/api start:worker`) for hosts that throttle CPU between requests.
- At start-up the workers check that the database user can switch to `sj_ranking_worker` and log an error if not (the problem migration 0009 fixed on staging).

---

## 9. Testing and verification

| Layer | What | Where |
|---|---|---|
| API integration and unit | Vitest on **real PostgreSQL**, a fresh database per test file. Every permission and rule has a test; tests cite PRD acceptance tests (AT-xx). | `apps/api/test/*.test.ts` (27 files) |
| Mobile unit | Pure app logic: keychain chunking, scoring helpers, emergency contacts and retries | `apps/mobile/lib/*.test.ts` |
| Browser end-to-end | Playwright (Python) against the real API, website, console and the app's web build | `scripts/e2e_*.py` |
| Real devices | Session, refresh, sign-out, MFA, push and event-information checks on Android and iOS (D1–D14) | [DEVICE_TEST_PROTOCOL.md](DEVICE_TEST_PROTOCOL.md) (not yet run against live staging) |
| Staging server side | OTP sessions, refresh, revocation, linking refusal, TOTP | `pnpm --filter @sj/api staging:verify` (needs staging secrets; not yet run) |

**Browser flows:** `e2e_smoke.py` (website + Management), `e2e_admin.py` (import → activation), `e2e_phone.py` (mobile-number sign-in), `e2e_redirect.py` (open-redirect protection), `e2e_mfa.py` (staff MFA), `e2e_mobile.py` (app at phone size), `e2e_ranking.py` (ranking → override → release → two-person correction; needs a pinned clock), `e2e_jury_volunteers.py` (jury and volunteers in console and app; needs a freshly seeded database), `e2e_event_notices.py` (event information, documents and notices across console, website and app; needs a freshly seeded database), `e2e_support.py` (emergency offline then online, Help Desk refusal and escalation, acknowledge to resolve, Management read-only, Admin no access; needs `HELPDESK_PROVIDER=stub` and a freshly seeded database). Run commands are in the README.

**CI** (every push to `main`): frozen-lockfile install, typecheck of all workspaces, API tests on PostgreSQL, mobile unit tests, production builds, mobile web bundle. The browser flows run locally, not in CI.

**Last recorded verification (16 Oct 2026, commit `a18d52a`):** 435 of 435 API tests and 15 of 15 mobile tests passed; typecheck, frozen-lockfile install, builds and the mobile web export passed; all 10 browser flows (the 9 earlier ones plus `e2e_support.py`) passed, each against a fresh database. GitHub Actions `ci` run 38881778185 passed (install, typecheck, API tests on Postgres, mobile tests, builds, mobile bundle). The separate **Android APK** workflow (added in `6316d64`) fails at its "Set up Java" step on that commit and on `a18d52a`, before any app code is built; it is not caused by Phase 8 and is not fixed here.

**Previous (16 Oct 2026, commit `93ba3c0`):** 384 API and 8 mobile tests; 9 browser flows; GitHub Actions run 38849278393 passed.

---

## 10. Environments

### 10.1 Local development

```bash
pnpm install
bash scripts/dev-db.sh start        # local PostgreSQL on :54329, prints DATABASE_URL
cp .env.example .env                # AUTH_MODE=dev; replace DEV_AUTH_SECRET with your own value (>= 32 chars)
pnpm db:seed                        # migrations + development staff accounts (SEED_DEMO_APPLICATIONS=1 adds a synthetic cohort)
pnpm dev:api    # :4000
pnpm dev:web    # :3000
pnpm dev:console  # :3001
pnpm dev:mobile # Expo
```

Development staff sign-ins (dev mode only): `manager@dev.local`, `manager2@dev.local`, `admin@dev.local`, `support@dev.local`. The seed refuses to run with `NODE_ENV=production`.

### 10.2 Staging and production

- **Staging:** Supabase project `startup-jathara-staging` (ref `chiafggvergjwliqvlwv`, ISF organisation, Mumbai, PostgreSQL 17). Migrations 0001–0010 are applied with matching checksums; 0011 (Phase 7) and 0012 (Phase 8) are not applied yet, and the private document bucket does not exist yet. The API, website and console are **not hosted yet**; secrets and auth settings are still to be configured. Details and remaining steps: [STAGING.md](STAGING.md). The staging verifier only accepts approved project refs.
- **Production:** does not exist. Recommended hosting (TBD-46, awaiting budget): Cloud Run asia-south1 for the API and workers, Vercel for the web apps, Supabase ap-south-1. Accounts must be organisation-owned (TBD-36).

### 10.3 Environment variables

| Variable | Purpose |
|---|---|
| `NODE_ENV`, `PORT`, `LOG_LEVEL`, `CORS_ORIGINS` | Process basics; production requires HTTPS-only origins |
| `DATABASE_URL` | PostgreSQL connection (session mode on Supabase) |
| `AUTH_MODE`, `DEV_AUTH_SECRET` | `supabase` or `dev` (dev refused in production) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase Auth. The service-role key is a **server-side secret only**: never committed, never `NEXT_PUBLIC_*` or `EXPO_PUBLIC_*` |
| `REQUIRE_STAFF_MFA` | Staff MFA; forced on in production |
| `REGISTRATION_RATE_LIMIT`, `ACTIVATION_RATE_LIMIT`, `ACTIVATION_TTL_HOURS` | Limits and activation validity (default 72 h) |
| `RUN_WORKERS` | Run workers in the API process |
| `PUBLIC_WEB_URL` | Website address used in messages |
| `RANKING_PROVIDER`, `RANKING_VERTEX_PROJECT`, `RANKING_VERTEX_LOCATION`, `RANKING_VERTEX_MODEL`, `RANKING_VERTEX_ACCESS_TOKEN`, `RANKING_VERTEX_SERVICE_ACCOUNT` | AI ranking provider |
| `NOTIFY_EMAIL_PROVIDER`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `NOTIFY_EMAIL_FROM` | Email outbox (`none` keeps messages queued) |
| `NOTIFY_SMS_PROVIDER`, `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_RESULT`, `MSG91_TEMPLATE_CORRECTION`, `MSG91_TEMPLATE_ACTIVATION`, `MSG91_TEMPLATE_ASSIGNMENT` | SMS outbox with DLT template ids |
| `HELPDESK_PROVIDER`, `HELPDESK_VERTEX_PROJECT`, `HELPDESK_VERTEX_LOCATION`, `HELPDESK_VERTEX_MODEL`, `HELPDESK_VERTEX_ACCESS_TOKEN`, `HELPDESK_VERTEX_SERVICE_ACCOUNT`, `HELPDESK_RATE_LIMIT` | AI Help Desk: `stub` (development, not an AI; refused in production), `none` (fallback answers only; refused in production) or `vertex` with its own service account. Questions per person per minute (default 20) |
| `PUSH_PROVIDER`, `EXPO_ACCESS_TOKEN` | Push for notices: `none`, `log` (development only, refused in production) or `expo`. The access token is a server-side secret |
| `STORAGE_PROVIDER`, `STORAGE_BUCKET`, `FILE_LINK_SECRET` | Documents: `database` (development only, refused in production) or `supabase` (private bucket, default `event-documents`). `FILE_LINK_SECRET` signs the development store's links |
| `DEV_NOW` | Development only: pins the API clock |
| `LAUNCH_APPROVED` | Production launch attestation. Never set outside production, and only after sign-off |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_AUTH_MODE`, `NEXT_PUBLIC_SIGNIN_METHODS`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Website and console (public values only) |
| `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_AUTH_MODE`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_WEB_URL`, `EXPO_PUBLIC_SIGNIN_METHODS` | Mobile app (public values only, inlined at build time) |

---

## 11. Decisions that shape the build

Every former TBD has a recorded default in [DECISIONS.md](DECISIONS.md); most await Management, Organisers, Legal or Budget approval. The ones built into the code so far:

| Area | Decisions built |
|---|---|
| Registration | TBD-11 (deadline), TBD-12 (email and mobile sign-in), TBD-15 (duplicates), TBD-39 (form as configuration), TBD-45 (18+) |
| Selection | TBD-18 (override reasons), TBD-19 (limit confirmation), TBD-37 (corrections, withdrawal), TBD-42 (no ranking or decisions while registration is open), TBD-44 (no AI data to applicants) |
| Ranking | TBD-01 (criteria v1, unapproved), TBD-35 (adapters) |
| Messages | TBD-13 (activation delivery), TBD-14 (result channels), TBD-48 (volunteer messages) |
| Jury | TBD-20, TBD-21, TBD-43, TBD-50 |
| Volunteers | TBD-22, TBD-23, TBD-47, TBD-49 |
| Event information and notices | TBD-06 (tentative programme as drafts), TBD-07 (112 first), TBD-24 (who edits what), TBD-29 (in-app plus push, groups), TBD-51 (documents), TBD-52 (Expo push), TBD-53 (drafts, corrections, push timing) |
| Imports | TBD-41 (column set v1) |
| Help Desk, support and emergency | TBD-07 (112 first; venue numbers awaiting Organisers), TBD-27 (windows as configuration; partly: no working-day calendar, duty lead or event director), TBD-54, TBD-55, TBD-56, TBD-57. TBD-28 roster and SMS alerts **not built** |

---

## 12. Not built yet

| Item | Phase | Blocked on |
|---|---|---|
| WhatsApp Help Desk channel | separate workstream | Owned by another team; not in this repository's Phase 8 |
| Live Vertex AI Help Desk and an automated Help Desk evaluation | — | Vertex AI account (TBD-35) |
| Organiser-approved windows, escalation contacts (duty lead, event director), working-day calendar, support roster and SMS alerts to on-duty staff | — | Organisers (TBD-27, TBD-28); DLT template for alert SMS |
| Offline cache, reports and exports, audit view | 9 | TBD-31 |
| Security review, load test, restore drill, store submission, production release | 10 | Accounts (TBD-36), budget (TBD-46) |
| Sign-out after app reinstall (OD-02) | before store submission | — |
| Live Vertex AI, Amazon SES and MSG91 (with DLT templates) | — | Vendor accounts and contracts (TBD-35) |
| Live push on real devices; private Supabase Storage bucket on staging | — | EAS project and FCM/APNs credentials under organisation accounts (TBD-36, TBD-52); staging deployment (STAGING.md) |
| Publishing the final programme and venue emergency numbers | — | Organisers (TBD-06, TBD-07) |
| Hosted staging, `staging:verify` and the device protocol on live staging | — | Staging secrets and hosting (STAGING.md) |
| Approved privacy notice | — | Legal (TBD-32) |
| QR check-in, meal tracking, room allocation | not planned for 2026 | TBD-30 |
