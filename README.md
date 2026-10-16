# Startup Jathara Management Platform

**Built by Zeny2Labs for the International Startup Foundation (ISF) and GIET University**  
**Current delivery:** Phases 1–7 of 10 implemented  
**Production status:** **NOT APPROVED**  
**Latest reported repository commit:** `3cc51fe`

The Startup Jathara Management Platform supports event operations for Startup Jathara @ Dandakaranya, hosted at GIET University, Gunupur, Odisha. The 2026 event is scheduled for **18–20 December 2026**, with a pre-event day on **17 December 2026**. The platform supports year-specific workflows for the 2026 and 2027 editions.

This repository contains a working, tested application codebase for registration, account administration, AI-assisted ranking, jury evaluation, volunteer assignment, event information, documents, notices, and push-notification workflows. It is **not yet hosted as a complete environment**, and implemented integrations are not necessarily connected to live providers.

> [!CAUTION]
> **Do not deploy this application to production or enter real participant data.** The production launch gate is intentionally closed. Hosting, real authentication and messaging checks, privacy approval, operational sign-offs, security review, and other launch requirements remain outstanding. The API is designed to refuse production startup until required configuration and approvals are in place. See [the launch checklist](docs/LAUNCH_CHECKLIST.md).

## Project status

| Area | Current status |
|---|---|
| Foundation, API, database, roles, permissions and audit log | Implemented |
| Registration and Management selection workflow | Implemented |
| Admin imports, account activation and role management | Implemented |
| Cross-platform Android/iOS app foundation | Implemented; not in app stores |
| AI-assisted ranking and human-controlled decisions | Implemented; real model not connected |
| Jury evaluation and volunteer assignment | Implemented |
| Event information, private-document workflow, notices and push support | Implemented; live storage and push still need verification |
| Staging API, website and console hosting | Not hosted yet |
| Production deployment | Not approved |
| Real email/SMS provider delivery | Not verified live |
| Real AI ranking model | Not connected or evaluated against a live provider |
| In-app AI Help Desk, support tickets, Customer Support dashboard and emergency control | Implemented; real Help Desk model not connected; emergency numbers, windows and roster await organisers |
| WhatsApp Help Desk channel | Separate workstream (not in this repository's Phase 8) |
| Phase 9 offline mode, reports and audit view | Planned |
| Phase 10 security review, performance/recovery tests and launch | Planned |

### Latest reported verification

The Phase 7 delivery reports the following checks passing on **16 October 2026**:

- **384 API tests**.
- **8 mobile tests**.
- **9 browser end-to-end flows**, run against fresh databases.
- Type checks and production builds.
- GitHub Actions passed for the Phase 7 delivery.

These are the reported results for the checked code and test environments. They do **not** prove live email/SMS delivery, real AI quality, real-device push delivery, production deployment, or store approval. Re-run checks in your own environment before relying on them.

## Interfaces

The requirements define **five interfaces over one platform**:

1. **Public website** — event programme, startup registration, application status, activation and public information.
2. **Shared mobile app** — one Expo codebase for Android and iOS, with role-aware participant screens.
3. **Admin dashboard** — imported data, user accounts, access roles, official source information and documents.
4. **Management dashboard** — applications, ranking review, selection decisions, jury workflows, volunteer assignments, operational event information and notices.
5. **Customer Support dashboard** — ticket queue with emergencies first, live alerts, acknowledgement, assignment, replies, escalation and resolution (Phase 8). Management reviews it read-only.

The Admin and Management dashboards are sections of a single access-controlled console, not separate deployable applications. The API enforces permissions; hiding a screen or menu item is not a security boundary.

## Implemented capabilities

### Registration and selection

- Startup teams can apply for 2026, 2027 or both editions.
- Each edition has a separate application and status.
- Deadline checks are enforced server-side.
- Duplicate applications for the same startup and edition are blocked; possible name matches can be flagged for Management review.
- Management can review applications, draft decisions and release results.
- Unreleased decisions are not exposed to applicants.
- Release, correction and withdrawal workflows are audited.
- A released decision can be corrected only through the implemented reasoned, second-Management-approval workflow.
- The application form is configuration-driven and freezes once applications exist.

The 2026 registration cut-off is configured for **5 November 2026 at 23:59:59 IST**, but the organisers’ written confirmation remains a launch approval item. See TBD-11 in the [decision register](docs/DECISIONS.md).

### Admin, accounts and access control

- CSV import supports predefined startups, jury members, volunteers and delegates through validate → preview → commit.
- Import validation reports errors by row and field and detects duplicates and shared contact numbers.
- Imported accounts use single-use, time-limited activation codes; only code hashes are stored.
- Admins can manage roles, deactivate accounts and reactivate accounts within permission boundaries.
- Accounts must be active before protected roles and data are made available.
- Staff MFA is required for privileged users in production.
- Verified identity claims are checked against authoritative Supabase user records before account linking.

See the [security fix report](docs/SECURITY_FIX_2026-10-15.md) and [technical guide](docs/TECHNICAL_DESIGN_AND_FEATURE_GUIDE.md).

### AI-assisted startup ranking

- Management can create, version and approve ranking criteria.
- The example criteria set is seeded as an **unapproved draft**; ranking cannot run until Management approves a set.
- A ranking run covers an edition after that edition's registration closes.
- Applicant contact details are excluded from ranking input, and contact information found inside answers is redacted.
- Model output is validated and retried once; unusable results are flagged for manual review.
- Weighted totals and rankings are computed outside the model.
- Suspected attempts to steer the model are flagged.
- The ranking worker uses a restricted database role that cannot write selection decisions or read personal contact data.
- Management retains authority over selection and rejection; ranking is advisory only.
- Overrides require a reason; changing a released outcome requires a second Management approver.
- Result and activation messages use the existing outbox with per-message status.

The Vertex AI adapter is implemented, but a real model has not been connected or evaluated. The development scorer is a test stub, **not an AI model**, and production is configured to reject it.

Synthetic-data evaluation command:

    pnpm --filter @sj/api ranking:eval

### Jury evaluation and volunteer assignments

- Management configures and approves versioned jury rubrics, assigns jurors, schedules pitches and tracks the currently pitching startup.
- Jurors can access only their assigned startups and the authorised pitch information.
- Scoring is validated server-side; submitted evaluations are locked and retain the rubric version used.
- Management can review evaluations and reopen a submitted evaluation with a recorded reason.
- Jury scores are kept separate from AI ranking and startup-selection decisions.
- Volunteer assignment generation uses a reproducible random shuffle and one-to-one pairing.
- A volunteer is assigned to exactly one target: one startup **or** one jury member, never both.
- If capacity is insufficient, unassigned targets are listed rather than hidden by duplicate assignments.
- Draft assignments are reviewed by Management before being saved.
- Reassignments and assignment endings preserve actor, time, reason and history.
- Database constraints and transactional locking protect the one-to-one rules under concurrent requests.

The draft jury rubric and volunteer-related messaging/contact policies still require the approvals recorded in [DECISIONS.md](docs/DECISIONS.md).

### Event information, documents, notices and push

- The website Programme page and mobile Event Information screen read the same published event content.
- Supported event content includes schedules, venues, food, accommodation, travel, safety guidance, emergency contacts and information pages.
- Edits remain drafts until published with a change summary; published versions are retained.
- Content visibility can be public, for all participants, or limited to authorised roles.
- Admin and Management edit different content categories, enforced by the API.
- The initial programme is seeded as **unpublished tentative content**; no invented session times or venues are made public.
- Emergency number **112** is always displayed first; organisers must supply venue-specific contacts.
- Admin-uploaded documents support PDF, PNG and JPEG up to 10 MB. The intended production workflow uses a private Supabase Storage bucket and audience-checked links expiring after 60 seconds.
- Management can send edition-scoped notices to all participants, roles, or authorised groups.
- Notices appear in the app inbox and can optionally be sent by push. Corrections and withdrawals are audited.
- Push-device registration, delivery tracking and receipt checks are implemented through the Expo push adapter.

**Not verified live:** migration 0011 has not yet been applied to staging; the private document bucket has not been tested against a real Supabase Storage bucket; phone push notifications have not been tested on real Android and iOS devices with the organisation's credentials. Until those steps are done, do not treat these integrations as production-ready.

## Roadmap

The delivery plan contains ten phases:

| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation: monorepo, contracts, API, database, identity, permissions, audit and CI | Done |
| 2 | Registration and selection | Done |
| 3 | Admin accounts, CSV imports and activation | Done |
| 4 | Mobile app foundation | Done; store release pending |
| 5 | AI ranking and Management-controlled selection | Done; real AI/email/SMS providers pending |
| 6 | Jury evaluation and volunteer assignment | Done |
| 7 | Event information, documents, notices and push support | Done; live storage/push verification pending |
| 8 | In-app AI Help Desk, Customer Support dashboard, tickets and emergency workflow | Done; live Help Desk model and organiser approvals (TBD-07, -27, -28) pending |
| 9 | Offline event-information cache, reports, controlled exports and audit view | Planned |
| 10 | Security review, penetration-test fixes, load/recovery testing, app-store submission and launch | Planned |

**WhatsApp integration is excluded from Phase 8 and is assigned to a teammate.** The Help Desk engine takes an authenticated identity from a channel adapter, so a WhatsApp adapter can reuse the same authorised tools and safeguards. This repository contains no WhatsApp APIs, webhooks, credentials or tables for it.

The app's sign-out-after-reinstall behaviour (OD-02) is also still outstanding and must be completed before app-store submission.

For exact deliverables, acceptance criteria, dependencies and open decisions, see [PHASES.md](docs/PHASES.md), [EXECUTION_PLAN.md](docs/EXECUTION_PLAN.md) and [DECISIONS.md](docs/DECISIONS.md).

## Architecture

The platform follows ADR-001: a TypeScript monorepo with a modular-monolith API and one PostgreSQL database. Web and mobile clients use the typed API client; they do not connect directly to database tables.

    Public website ─────┐
    Admin/Management ───┼── HTTPS / JSON ── Fastify API ── PostgreSQL
    Android/iOS app ────┘                       │
                                                ├── Background workers / outbox
    Supabase Auth ── signed JWT ────────────────┤
                                                ├── Private document storage
                                                └── Provider adapters:
                                                    Vertex AI, email, SMS, Expo push

Core design rules:

- **One API and one database.** Each interface uses the API and shared typed contracts.
- **Contracts first.** Zod schemas in the contracts package define request/response types.
- **Critical rules enforced in the database.** Constraints and triggers protect important invariants for every caller.
- **Default deny.** Server-side permissions and record-level checks control access.
- **Configuration over hard-coded policy.** Edition-specific settings store deadlines, forms and other changeable rules.
- **AI never decides.** Human Management decisions remain separate from AI ranking and jury scoring.
- **Audit privileged operations.** Decisions and operational changes keep traceable audit history.
- **Production fails closed.** The launch gate rejects unsafe production configuration.

### Technology stack

| Layer | Technology |
|---|---|
| Language/runtime | TypeScript 5.9, Node.js 22+ |
| Package manager | pnpm 10 workspaces |
| API | Fastify 5, Zod, postgres.js |
| Database | PostgreSQL 16+; Supabase PostgreSQL for staging |
| Website and console | Next.js 16, React 19 |
| Mobile | Expo SDK 57, React Native, Expo Router |
| Authentication | Supabase Auth OTP and TOTP MFA for deployed environments; local development auth for local work only |
| AI ranking | Vertex AI adapter plus a development-only scorer |
| Notifications | Existing outbox with email, SMS and Expo push adapters |
| Documents | Supabase Storage intended for deployed environments; database-backed development adapter |
| Tests | Vitest, PostgreSQL integration tests and Python browser E2E scripts |
| CI | GitHub Actions |

Hosting choices are not a deployment confirmation. Production hosting, budget and organisational account ownership remain subject to approval.

## Repository structure

    apps/
      api/          Fastify API, services, workers, migrations runner and tests
      web/          Public website and applicant flows
      console/      Admin, Management and Customer Support console
      mobile/       Shared Android/iOS Expo app
    packages/
      contracts/    Shared schemas, types and validation
      client/       Typed API client
      web-session/  Browser session and authentication integration
    db/
      migrations/   Forward-only SQL migrations
    docs/
      ARCHITECTURE.md
      PHASES.md
      EXECUTION_PLAN.md
      DECISIONS.md
      LAUNCH_CHECKLIST.md
      STAGING.md
      TECHNICAL_DESIGN_AND_FEATURE_GUIDE.md
      DEVICE_TEST_PROTOCOL.md
    scripts/        Local database and browser E2E helpers
    .github/
      workflows/    Continuous integration

## Getting started locally

### Prerequisites

- Node.js 22 or newer.
- pnpm 10.
- PostgreSQL 16+ or Docker/Compose.
- Python 3 for the browser E2E scripts.

### Install dependencies

    pnpm install
    cp .env.example .env

Review .env and keep local development settings local. Development authentication is for local testing only; never use it in a deployed environment.

### Start a local database

Use the repository's database helper:

    pnpm db:start

Or use Docker Compose if that is your preferred local setup:

    docker compose up -d

Check DATABASE_URL in .env and make sure it targets the database you started. The helper's default port may differ from an existing local PostgreSQL instance.

### Apply migrations and seed development accounts

    pnpm db:migrate
    pnpm db:seed

The development seed contains local-only sample accounts for Management, Admin and Customer Support. Consult the seed implementation for the exact credentials and roles. Do not use sample credentials in staging or production; the seed script is intended for development.

### Start the services

Run each command from the repository root in a separate terminal:

    pnpm dev:api

    pnpm dev:web

    pnpm dev:console

Optional mobile development server:

    pnpm dev:mobile

The default local service ports are:

- Website: http://localhost:3000
- Console: http://localhost:3001
- API: http://localhost:4000

For physical-device testing, configure the mobile app's API URL to a reachable address on the computer running the API. A phone cannot normally reach the computer through its own localhost address.

## Testing and builds

Run the workspace checks:

    pnpm -r typecheck
    pnpm --filter @sj/api test
    pnpm -r build

API integration tests require PostgreSQL. Review the test configuration and use a disposable test database; do not point tests at a production or participant-data database.

Browser end-to-end scripts currently include the following flows. Start the required services and a fresh, correctly seeded database before each flow:

    python3 scripts/e2e_smoke.py /tmp/startup-jathara-shots
    python3 scripts/e2e_admin.py /tmp/startup-jathara-shots
    python3 scripts/e2e_phone.py /tmp/startup-jathara-shots
    python3 scripts/e2e_redirect.py
    python3 scripts/e2e_mfa.py /tmp/startup-jathara-shots
    python3 scripts/e2e_mobile.py /tmp/startup-jathara-shots
    python3 scripts/e2e_ranking.py /tmp/startup-jathara-shots
    python3 scripts/e2e_jury_volunteers.py /tmp/startup-jathara-shots
    python3 scripts/e2e_event_notices.py /tmp/startup-jathara-shots
    python3 scripts/e2e_support.py /tmp/startup-jathara-shots          # API with HELPDESK_PROVIDER=stub

Browser scripts require Playwright and Chromium. Some flows use controlled test configuration, synthetic data or a pinned clock. Follow the comments in each script and the [technical execution plan](docs/EXECUTION_PLAN.md) before running them; do not run example commands against production.

CI is configured in .github/workflows/ci.yml and runs the repository's automated checks. A green CI run is necessary, but it does not prove real-provider delivery, device behaviour, staging deployment or production readiness.

## Environments and external services

### Local development

Local development may use the development authentication mode and development-only provider adapters. These are for tests and must never be used for real participant data or production operation.

### Staging

An organisation-owned Supabase staging project exists in the Mumbai region. However, the staging API, website and Management console are **not hosted yet**, and required secret/auth configuration remains outstanding.

Before staging end-to-end verification can be completed:

1. Configure staging secrets in the appropriate secret manager.
2. Configure Supabase Auth OTP, custom SMTP and TOTP MFA settings.
3. Host the API, website and console using staging configuration.
4. Apply migrations 0011 and 0012 through the authorised staging process.
5. Create the private event-documents Storage bucket and verify audience-restricted links.
6. Verify authentication, device sessions, live email/SMS flows and other provider paths in the [device test protocol](docs/DEVICE_TEST_PROTOCOL.md).

See [STAGING.md](docs/STAGING.md) for exact settings, migration checksums, safeguards and the staging verification command. Do not apply migrations to the shared staging project without its owner's authorisation.

### External accounts and providers

The following dependencies still need real accounts, configuration or approval:

- **Supabase:** completed staging project; staging secrets, Auth settings and hosted clients still pending.
- **Vertex AI:** no live ranking model has been selected and validated.
- **Email:** Amazon SES sender/domain setup and real delivery verification.
- **SMS:** MSG91 or an approved alternative, DLT registration and approved templates.
- **Push:** organisation-owned Expo/EAS project, FCM credentials and APNs credentials; test on actual Android and iOS devices.
- **Document storage:** private Supabase Storage bucket and live access-control verification.
- **Hosting and app stores:** organiser-owned cloud, domain, Apple and Google accounts and approved budget.
- **Legal and policy:** approved privacy notice, retention policy, data-processing review and the remaining organiser/Management sign-offs.

## Configuration and secret handling

Start from .env.example. The exact configuration is defined and validated in the API, website, console and mobile packages. Common settings include:

| Variable or setting | Purpose |
|---|---|
| DATABASE_URL | PostgreSQL connection string |
| AUTH_MODE | Local development mode or Supabase authentication |
| SUPABASE_URL | Supabase project URL |
| SUPABASE_SERVICE_ROLE_KEY | Server-only key used by the API to verify authoritative account data |
| REQUIRE_STAFF_MFA | Enforces step-up MFA for privileged staff |
| CORS_ORIGINS | Explicit allowlist of trusted web origins |
| LAUNCH_APPROVED | Human-controlled production approval gate |
| RUN_WORKERS | Runs background workers within the API process |
| RANKING_PROVIDER | Development scorer or Vertex AI provider |
| NOTIFY_EMAIL_PROVIDER / NOTIFY_SMS_PROVIDER | Email and SMS delivery adapters |
| PUSH_PROVIDER | Push notification adapter |
| STORAGE_PROVIDER / STORAGE_BUCKET | Document storage backend and bucket |
| NEXT_PUBLIC_API_URL / EXPO_PUBLIC_API_URL | Public API URL for web and mobile clients |
| NEXT_PUBLIC_SUPABASE_* / EXPO_PUBLIC_SUPABASE_* | Public Supabase client settings only |

This is a summary, not a complete environment-variable list. See .env.example and the configuration section in [TECHNICAL_DESIGN_AND_FEATURE_GUIDE.md](docs/TECHNICAL_DESIGN_AND_FEATURE_GUIDE.md) for the canonical list.

**Never commit** .env files, service-role keys, API tokens, OTPs, provider credentials, private keys or real participant data. Never put server secrets in NEXT_PUBLIC_* or EXPO_PUBLIC_* variables.

## Security and production readiness

Production is **NOT APPROVED**. The API's launch checks validate important configuration conditions, but automated configuration checks cannot replace operational proof and written approvals.

Before launch, the team must complete the current launch checklist, including:

- Organisation-owned production infrastructure and restricted secret access.
- Real Supabase sign-in, identity-linking and staff MFA verification.
- Real email/SMS delivery and selected AI-model evaluation.
- Private document-storage and real-device push testing.
- Organiser and Management decisions, including event content and operational policies.
- Legal approval of privacy and retention documents and relevant vendor processing.
- Security review/penetration test, load test, monitoring, backup and restore drill.
- Browser E2E and mobile-device verification on staging.
- OD-02: sign out on first launch after app reinstall, before app-store submission.
- Written launch sign-offs before setting LAUNCH_APPROVED=true.

The API should remain blocked until these requirements are satisfied. Do not bypass the launch gate to demonstrate the system.

> [!WARNING]
> The launch checklist states that this repository should be **private until launch approval**. Verify and change the repository visibility setting before sharing source or operational documentation broadly.

## Documentation

- [Technical Design and Feature Guide](docs/TECHNICAL_DESIGN_AND_FEATURE_GUIDE.md) — detailed guide to the built system, APIs, permissions, tests and current limitations.
- [Architecture / ADR-001](docs/ARCHITECTURE.md) — agreed architecture and module boundaries.
- [Delivery Phases](docs/PHASES.md) — phase scope, implementation status and next steps.
- [Technical Execution Plan](docs/EXECUTION_PLAN.md) — implementation plan, dependencies, acceptance criteria and schedule risks.
- [Decision Register](docs/DECISIONS.md) — open TBDs, recommended defaults and required approvers.
- [Staging Environment](docs/STAGING.md) — staging setup, database state, migrations and verification.
- [Launch Checklist](docs/LAUNCH_CHECKLIST.md) — required technical and operational sign-offs.
- [Device Test Protocol](docs/DEVICE_TEST_PROTOCOL.md) — real-phone authentication, session, MFA, push and event-information tests.
- [Security Fix Report](docs/SECURITY_FIX_2026-10-15.md) — identity verification, imported-account linking and activation safeguards.
- [Privacy Notice Draft](docs/PRIVACY_NOTICE_DRAFT.md) — draft for legal review; not approved.

The requirements document and PRD are maintained as project documents. A decision listed as a recommended default is **not approved policy** until the named stakeholder signs it off.

## License and use

No open-source licence has been selected. Unless and until the rights holder publishes a licence, do not assume the repository is licensed for redistribution, reuse or commercial deployment.