# ADR-001 — Fixed platform architecture

Status: **Accepted (locked 15 Oct 2026).** Every phase builds on this architecture. A change needs a new ADR that explains why this one no longer works. Preference alone is not a reason.

## Decision

One central system: a **modular-monolith API over one PostgreSQL database**. All five interfaces are clients of it:

```
 Public website ─┐   Next.js (apps/web)
 Admin / Mgmt /  ├─▶ Next.js console (apps/console)          ─┐
 Support console ┘                                            │  HTTPS + JSON, Bearer JWT
 Android + iOS app ──▶ Expo / React Native (apps/mobile)      ├──▶  API: Fastify modular monolith (apps/api)
 WhatsApp (Phase 8) ──▶ webhook into the same API             ─┘        │
                                                                         ├─ PostgreSQL 16 (all data, rules as constraints/triggers)
 Identity: Supabase Auth (email / phone OTP, MFA) ── JWT ──▶ API        ├─ Object storage (private, signed URLs)
                                                                         └─ Workers (AI ranking, notifications) — same codebase
```

| Layer | Locked choice | Rule |
|---|---|---|
| Language | TypeScript everywhere (Node 22+) | One language for web, API and mobile. |
| Contracts | `packages/contracts` (Zod) | Every request and response shape is defined once and shared by API, web, console and mobile. |
| API client | `packages/client` | Every interface calls the API only through this typed client. No interface talks to the database. |
| API | Fastify 5, modular monolith, `/v1` REST, RFC 9457 problem responses | One module per business area (`modules/*`). A module owns its tables and is reached only through its service functions. |
| Data | PostgreSQL 16; postgres.js; forward-only SQL migrations with checksums | Business invariants are enforced by constraints/triggers as well as in code. Migrations are never edited after delivery. |
| Identity | Supabase Auth issues JWTs. The API verifies them (JWKS) and resolves verified email/phone via the Admin API. | Authorisation lives **only** in our tables (`role_grants`, `edition_access`) and is enforced on the server for every request. |
| Authorisation | Role → permission map (`platform/permissions.ts`), edition-scoped access, relationship checks | Default deny. Client-side hiding is never a control. Accounts must be `active`. |
| Event configuration | `event_editions` + configuration tables | Event-specific values are data, not code: dates, deadlines, limits, form fields, content. A schedule change never needs an app release. |
| Web | Next.js 16 / React 19 (website, console) | Server state comes only from the API. |
| Mobile | Expo (React Native), one app for Android and iOS, EAS Build/Submit | Same contracts and client. Content is server-driven. |
| Audit | Append-only `audit_events` (trigger-protected) | Every privileged write records actor, time and scope. |
| AI | Behind service interfaces inside the API (ranking, help desk) | AI never decides: Management decides selections. The ranking worker runs as the database role `sj_ranking_worker`, which cannot write decisions or read contact data (Phase 5). Help Desk access rules are enforced by the API, not by prompts. |
| Hosting | API + workers: containers (Cloud Run asia-south1). Web: Vercel. Data/Auth/Storage: Supabase (ap-south-1). | Recommended in [DECISIONS.md](DECISIONS.md) TBD-46, awaiting budget approval and organisation-owned accounts (TBD-36). The code is portable. |
| Testing | Vitest integration tests on **real PostgreSQL**, plus Playwright browser end-to-end | Every rule and every permission gets a test. Nothing is reported as passing unless it was run. |

## Consequences

- New features are added as new API modules, new contract types and new screens. They are never a separate service or a separate database unless a new ADR says so.
- The console hosts the Admin, Management and Customer Support dashboards in one access-controlled web app. Each user sees only the sections their roles allow (RQ §4: "five interface types, not five independent applications").
- Every former TBD has a recorded decision in [DECISIONS.md](DECISIONS.md). Decisions still awaiting approval are built as configuration or as clearly labelled defaults, and are never presented as confirmed business rules.
