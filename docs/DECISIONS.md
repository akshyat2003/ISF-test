# Decision register: resolution of every open TBD

Zeny2Labs · v1.0 · 15 October 2026 · Supersedes the open-item lists in PRD v1.0 §19 and EXECUTION_PLAN §9. PRD v1.1 §19.3 carries the same table.

**Production status: NOT APPROVED.** Recording a decision here does not approve it. Items marked *awaiting* stay provisional until the named approver signs them off in [LAUNCH_CHECKLIST.md](/docs/LAUNCH_CHECKLIST.md) §C. No approval has been received for any of them.

## How to read this register

The source of truth is the requirements document (RQ, *Startup Jathara Requirements Revised v4*), then PRD v1.0. Every decision below cites the clause it rests on. Where the sources do not settle a question, the register chooses the safest practical default and names who has to approve it. No business rule is presented as confirmed when it is not.

| Status | Meaning |
|---|---|
| **Decided** | An engineering or security decision within Zeny2Labs' authority. It applies now. A change needs an ADR. |
| **Resolved by design** | The platform needs no business rule here. It works with whatever the organisers supply. The organisers still owe the data. |
| **Default — awaiting X** | The recommended default. Built or planned this way, but X must approve it before production. |

Approvers: **Organisers** = GIET University with the International Startup Foundation (RQ cover page). **Management** = the Management Team (RQ §3.2). **Legal** = the organisers' legal reviewer. **Budget** = whoever holds the organisers' budget.

## Summary

| ID | Decision | Status |
|---|---|---|
| TBD-01 | Draft criteria set v1: RQ §7's five example criteria, equal weights, 1–5 scale. Ranking cannot run until Management approves a set. | Default — awaiting Management · **built (Phase 5)** |
| TBD-02 | The platform imposes no count; numbers come from the imported data. | Resolved by design |
| TBD-03 | Shortfalls are handled as RQ §9 confirms: unassigned targets are listed, never doubled up. | Resolved by design |
| TBD-04 | Delegates get information only for 2026 (accommodation, travel, programme). No room allocation, travel booking or check-in module. | Default — awaiting Organisers |
| TBD-05 | 2027 stays open with no deadline until Management sets one as edition data. Reapplication means submitting a 2027 application from the same account. | Default — awaiting Management |
| TBD-06 | Seed the RQ §2 tentative programme labelled "tentative". Admin and Management edit it as content. | Default — awaiting Organisers (final content) · **built (Phase 7)** |
| TBD-07 | Always show 112 (India's national emergency number). Organisers supply campus security, medical and control-room numbers. Escalation follows TBD-27. | Default — awaiting Organisers · **112 built (Phase 7–8)**; venue numbers not yet supplied |
| TBD-08 | The Junicorn brochure's ages and 200→100 stages do **not** apply to this registration workflow. | Default — awaiting Organisers |
| TBD-09 | No cap on applications. The selection limit is set per edition by Management (configurable, RQ §6). | Resolved by design |
| TBD-10 | Change control: a written change request, an impact assessment and Management approval. Nothing new before the 2026 event unless it is critical. | Default — awaiting Management |
| TBD-11 | Cut-off **5 Nov 2026, 23:59:59 IST**, inclusive. | Default — awaiting Organisers |
| TBD-12 | **Both email and mobile.** Email OTP from launch; SMS OTP switched on once the DLT sender and template are approved. | Default — awaiting Organisers |
| TBD-13 | Activation codes go to the participant's own contact on file: email if present, otherwise SMS. Manual hand-over stays as the fallback. Valid **72 h**. | Default — awaiting Organisers · **built (Phase 5)** |
| TBD-14 | Results go **in-app plus a message to the verified sign-in contact** (email, or SMS for mobile-only applicants). No WhatsApp for results. | Default — awaiting Management · **built (Phase 5)** |
| TBD-15 | One startup per leader account and one application per startup per year (blocked). A matching normalised name is **flagged** for Management, not blocked. | Default — awaiting Management |
| TBD-16 | Team members of new startups get accounts **only after selection**. The leader sends the list; the Admin adds members. | Default — awaiting Organisers |
| TBD-17 | No extra team-management permissions for 2026. | Default — awaiting Management |
| TBD-18 | A written reason is **required for every override** of the AI ranking. | Default — awaiting Management · **built (Phase 5)** |
| TBD-19 | **Warn and require explicit confirmation.** A release above the limit is refused unless the manager confirms it, and the confirmation is audited. No hard block. | Default — awaiting Management · **built** |
| TBD-20 | Management assigns explicitly which startups pitch and the slots. Jurors see only their own scores. | Default — awaiting Management · **built (Phase 6)** |
| TBD-21 | Management Team members operate "currently pitching". One named operator per venue session on the run sheet. | Default — awaiting Management · **built (Phase 6)** |
| TBD-22 | Pool: every startup with 2026 access plus every jury member. **No priority**: random, with the unassigned listed. | Default — awaiting Management · **built (Phase 6)** |
| TBD-23 | Close the assignment with a reason, then reassign manually from free volunteers. No automatic reshuffle. | Default — awaiting Management · **built (Phase 6)** |
| TBD-24 | Admin: documents, emergency contacts, safety guidelines, static pages. Management: schedule, venues, meals, accommodation, travel, notices. | Default — awaiting Organisers · **built (Phase 7)** |
| TBD-25 | The website links to the WhatsApp Help Desk (click-to-chat) and the app. **No separate web chat.** | Default — awaiting Organisers · no web chat built; WhatsApp link waits for the separate WhatsApp workstream |
| TBD-26 | English only for 2026. All text is externalised so other languages can be added later. | Default — awaiting Organisers · Help Desk answers in English (Phase 8) |
| TBD-27 | Emergency: acknowledge within 5 min, else escalate to the Management duty lead. High: 30 min. Normal: 2 h on event days, 1 working day otherwise. Configurable. | Default — awaiting Organisers · **partly built (Phase 8)**: per-edition windows (normal = one value, no working-day calendar); escalation goes to all Management (no duty lead or event director modelled) |
| TBD-28 | Minimum roster: 2 support staff per shift on 17–20 Dec (07:00–22:00 IST) plus 1 on call overnight. Business hours otherwise. Alerts: dashboard plus SMS to the on-duty phone. | Default — awaiting Organisers · dashboard alerts built (Phase 8); **no roster, no SMS alerts** |
| TBD-29 | Notices go in-app plus push only. "Authorised groups" are named lists that Management maintains. | Default — awaiting Management · **built (Phase 7)** |
| TBD-30 | No QR check-in, meal tracking or room allocation for 2026. The module boundaries stay disabled. | Default — awaiting Organisers |
| TBD-31 | Export is a separate permission. Admin exports the data it administers; Management exports selection and jury data; nobody else. Every export is audited and sanitised. | Default — awaiting Organisers |
| TBD-32 | Draft notice and retention schedule below and in [PRIVACY_NOTICE_DRAFT.md](/docs/PRIVACY_NOTICE_DRAFT.md). The launch gate stays shut until legal approval. | Default — awaiting **Legal** |
| TBD-33 | Design for 3,000 accounts and 600 concurrent users; load-test at twice that. p95 < 500 ms. 99.5 % availability. RPO ≤ 5 min in critical windows, ≤ 24 h otherwise. RTO ≤ 4 h. | Default — awaiting Organisers + Budget |
| TBD-34 | Android 7+ and iOS 16.4+ (the toolchain minimums). Test on the current and two previous OS versions, and the last two versions of the main browsers. | **Decided** |
| TBD-35 | AI: Google Vertex AI in the same Google Cloud project as hosting, with separate service accounts per AI function. WhatsApp: Meta Cloud API directly. Email: Amazon SES (Mumbai). SMS: a DLT-compliant Indian aggregator (default MSG91) through Supabase's Send SMS hook. | Default — awaiting Organisers + Budget (contracts) · adapters **built (Phase 5)**, live accounts not yet verified |
| TBD-36 | The organisers' legal entity owns every account (Apple, Google, WhatsApp, cloud, domain, Supabase, GitHub). Zeny2Labs gets member access. Use organisation store accounts. | Default — awaiting Organisers |
| TBD-37 | Released decisions are final, except for an audited **correction** that needs a written reason and a **second** Management approver. Applicants may withdraw. | Default — awaiting Management · **built (Phase 5)** |
| TBD-38 | **No.** 2026 registration runs on the website only. The app adds registration when it ships. | Default — awaiting Organisers |
| TBD-39 | Text-only form, **no uploads or links** apart from the optional website. Six questions mapped to the RQ §7 example criteria, stored as **edition configuration** and frozen once applications exist. | Default — awaiting Management · **built** |
| TBD-40 | Release 2026 decisions **on or before 20 Nov 2026**. | Default — awaiting Management |
| TBD-41 | CSV (UTF-8), one file per category, column set v1 as built. No XLSX. Organisers sign off a real sample file. | Default — awaiting Organisers |
| TBD-42 | Rank 2027 applications once, after the 2027 deadline closes. | Default — awaiting Management · **built (Phase 5)** |
| TBD-43 | Draft rubric: the approved TBD-01 criteria plus "pitch delivery", integer 1–10, equal weights. No automatic winners. | Default — awaiting Management · **built (Phase 6)** |
| TBD-44 | **Never shared** with applicants. | Default — awaiting Management · **built (Phase 5)** |
| TBD-45 | **18+ only.** Applicants confirm they are 18 or older at registration; no date of birth is collected. | Default — awaiting Organisers + Legal · **built** |
| TBD-46 | India regions: Supabase ap-south-1 (Pro plan), Cloud Run asia-south1, Vercel Pro (bom1). Indicative budget below. | Default — awaiting **Budget** |
| TBD-47 | Volunteer runs: Admin **or** Management generates a draft; only Management saves it, reassigns, assigns by hand or ends an assignment. | Default — awaiting Management · **built (Phase 6)** |
| TBD-48 | Volunteer-assignment messages: in-app plus one email/SMS through the existing outbox, to both the volunteer and the target. Wording is draft. | Default — awaiting Management · **built (Phase 6)** |
| TBD-49 | Contact shown between a volunteer and their target: name and mobile number only, never email. | Default — awaiting Management + Legal · **built (Phase 6)** |
| TBD-50 | Rubric changes after scoring starts: submitted evaluations keep their version; drafts and reopened evaluations are scored against the latest approved version. | Default — awaiting Management · **built (Phase 6)** |
| TBD-51 | Event documents: PDF, PNG or JPEG up to 10 MB, in a private Supabase Storage bucket, opened only through 60-second links issued after an audience check. Replaced, never edited. | Default — awaiting Organisers · **built (Phase 7)** |
| TBD-52 | Push notifications through the Expo push service (FCM for Android, APNs for iOS), with credentials under the organisation's accounts. | Default — awaiting Organisers + Budget · **built (Phase 7)** |
| TBD-53 | Content edits are drafts until published; a published notice may have its text corrected (audited) but never its audience; a notice reaches only devices registered when it is published. | Default — awaiting Management · **built (Phase 7)** |
| TBD-54 | AI Help Desk (app): server-side scoped tools, the model sees only tool results as data, deterministic emergency/human/injection checks first, an output leak check, fallback on any provider failure; Vertex AI with its own service account; channel-agnostic engine. | Default — awaiting Management · **built (Phase 8)**, live model not verified |
| TBD-55 | Emergency control: 112 first and never waits for anything; alerting the team is a second explicit tap; one open emergency per person (a new report is added to it and re-alerts); retries reuse one request id. | Default — awaiting Organisers · **built (Phase 8)** |
| TBD-56 | Ticket lifecycle: Open → Acknowledged → In Progress → Resolved (or Acknowledged → Resolved); Resolved is final (no reopening: a new ticket instead); priority and emergency only go up; escalation is an attribute and cannot be withdrawn. | Default — awaiting Management · **built (Phase 8)** |
| TBD-57 | Re-alerts and escalation: unacknowledged urgent tickets re-alert all support staff on an interval up to a maximum; at the window they escalate to all active Management; normal tickets are flagged overdue once; with no active support staff, Management is alerted. | Default — awaiting Organisers · **built (Phase 8)** |
| OD-01 | WhatsApp verification uses a link code shown in the signed-in app. | **Decided** |
| OD-02 | iOS reinstall: sign out on the first launch after any reinstall. To build before store submission (not part of the Phase 6 jury/volunteer delivery). | **Decided** · not built yet |
| OD-03 | Maps: static map links inside venue content. No maps SDK or API. | **Decided** |
| OD-04 | Repository visibility: **private** until launch approval. | Default — awaiting repo owner |
| OD-05 | Descope order (EXECUTION_PLAN §8) as pre-approved contingency with dated checkpoints. | Default — awaiting Organisers |

---

## A. Registration and selection

### TBD-11 · Exact cut-off time and time zone (P0)
- **Decision:** 5 November 2026 at **23:59:59 IST** (Asia/Kolkata, UTC+05:30), inclusive. The server refuses submissions after that second, including direct API calls.
- **Why:** RQ §2 and §6 call 5 November the *last date* to register, so the whole day must count. The event and its applicants are in India. The value is already seeded and tested (AT-08).
- **Trade-offs and dependencies:** A midnight cut-off concentrates last-minute traffic, so the load test (TBD-33) and on-call for the evening of 5 Nov are needed.
- **Approval:** Organisers, in writing. Only then set `event_editions.closes_at_confirmed = true`; the website then stops showing "time to be confirmed".
- **Status:** Default — awaiting Organisers.
- **Implementation:** No code change; the value is seeded in migration 0001. The flag stays `false`.

### TBD-05 · 2027 deadline and reapplication process
- **Decision:** 2027 registration stays open with no deadline. Management sets the 2027 deadline as edition data (`event_editions.registration_closes_at`) once the 2027 dates are known; no code release is needed. **Reapplication:** a 2026 applicant who was not selected signs in with the same account and submits a 2027 application for the same startup. If they already chose "both", their 2027 application is unchanged (RQ §6, §7.1).
- **Why:** RQ §6 says 2027 registration continues after the 2026 deadline and its deadline is TBC. The reapplication path already works and is tested: one startup per leader account, one application per year.
- **Trade-offs:** 2026 answers are not copied into 2027. The applicant answers that year's form again, which keeps each year's application self-contained.
- **Approval:** Management (2027 deadline date). **Status:** Default — awaiting Management.

### TBD-08 · Junicorn brochure rules
- **Decision:** The brochure's eligibility ages (18–25) and its 200→100 selection stages do **not** apply to this registration workflow. No age band or stage quota is enforced. The 18+ floor in TBD-45 comes from data protection, not from the brochure.
- **Why:** RQ §6–§7 define their own process: Management-led selection with a configurable limit, and preliminary estimates of 50–100 applications and 20–30 selected teams. A 200→100 funnel does not fit that scale. Enforcing an upper age limit would mean collecting dates of birth, which data minimisation argues against. PRD FR-REG-13 already forbids enforcing these rules unless they are confirmed.
- **Approval:** Organisers. **Status:** Default — awaiting Organisers.

### TBD-09 · Number of new applications and selected teams
- **Decision:** No cap on applications. Management sets the selection limit per edition in the console, and the release rule in TBD-19 applies.
- **Why:** RQ §6 says the estimate "is preliminary, not a fixed limit; selection limits must be configurable by management". This is built (AT-15).
- **Status:** Resolved by design. Management chooses the number when it reviews.

### TBD-15 · What counts as "the same startup"
- **Decision:** The following are **blocked**:
  - a second application by the same startup for the same year (DB constraint DC-01);
  - a leader account leading two startups;
  - an applicant re-applying for a predefined startup.

  A startup whose normalised name matches another startup's is **flagged** (`possible_duplicate_name`) for Management review, not blocked.
- **Why:** Blocking on name alone would let anyone squat a name and lock out the real team, and different startups can share a name. An account-based rule cannot be bypassed by renaming, and Management sees the name flag.
- **Trade-offs:** One person cannot apply for two different startups. That is acceptable at this scale, and support can resolve exceptions.
- **Approval:** Management. **Status:** Default — awaiting Management.
- **Implementation:** Already built and tested (AT-07, `registration.test.ts`). The "interim" wording was removed from code comments.

### TBD-16 · Accounts for new startups' team members
- **Decision:** Team members of a **new** startup get accounts only **after their startup is selected**. The leader gives the member list to the organisers. The Admin adds members as `startup_team_member` through the existing account administration or a startups import, and each member activates as in Phase 3.
- **Why:** RQ §6: only selected applicants receive 2026 event access, so earlier member accounts would hold personal data with no purpose (data minimisation). This also reuses the built and tested import and activation flow with no new feature.
- **Trade-offs:** Members cannot follow the application before selection; the leader acts for the team.
- **Approval:** Organisers. **Status:** Default — awaiting Organisers.

### TBD-17 · Extra team-management permissions for leaders
- **Decision:** None for 2026. `team_management` stays `false`. A leader asks the organisers or the Help Desk to change their member list.
- **Why:** RQ §3.3 says a leader *may* receive extra permissions; it does not require them. Adding self-service member management would add privilege and scope (RQ §13: no additional modules are confirmed).
- **Approval:** Management. **Status:** Default — awaiting Management.

### TBD-18 · Written reason for overriding the AI ranking
- **Decision:** A written reason is **mandatory for every override**. An override is selecting an application ranked outside the top *N*, or not selecting one inside it, where *N* is the selection limit (or Management's chosen cut line if no limit is set). Reasons for other decisions stay optional.
- **Why:** RQ §7: Management can override the AI and makes every decision. A recorded reason makes overrides auditable (FR-SEL-08) without slowing the decisions that agree with the ranking.
- **Built (Phase 5):** a draft that overrides the latest completed ranking without a reason is refused (`422 override_reason_required`). The decision stores the AI rank, the line *N* used (`cut_line_at_decision`) and the override flag. *N* is the selection limit, or, without a limit, the cut line Management sets on the run. Without a rank or an *N*, the override is recorded as unknown and no reason is required. Tests: `apps/api/test/ranking.test.ts`.
- **Approval:** Management. **Status:** Default — awaiting Management.

### TBD-19 · Does the selection limit block or only warn?
- **Decision:** **Warn and require explicit confirmation.**
  - Drafting is never blocked.
  - A release that would take the edition above the limit is refused with `409 selection_limit_exceeded`, which reports the limit and the resulting total, unless the request carries `confirmOverLimit: true`.
  - A confirmed release proceeds, returns the warning, and writes a separate audit event `selection.limit_exceeded_confirmed`.
  - Releases for one edition are serialised, so two managers cannot both slip under the limit at the same time.
- **Why:** RQ §6 says the limit is configurable and "not a fixed limit", and Management makes every decision (RQ §7). A hard block would only force a manager to raise the limit, adding friction with no safety gain. Warning only (the previous behaviour) lets a mistaken bulk release go out unnoticed, and releases cannot be undone (TBD-37). Requiring confirmation prevents accidents and leaves an audit trail.
- **Approval:** Management. **Status:** Default — awaiting Management. **Built in this change.**
- **Implementation:**
  - `ReleaseRequest.confirmOverLimit` in `packages/contracts`.
  - `releaseDecisions` in `apps/api/src/modules/selection/service.ts`.
  - The console asks for confirmation and retries (`apps/console/app/applications/page.tsx`).
  - Tests in `apps/api/test/selection.test.ts` (AT-15).

### TBD-37 · Changing a released decision, and withdrawals
- **Decision:**
  1. A released decision is final for ordinary editing (unchanged; enforced by a DB trigger).
  2. An error is fixed by a **correction**. A Management member records a written reason, a **second, different** Management member approves, and the applicant is notified again. Both steps are audited.
  3. An applicant may **withdraw** their own application for a year at any time before that year's event. Withdrawing after selection removes their access to that edition; it never affects their other year (RQ §6).
- **Why:** Management decides every outcome (RQ §7), and the project needs auditability. A two-person rule makes a correction deliberate and visible, without the risk of silent edits.
- **Built (Phase 5):** table `decision_corrections` (migration 0008). The two-person rule is enforced in the API, by a check constraint and by a trigger. The released-decision trigger now allows exactly the outcome change of an applied correction. Edition access follows the corrected outcome, and the applicant gets a correction message. Applicants withdraw on the website or in the app until the event's start date; a withdrawn application leaves ranking and decisions. Tests: `apps/api/test/corrections.test.ts`.
- **Approval:** Management. **Status:** Default — awaiting Management.

### TBD-38 · Must the app support registration before 5 November?
- **Decision:** **No.** 2026 registration runs on the website, which works on phones. The app's registration screen (built in Phase 4) goes live with the app's store release, in time for 2027 registration.
- **Why:** RQ §6 allows both channels but does not require the app for the 2026 window. Store approval is planned for December (EXECUTION_PLAN §8), after the deadline. The API enforces the same rules for both channels.
- **Approval:** Organisers. **Status:** Default — awaiting Organisers.

### TBD-39 · Application form fields and uploads (P0)
- **Decision:**
  - The fields stay as they are: startup name, description, website, city, state, leader name and mobile.
  - **Six required text questions** are added, 20–1,500 characters each, mapped to the example criteria in RQ §7:

    | Key | Question | Example criterion |
    |---|---|---|
    | `problem` | What problem are you solving, and for whom? | market relevance, impact |
    | `solution` | What is your solution, and what makes it new or better than current alternatives? | innovation |
    | `stage` | What stage is the startup at (idea, prototype, pilot or revenue), and what have you achieved so far? | feasibility |
    | `market` | Who are your customers, how large is the opportunity, and how will the startup grow? | market relevance, scalability |
    | `impact` | What economic, social or environmental impact do you expect? | impact |
    | `team` | Who is in the founding team, and what relevant skills and experience do they bring? (Help text: "Roles and experience only. Do not include contact details.") | feasibility |

  - **No file uploads and no links** apart from the optional website.
- **Why:**
  - Registration closes on 5 Nov, before the criteria are due (6 Nov). The form must therefore collect comparable information that suits any reasonable criteria set.
  - Text-only input avoids file storage, malware scanning (SEC-08) and fetching untrusted links, which would bring SSRF and prompt-injection risk into AI ranking.
  - Structured answers give the AI and Management the same inputs for every applicant.
- **Configuration:**
  - The questions are **edition data** (`event_editions.application_form`, migration 0007), as ADR-001 and FR-REG-12 require.
  - The website and app render them from `GET /v1/public/editions`, so a wording change needs no app release.
  - A DB trigger **freezes an edition's form once it has applications**, so every applicant answers the same questions.
  - Unknown answer keys are rejected.
  - Each application stores the form version it answered.
- **Trade-offs:** The form takes longer to fill in. Pitch decks, if wanted, are requested later from shortlisted teams.
- **Approval:** Management (question wording). **Status:** Default — awaiting Management. **Built in this change.**

### TBD-40 · Release date for 2026 decisions
- **Decision:** On or before **20 November 2026**.
- **Why:** This is the end of the AI-ranking window in EXECUTION_PLAN §8 (6–20 Nov). It gives selected teams 27 days before the pre-event day (17 Dec) to arrange travel to Gunupur. It also leaves time for volunteer assignment (16 Nov–1 Dec) and member onboarding (TBD-16).
- **Dependency:** Criteria approved by 6 Nov (TBD-01).
- **Approval:** Management. **Status:** Default — awaiting Management.

### TBD-42 · When 2027 applications are ranked
- **Decision:** One ranking run for 2027, after the 2027 deadline (TBD-05) has passed. Nothing is ranked or decided for 2027 while 2027 registration is still open.
- **Why:** RQ §6 and §7 treat each year's applications as one cohort; ranking a partial cohort would be unfair to late applicants.
- **Built (Phase 5):** ranking runs, decision drafts and releases are refused (`409 registration_open`) for **any** edition whose registration is still open. That includes 2026 before its 5 Nov cut-off, which matches the plan (ranking and decisions 6–20 Nov). The rationale, ranking a whole cohort together, applies equally to 2026. Management should confirm this reading when approving TBD-42.
- **Approval:** Management. **Status:** Default — awaiting Management.

### TBD-44 · Are AI scores or explanations shared with applicants?
- **Decision:** **Never.** Applicants see only *Under review*, *Selected* or *Not selected* (FR-SEL-09).
- **Why:**
  - The AI is advisory and Management decides (RQ §7).
  - Publishing AI scores would present advice as the decision.
  - Explanations can contain comparisons with other applicants (RQ §11.3).
- **Dependency:** Legal should confirm that a request from an applicant under data-protection access rights is handled case by case.
- **Built (Phase 5):** the applicant endpoints return no AI data, and tests assert it (`ranking.test.ts`, TBD-44).
- **Approval:** Management. **Status:** Default — awaiting Management.

### TBD-45 · Can participants be under 18?
- **Decision:** **Adults only (18+).**
  - The registering leader confirms "I am 18 years of age or older".
  - The API refuses a registration without the confirmation, and the confirmation is recorded in the registration audit event.
  - No date of birth is collected.
  - For imported participants, the organisers confirm that every imported person is 18 or older.
- **Why:** Personal data of children (under 18) requires verifiable parental consent under the DPDP Act, 2023 and Rule 10 of the DPDP Rules, 2025. That would mean a consent flow the platform does not have. A self-declaration is the least data-intensive control.
- **Trade-offs:** School-age founders cannot apply. If the organisers want them, a parental-consent flow becomes a change request (TBD-10) plus legal review.
- **Approval:** Organisers and Legal. **Status:** Default — awaiting Organisers + Legal. **Built in this change** (`adultDeclaration` in `RegistrationRequest`, website and app forms, tests).

## B. AI ranking and jury

### TBD-01 · AI evaluation criteria and weights (P0)
- **Decision:** A **draft criteria set v1** for Management to approve or edit:
  - the five example criteria from RQ §7: innovation, feasibility, scalability, market relevance and impact;
  - equal weights (20 % each);
  - each scored as an integer from 1 to 5, with one-line guidance per score.

  Ranking **cannot run** until a Management user approves a criteria set (`criteria_sets.approved_by`).
- **Why:** RQ §7: Management defines criteria and weights. The listed criteria are "examples only". Equal weights are the neutral starting point. The form questions (TBD-39) cover every criterion.
- **Deadline:** 6 Nov 2026 (EXECUTION_PLAN §8; risk R-04). Management can still review manually if the criteria are late.
- **Approval:** Management. **Status:** Default — awaiting Management. **Built (Phase 5):** draft v1 is seeded unapproved by migration 0008; Management creates further versions and approves them in the console (AI ranking page). An approved version is frozen by a DB trigger, and a run can use only an approved version of its own edition.

### TBD-43 · Jury scoring criteria, ranges and weights
- **Decision:** A draft rubric for Management:
  - the approved TBD-01 criteria plus "pitch delivery";
  - integer scores from 1 to 10;
  - equal weights;
  - optional comments.

  Winners are **never** declared automatically (RQ §8).
- **Approval:** Management. **Status:** Default — awaiting Management.
- **Built (Phase 6):** migration 0010 seeds this rubric as an **unapproved** draft v1 for 2026 and 2027; jurors cannot score until Management approves a version (`409 no_rubric`). Versions are created and approved on the console's Jury page; an approved version is frozen by a DB trigger. Weights are **relative** (a parameter counts weight ÷ sum of weights); the server computes a 0–100 total, normalised per parameter range. Each evaluation records the rubric version it used, and Management summaries never mix versions. Comments can be switched off per version. Tests: `apps/api/test/jury.test.ts`.

### TBD-20 · Which startups pitch, slots, and visibility of other jurors' scores
- **Decision:**
  - Management assigns explicitly which startups pitch, whether predefined, newly selected or both, and allocates the slots by hand.
  - There is no automatic rule.
  - A juror sees only their own scores; Management sees all of them.
- **Why:** RQ §8 does not state a pitching rule. RQ §11.3 forbids disclosing scores to other participants, and hiding peers' scores keeps evaluations independent.
- **Approval:** Management. **Status:** Default — awaiting Management.
- **Built (Phase 6):** Management assigns jurors to startups one by one (API and a DB trigger check that both take part in the edition). A juror can open only an assigned startup, plus the startup Management marks as currently pitching (FR-JRY-03); any other profile is a 404. The profile has founders' names and the edition's application answers, with **no contact details and no AI data**. Scoring is limited to assigned startups. A juror's views carry only their own scores. Management reviews submitted evaluations and can **reopen** one with a written reason (audited with the previous submission); nothing else changes a submitted evaluation, which a DB trigger enforces.
- **Separation from AI ranking and selection (Phase 6):** no ranking, selection or release code reads jury tables, the ranking worker role has no grant on them, and tests show that scoring changes no application, decision or ranking row.

### TBD-21 · Who operates "currently pitching"
- **Decision:** Management Team members, through a permission held by the Management role. The run sheet names one operator per venue session, and every change is audited. One live pitch per edition is already enforced in the DB.
- **Approval:** Management (names). **Status:** Default — awaiting Management.
- **Built (Phase 6):** permission `jury.manage` (Management only). Starting a pitch finishes any other live pitch of the edition in the same transaction; start and finish are audited.

## C. Volunteers, content and notices

### TBD-02 / TBD-03 · Number of volunteers and jury, and whether volunteers cover everyone
- **Decision:** The platform needs no number. Counts come from the imports. If volunteers run short, the generator lists the unassigned targets instead of doubling up (RQ §9, confirmed; built as constraints DC-04…06).
- **Status:** Resolved by design. The organisers still owe the import data (B-03).

### TBD-22 · Volunteer target pool and priority when short
- **Decision:**
  - **Pool:** every startup with 2026 event access plus every jury member. Newly selected startups join after release (PRD FR-VOL-13).
  - **Priority:** none. Assignment is random, as RQ §9 states, and every unassigned target is listed for Management to fill by hand.
- **Why:** A priority rule would contradict RQ §9's random assignment and is not stated anywhere.
- **Approval:** Management. **Status:** Default — awaiting Management.
- **Built (Phase 6):** a startup is in the pool when its leader has 2026 event access; a jury member when they hold the role for the edition, have its access and are not deactivated. Generation shuffles volunteers and targets with a seeded, unbiased shuffle (HMAC-SHA256 stream, Fisher–Yates with rejection sampling) and pairs them one-to-one. The seed and the sorted inputs are stored with the run, so it can be reproduced. A person is never paired with themselves. Shortages are listed as unassigned targets and surpluses as unassigned volunteers. A run is a **draft** that participants cannot see until Management saves it. Tests: `apps/api/test/volunteers.test.ts`.

### TBD-23 · Volunteers who become unavailable
- **Decision:** An authorised user closes the assignment with a reason, and the history is kept (DC-07). They then either assign a free volunteer by hand or leave the target listed as unassigned. Other pairs are never reshuffled automatically, and both sides are notified.
- **Approval:** Management. **Status:** Default — awaiting Management.
- **Built (Phase 6):** "End" closes an assignment with a reason; "Reassign" closes it and creates a new row that points to it (`replaces_id`), recording the previous and new assignment, the actor, the time and the reason (row and audit event). Closed rows cannot be changed or deleted (DB trigger). Manual assignment needs a reason and a free volunteer and target.

### TBD-47 · Who generates, saves and changes volunteer assignments
- **Decision:** Admin **or** Management generates a draft run (RQ §9 says the Admin initiates; the Phase 6 brief asks for Management). Only Management saves a draft, assigns by hand, reassigns or ends an assignment. Admin can view and discard drafts.
- **Why:** The PRD matrix marks reassignment "C" for both roles without saying which one acts. Keeping changes with Management gives one accountable role for the live pairs.
- **Trade-off:** If Admin should also reassign, it is a permission change (`volunteer.reassign`), not new code.
- **Approval:** Management. **Status:** Default — awaiting Management. **Built (Phase 6).**

### TBD-48 · Volunteer-assignment message channels and wording
- **Decision:** When a run is saved, or an assignment is made, changed or ended, both the volunteer and the target (the startup's leader, or the jury member) get an in-app notice plus one email, or SMS when they have no email, through the existing outbox. The SMS uses a new DLT template (`MSG91_TEMPLATE_ASSIGNMENT`) carrying only the year and a link. Delivery status is shown per message exactly as recorded: without a provider it stays **queued**.
- **Approval:** Management (wording); the DLT template needs registration. **Status:** Default — awaiting Management. The wording in `apps/api/src/modules/volunteers/service.ts` is a draft.

### TBD-49 · Contact details shared between a volunteer and their target
- **Decision:** A volunteer sees the target's name and the coordinating person's name and mobile number (the startup leader's, or the jury member's). The target sees the volunteer's name and mobile number. Email addresses are never shown. Only saved (active) assignments are visible.
- **Why:** Coordination at the event needs a phone number; nothing in the requirements says which fields to share, so the minimum is used.
- **Approval:** Management, and Legal as part of the privacy notice (TBD-32). **Status:** Default — awaiting Management + Legal. **Built (Phase 6).**

### TBD-50 · Changing the jury rubric after scoring has started
- **Decision:** Allowed, as a new version. Submitted evaluations keep the version they used. Draft and reopened evaluations are validated and totalled against the **latest approved** version when next saved. Summaries are per version and never mixed.
- **Why:** Requirements do not say whether the rubric may change mid-event. This keeps every submitted score tied to the rules it was given under.
- **Trade-off:** If Management wants the rubric locked once the first score is submitted, that is one extra check in `createRubric`.
- **Approval:** Management. **Status:** Default — awaiting Management. **Built (Phase 6).**

### TBD-04 · Delegate requirements
- **Decision:** For 2026, delegates get **information only**: programme, venues, food, accommodation and travel details as published content. There is no room-allocation, travel-booking or check-in module.
- **Why:** RQ §3.7 confirms only viewing for delegates. RQ §12–13 limit scope to known requirements.
- **Approval:** Organisers. **Status:** Default — awaiting Organisers.

### TBD-30 · QR check-in, meal tracking, accommodation allocation
- **Decision:** Not built for 2026; the module boundaries stay disabled (PRD §2 table).
- **Why:** RQ §13: "No additional modules are confirmed".
- **Approval:** Organisers. **Status:** Default — awaiting Organisers.

### TBD-06 · Final schedule and venues
- **Decision:** Seed the tentative programme from RQ §2 as content labelled "tentative". Admin and Management update it in the content service; changes never need an app release (RQ §10).
- **Approval:** Organisers (final content). **Status:** Default — awaiting Organisers.
- **Built (Phase 7):** migration 0011 seeds the 2026 programme exactly as RQ §2 states it: the pre-event session on 17 December (13:30–17:30, with food), the seven 18 December items, forest trekking on 19 December, the three 20 December items, and GIET University, Gunupur as the venue. Only 17 December has times; the rest show "Time to be announced". Everything is marked "Tentative" and seeded as an **unpublished draft**: nothing appears on the website or in the app until Management reviews and publishes it. Tests: `apps/api/test/content.test.ts`.

### TBD-24 · Who maintains which information
- **Decision:**

  | Owner | Content types |
  |---|---|
  | Admin (official source) | Documents, emergency contacts, safety guidelines, static pages |
  | Management (operational) | Schedule items, venues, meals, accommodation, travel information, notices |

  Both can read everything, and each edit is audited.
- **Why:** This follows the RQ §10 table directly. Safety information is source information because it must not change casually on event days.
- **Approval:** Organisers. **Status:** Default — awaiting Organisers.
- **Built (Phase 7):** permissions `content.manage_source` (Admin) and `content.manage_operational` (Management), checked by type on every create, edit, publish and archive (`403 content_not_yours`); both roles can read everything in the console. Notices are `notice.publish` (Management only). Tests: `content.test.ts`, `notices.test.ts`.

### TBD-29 · Notice channels and "authorised groups"
- **Decision:** In-app plus push only (RQ §10). No WhatsApp, email or SMS broadcasts. "Authorised groups" are named lists that Management maintains, with explicit members; there is no rule engine.
- **Why:** RQ §10 confirms only in-app and push. Broadcasting over WhatsApp would need approved paid templates and opt-in, and SMS broadcasts would need DLT templates and per-message cost.
- **Approval:** Management. **Status:** Default — awaiting Management.
- **Built (Phase 7):**
  - Audiences: **everyone** (every participant of the edition), one or more **participant roles** (startup leaders, startup members, jury, volunteers, delegates), or one **authorised group**. Recipients are worked out on the server inside the edition: a person needs unrevoked access to that edition, a matching participant role (or group membership) and an account that is not deactivated. Staff and applicants without event access never receive participant notices (FR-NOT-05, AT-09).
  - Groups are named per edition; only participants of that edition can be members (API and a database trigger).
  - Each recipient gets an in-app notice; with push chosen, one push message per device registered at that moment. Management sees in-app reach and opens, and push status per device: waiting, handed to the push service, failed or cancelled. "Handed to the push service" is not presented as delivery (FR-NOT-04).
  - Tests: `notices.test.ts`; browser: `scripts/e2e_event_notices.py`.

### TBD-51 · Event documents: storage, file types and size
- **Decision:**
  - PDF, PNG or JPEG only, up to 10 MB each. The server checks the file's content against its declared type, so a renamed executable is refused.
  - Files go to a **private** Supabase Storage bucket (`event-documents`) in the same project (EXECUTION_PLAN: "Supabase Storage, private buckets, short-lived signed URLs").
  - A viewer gets a link valid for **60 seconds**, issued only after the API checks the document's audience (SEC-08). An out-of-audience, archived or other-edition document is reported as missing.
  - A document is never edited: a new file is a new version that replaces the old one, and the old one is kept.
  - Only the Admin uploads (TBD-24).
- **Why:** The requirements ask for event documents with role-based visibility (FR-EVT-14, -17) but do not say which formats. These three cover the event documents described in RQ §2 and keep active content (HTML, Office macros, archives) out.
- **Built (Phase 7):** a storage adapter with two backends: `supabase` (staging and production; not yet verified against the live bucket) and `database` (development and tests only; the production launch gate refuses it). Tests: `content.test.ts`.
- **Approval:** Organisers (formats and size). **Status:** Default — awaiting Organisers.

### TBD-52 · Push notification provider
- **Decision:** The **Expo push service**, which the app already uses through `expo-notifications` (EXECUTION_PLAN). It forwards to Firebase Cloud Messaging on Android and to Apple Push Notification service on iOS.
  - An EAS project, FCM credentials and an APNs key are needed, all under the organisation's accounts (TBD-36).
  - `EXPO_ACCESS_TOKEN` (enhanced push security) is a server-side secret.
  - The API records Expo's ticket and checks the receipt about 15 minutes later. A failed receipt marks the message failed; "device not registered" also disables that device.
- **Why:** One integration for both platforms, no extra server component, and no device-token handling per platform. The service is free at the event's scale.
- **Limits:** Expo Go on Android cannot receive remote push (since SDK 53), so push needs a development or store build of the app. The in-app inbox works everywhere.
- **Built (Phase 7):** the push sender, receipts check and device registration (`POST/DELETE /v1/me/push-tokens`). Tested against the documented request formats with recorded responses only; **not verified with live credentials or a real device**.
- **Approval:** Organisers (accounts) and Budget. **Status:** Default — awaiting Organisers + Budget.

### TBD-53 · Drafts, corrections and push timing
- **Decision:**
  - Event information: every edit is a draft that users do not see until someone with the right permission publishes it with a change summary. Each publish is a numbered version; earlier versions are kept. Items are archived, never deleted.
  - Notices: a published notice's **text** may be corrected with a reason; inboxes show the corrected text, and pushes not yet sent go out corrected. The **audience, edition and push choice** are fixed: to reach different people, withdraw it and publish a new one. A withdrawn notice disappears from inboxes and cancels unsent pushes; it is kept with its reason.
  - Push goes only to devices registered when the notice is published. Someone who installs the app later sees the notice in their inbox, without a push.
- **Why:** FR-EVT-16 asks for drafts, versions and change summaries. FR-NOT-06 asks for audited edits and withdrawals; letting the audience change after sending would make the recipient list and the audit unreliable.
- **Built (Phase 7):** API, database triggers (live content changes only by a publish; notices keep their audience; nothing is deleted) and tests.
- **Approval:** Management. **Status:** Default — awaiting Management.

### TBD-14 · Result notification channels
- **Decision:** In-app (built) **plus one message to the applicant's verified sign-in contact**: email, or SMS for applicants who signed in only with a mobile number. No WhatsApp. The draft wording in `notifications/service.ts` needs Management approval.
- **Why:** An applicant may not open the app or website, and results are time-critical. The verified contact is the one address the platform knows reaches them.
- **Built (Phase 5):** release queues one email or SMS per result in the same transaction (the `notifications` outbox), and the worker delivers it with retries (up to 6 attempts with backoff). Management sees each message's status on the application page. Without a provider, a message stays **queued** and is never reported as sent. SMS bodies carry no outcome and use DLT templates by id.
- **Dependency:** Live email and SMS providers (TBD-35).
- **Approval:** Management (channels and wording). **Status:** Default — awaiting Management.

## D. Identity and accounts

### TBD-12 · Sign-in identifier (P0)
- **Decision:** **Both email and mobile.**
  - Email OTP is available from launch.
  - SMS OTP is switched on (`NEXT_PUBLIC_SIGNIN_METHODS` / `EXPO_PUBLIC_SIGNIN_METHODS = email,phone`) only after the DLT sender and template are approved and device case D2 passes.
  - Until then, staging and production set `email`.
- **Why:**
  - Imported participants may have only a mobile number (RQ §5).
  - WhatsApp recognition depends on mobile numbers (RQ §11.2).
  - Email has no DLT dependency, so registration can open on time.
  - Account linking already proves either identifier securely.
- **Trade-offs:** Mobile-only applicants must wait for SMS or use an email. The code default stays `email,phone` for development; each deployed environment sets the value explicitly.
- **Approval:** Organisers. **Status:** Default — awaiting Organisers.

### TBD-13 · Activation delivery channel (P0)
- **Decision:**
  - Codes go to the participant's **own contact on file**: email if the import has one, otherwise SMS. Never to a third party.
  - Validity **72 hours** (`ACTIVATION_TTL_HOURS`), single use; reissuing revokes the old code (built).
  - Until the providers exist, the Admin hands the code over privately (built, `delivery: "manual"`).
- **Why:** Sending to the contact the organisers hold binds activation to that contact (FR-IAM-10). 72 hours balances exposure of a leaked code against participants who read messages late.
- **Built (Phase 5):** when the participant's channel has a configured provider, the code goes into the outbox and the Admin never sees it. Its stored copy is scrubbed after delivery or final failure. Otherwise the code is shown once for manual hand-over, as before.
- **Dependency:** Providers (TBD-35).
- **Approval:** Organisers. **Status:** Default — awaiting Organisers.

### TBD-41 · Import file format (P0)
- **Decision:**
  - CSV, UTF-8 (Excel's "CSV UTF-8"), one file per category.
  - **Column set v1** as built (`IMPORT_COLUMNS`). Every row needs a full name and at least one of email or mobile, and both are recommended (mobile is needed for WhatsApp).
  - No XLSX and no password columns.
- **Why:**
  - Plain CSV avoids macro and formula payloads.
  - Validation, duplicate detection, formula-injection rejection and malformed-row checks are already built and tested for this format.
- **Approval:** Organisers sign off one real sample file per category (B-03). **Status:** Default — awaiting Organisers.

### TBD-36 · Account ownership (P0)
- **Decision:**
  - The **organisers' legal entity** owns every account: Apple Developer, Google Play, WhatsApp Business (Meta), Google Cloud, Supabase organisation, Vercel team, domain and GitHub organisation.
  - It should be the same entity named as Data Fiduciary in the privacy notice.
  - Zeny2Labs gets member or admin access, never ownership.
  - Store accounts are **organisation** accounts.
- **Why:**
  - The data and the event belong to the organisers.
  - A Google Play *personal* account created after 13 Nov 2023 must run a 14-day closed test with at least 12 testers before production access; organisation accounts are exempt. That alone could miss the store window.
  - Organisation accounts need a D-U-N-S number, which can take up to 30 days, so it must be requested now.
- **Approval:** Organisers (which entity, GIET University or ISF). **Status:** Default — awaiting Organisers.

## E. Help Desk and support

### TBD-25 · Help Desk access on the website
- **Decision:** The website links to the **WhatsApp Help Desk** (click-to-chat link to the official number) and to the app. There is no separate web chat. Unauthenticated users get public information only.
- **Why:** RQ §11.1 defines exactly two channels, the app and WhatsApp, for one Help Desk. A web chat would be a third channel to build and secure.
- **Approval:** Organisers. **Status:** Default — awaiting Organisers.

### TBD-26 · Languages
- **Decision:** English for all interfaces and Help Desk answers in 2026 (PRD A-07). All text is externalised, so Odia or Hindi can be added through change control.
- **Approval:** Organisers. **Status:** Default — awaiting Organisers.

### TBD-07 · Emergency contacts and escalation (P0)
- **Decision:**
  - Every emergency screen and reply always shows **112**, India's national emergency number, first. Neither the AI nor support staff stand in the way (RQ §11.5).
  - The organisers supply campus security, medical (first aid or ambulance) and event control-room numbers before Phase 8 goes live.
  - Escalation follows TBD-27.
- **Why:** RQ §11.5: never delay access to emergency services. 112 is a public, nationwide number; the venue numbers can only come from the organisers.
- **Approval:** Organisers (venue numbers and procedure). **Status:** Default — awaiting Organisers.

### TBD-27 · Escalation targets and acknowledgement windows (P0)
- **Decision:** Acknowledgement windows, configurable per edition:

  | Priority | Acknowledge within | If missed |
  |---|---|---|
  | Emergency | 5 minutes | Escalate to the Management duty lead, then the event director |
  | High | 30 minutes | Escalate to the Management duty lead |
  | Normal, event days (17–20 Dec, 07:00–22:00 IST) | 2 hours | Flag for the support shift lead |
  | Normal, other days | 1 working day | Flag for the support shift lead |

  Escalation is recorded as an attribute; the four statuses do not change (FR-SUP-12).
- **Approval:** Organisers (names and times). **Status:** Default — awaiting Organisers.

### TBD-28 · Support staffing and alert channel (P0)
- **Decision:** A minimum roster:
  - 17–20 Dec, 07:00–22:00 IST: **2** support staff per shift, plus 1 person on call overnight for emergencies.
  - Other days: one person, 10:00–18:00 IST, Monday to Saturday.
  - On-duty alerts go to the dashboard **plus SMS to the on-duty phone**, with the DLT template registered together with the OTP template.
- **Why:** This is the smallest roster that can meet the TBD-27 emergency window. SMS reaches staff away from a screen.
- **Approval:** Organisers (roster and names). **Status:** Default — awaiting Organisers.

### TBD-27 / TBD-28 · What Phase 8 built, and what it did not
- **Built:** per-edition windows stored as edition data (`event_editions.support_policy`, checked by the database), changed by Management in the console and audited. Defaults: emergency 5 min, high 30 min, normal 120 min; urgent re-alerts every 1 min (emergency) or 10 min (high), at most 20 rounds. These are the recommendation above, **not approved values**.
- **Not built, pending the organisers' answer:**
  - The normal window is one number. The "2 h on event days, 1 working day otherwise" split and a working-day calendar are not modelled.
  - Escalation goes to **every active Management account**, standing in for the "Management duty lead". There is no duty-lead or shift-lead role and no second step to an event director.
  - There is no roster (TBD-28). Alerts go to every active Customer Support account on the dashboard; **no SMS alerts** are sent (no DLT template, no on-duty phone). Staff must keep the Support page open; it polls every 15 seconds.
- **Approval:** Organisers (windows, names, roster, alert channel). No staffing commitment is implied by the built defaults.

### TBD-54 · AI Help Desk design (app)
- **Decision:**
  - The Help Desk answers only from **official published event information** visible to the person and **their own records** (application status, startup, volunteer or assignment, jury schedule, own tickets). Each source is a server-side tool that checks the person's role and edition access itself and takes no identifier from the question.
  - Before any model call, deterministic checks run in order: emergency wording (→ 112 and the emergency path, no model), a request for a person (→ ticket), prompt-injection or data-extraction wording (→ fixed refusal, audited).
  - The model receives the tool results as data with fixed instructions, and must return JSON (`answer`, `outcome`). Anything else, a timeout or no configured model gives a fixed fallback answer with "Ask a person". An answer containing a phone number, email or identifier not present in the data given to it is blocked and audited.
  - Provider: Google Vertex AI (TBD-35) with a **Help Desk-only** configuration and service account (`HELPDESK_*`), separate from ranking (FR-HD-20). `stub` is a development stand-in that is **not an AI** and is refused in production by the launch gate; `none` gives fallback answers only.
  - The engine is channel-agnostic: a channel adapter supplies an authenticated identity. **WhatsApp is not built here**; it belongs to a separate workstream and would add its own adapter.
- **Why:** FR-HD-05…07, -13, -20 and PRD §8.3 (scoped tools, guardrails). Deterministic checks keep emergencies and injection out of the model's hands.
- **Built (Phase 8):** API, transcripts (append-only), tests in `helpdesk.test.ts`, browser flow `scripts/e2e_support.py`. **Not verified with a live model.**
- **Approval:** Management (scope of answers). **Status:** Default — awaiting Management.

### TBD-55 · Emergency control behaviour
- **Decision:**
  - The app's header has an **Emergency** button on every screen, signed in or not. Its screen shows **Call 112** first; nothing (network, sign-in, the alert) is awaited before it. Published venue numbers follow, cached on the device for offline use. No number is invented.
  - Alerting the support team is a **second, explicit tap** (avoids accidental emergency tickets), with an optional description. Retries reuse one request id, so a retry never opens a second ticket.
  - One open emergency per person: a new report while one is open is added to it and re-alerts staff at once.
  - An emergency in the Help Desk chat gets the same answer (112 first) and the same ticket, without the model.
  - If the alert cannot be recorded, the person is told plainly and still sees 112.
- **Approval:** Organisers. **Status:** Default — awaiting Organisers.

### TBD-56 · Ticket lifecycle details
- **Decision:** The four DC-08 statuses only. Open → Acknowledged → In Progress → Resolved, or Acknowledged → Resolved. Resolution needs notes. **Resolved is final** (no reopening; the requester starts a new request). Priority and the emergency flag can be raised, never lowered. Escalation is an attribute that cannot be withdrawn. Assignment only to active Customer Support staff. Internal notes are never shown to requesters; replies are, with an in-app notification. Tickets and their history are never deleted. All enforced in the database as well as the API.
- **Approval:** Management. **Status:** Default — awaiting Management.

### TBD-57 · Re-alert and escalation mechanics
- **Decision:** A sweep runs with the background workers. Unacknowledged emergency and high-priority tickets re-alert every support person on the configured interval, up to the configured maximum; once escalated, Management is included. At the window, the ticket is escalated automatically (recorded with no human actor). Normal tickets past their window are flagged overdue once. If no Customer Support account is active, Management is alerted instead, so an emergency is never unseen. Each ticket is locked while swept, so parallel workers never double-escalate.
- **Approval:** Organisers (with TBD-27/28). **Status:** Default — awaiting Organisers.

### TBD-31 · Report and export permissions
- **Decision:**
  - Export is a separate permission from viewing (FR-RPT-04).
  - **Admin** exports the data it administers (accounts, imports, volunteer assignments).
  - **Management** exports applications, selection and jury results.
  - Support and participants never export.
  - Every export is audited and goes through `platform/csv-export.ts` (formula-injection escaping).
- **Approval:** Organisers. **Status:** Default — awaiting Organisers. Built in Phase 9.

### OD-01 · WhatsApp number verification (PRD §11, was "TBD" without a number)
- **Decision:** A **link code shown in the signed-in app**, sent from WhatsApp, links that number to the account. A number that matches no account, several accounts or a changed number gets public information only.
- **Why:**
  - Being signed in to the app proves the account, and the WhatsApp message proves the number.
  - It needs no SMS or email cost, and no code travels over a channel an attacker could intercept.
- **Status:** **Decided** (security design). Built in Phase 8.

## F. Privacy, operations, vendors and budget

### TBD-32 · Data retention, privacy notice and data-protection compliance (P0)
- **Decision:**
  - Adopt the draft notice in [PRIVACY_NOTICE_DRAFT.md](/docs/PRIVACY_NOTICE_DRAFT.md), which follows the notice contents in Rule 3 of the DPDP Rules, 2025, and the retention schedule below.
  - **Legal approval is mandatory.** The production launch gate refuses to start while `PRIVACY_NOTICE_VERSION` is a draft.

  | Data | Keep until |
  |---|---|
  | Applications not selected, and their AI outputs | 6 months after that edition's event ends; then delete. A separate application for another year is unaffected. |
  | Selected applications, decisions, jury evaluations | 2 years after the event, for accountability; then delete or anonymise |
  | Accounts and contact details | 6 months after the person's last edition ends; then delete or anonymise |
  | Help Desk transcripts | 90 days after the event |
  | Support and emergency tickets | 1 year after closure |
  | Audit and security logs | **At least 1 year** from each logged action (log-retention requirement in the DPDP Rules, 2025; Legal to confirm the rule reference) |
  | Raw import rows | 30 days after commit (the batch summary is kept) |
  | Activation code hashes | 90 days after use or expiry |
  | Backups | The provider's rolling window (TBD-33) |

- **Why:**
  - The shortest periods that still serve each purpose (data minimisation).
  - The DPDP Rules, 2025 were notified on 14 Nov 2025. Most Data Fiduciary obligations start 18 months later (around May 2027), so they will apply to the 2027 edition; complying now avoids rework.
  - Data of under-18s is avoided by TBD-45.
- **Dependency:** Legal must confirm:
  - the Data Fiduciary entity and grievance contact;
  - consent wording;
  - whether Rule 8's 48-hour pre-erasure notice applies;
  - cross-border processing by vendors (TBD-35);
  - breach procedure.
- **Approval:** **Legal** and Organisers. **Status:** Default — awaiting Legal. The purge jobs are built in Phase 9.

### TBD-33 · Peak load, performance, availability, RPO and RTO (P0)
- **Decision:**
  - **Design load:** 3,000 accounts (the RQ §1 upper estimate) and 600 concurrent active users.
  - **Load test** at **2×**: 1,200 virtual users for 15 minutes on the registration-close and event-morning journeys.
  - **Performance:** p95 below 500 ms for authenticated reads (PRD NFR-02) and errors below 1 %.
  - **Availability:** 99.5 % monthly.
  - **Critical windows:** 1–6 Nov and 15–21 Dec 2026, with on-call and a change freeze.
  - **RPO:** 5 minutes or less inside the critical windows (Supabase PITR on); 24 hours or less otherwise (daily backups).
  - **RTO:** 4 hours or less, proven by a restore drill on staging before 10 Dec (AT-36).
- **Why:** These targets are sized from the only number in the sources, and PITR is paid for only when losing data would hurt most.
- **Approval:** Organisers, and Budget for PITR. **Status:** Default — awaiting Organisers + Budget.

### TBD-34 · Supported OS versions and browsers
- **Decision:**
  - **Android 7+ and iOS 16.4+**, the minimums of Expo SDK 57 / React Native 0.86 used by the app.
  - The test matrix covers the current and two previous major OS versions.
  - The website and console support the last two versions of Chrome, Safari, Edge, Firefox and Samsung Internet.
- **Why:** Using the toolchain minimum reaches the most phones at no extra cost, and the matrix keeps testing realistic.
- **Status:** **Decided** (Zeny2Labs).

### TBD-35 · Vendors (P0)
- **Decision:**

  | Need | Choice | Why |
  |---|---|---|
  | Language model, ranking and Help Desk | **Google Vertex AI**, in the same Google Cloud project as hosting. Separate service accounts, keys and configuration per AI function (FR-RNK-12, FR-HD-20). Regional endpoint, India (asia-south1) where the chosen model is served there. Model picked by an evaluation on synthetic data in Phase 5. | One cloud contract and data-processing agreement with hosting. IAM-native separation of the two AI functions. The provider adapter keeps the vendor replaceable. |
  | WhatsApp | **Meta WhatsApp Cloud API** directly, with no BSP | No reseller markup. User-initiated service messages are free, and utility templates are free inside the 24-hour window. Meta business verification of the owning entity takes time, so start it now. |
  | Email | **Amazon SES, Mumbai (ap-south-1)**, SMTP for Supabase Auth and API mail | Supabase's built-in email reaches only team members at about 2 per hour, so custom SMTP is required. SES costs USD 0.10 per 1,000 emails, has an India region, and usually approves production access within 1–2 days. Needs SPF, DKIM and DMARC on the sender domain. |
  | SMS | A **DLT-compliant Indian aggregator** (default MSG91, subject to quotation), through Supabase's **Send SMS hook** | Domestic delivery under a registered sender ID. International routes skip DLT but show random numbers. Supabase's documented example for India is MSG91. |

- **Built (Phase 5):**
  - adapters for Vertex AI (with an optional ranking-only service account, impersonated), SMTP and MSG91, tested against their documented request formats with recorded responses;
  - `pnpm --filter @sj/api ranking:eval`, which runs the evaluation on synthetic applications.

  Phase 7 adds the Expo push sender (TBD-52) and the Supabase Storage adapter (TBD-51), tested the same way.

  **None has been exercised against a live account yet**; that is launch checklist §B.
- **Neutrality note:** This register was drafted with an AI assistant from Anthropic, a model vendor itself. The model platform was chosen for consolidation with hosting, not by model brand, and the adapter allows switching.
- **Approval:** Organisers and Budget (contracts and DPAs); Legal (cross-border processing). **Status:** Default — awaiting Organisers + Budget.

### TBD-46 · Budget and hosting region (P0)
- **Decision:** India regions, as in EXECUTION_PLAN §1:
  - Supabase **Pro**, ap-south-1, for production; staging stays on the free plan, which pauses after a week of inactivity;
  - API and workers on **Google Cloud Run asia-south1**;
  - website and console on **Vercel Pro** (bom1). Vercel's Hobby plan is for non-commercial personal use only.

  **Indicative budget** (USD, before taxes; Budget approves a ceiling):

  | Item | Cost |
  |---|---|
  | Supabase Pro (includes USD 10 compute credit) | 25 / month |
  | Supabase PITR (7-day), only in the TBD-33 windows | 100 / month while on |
  | Vercel Pro, 1 developer seat | 20 / month |
  | Cloud Run, SES, logs | Usage-based; low at this volume |
  | Apple Developer Program | 99 / year |
  | Google Play | 25 one-time |
  | Domain | ~1,000 INR / year |
  | Vertex AI, SMS, WhatsApp templates | Usage-based |

  Budget alerts are set on every usage-based service.
- **Why:** India regions keep latency low and data in India where the service allows. All are managed services, which suits a small team.
- **Approval:** **Budget** (organisers). **Status:** Default — awaiting Budget.

### TBD-10 · Features added later by management
- **Decision:** Change control:
  1. a written change request;
  2. a Zeny2Labs impact assessment covering scope, schedule, security and cost;
  3. Management approval;
  4. a PRD revision.

  From the change freeze on 15 Dec, only critical fixes go in.
- **Approval:** Management. **Status:** Default — awaiting Management.

### OD-02 · iOS keychain survives reinstall (DEVICE_TEST_PROTOCOL D8)
- **Decision:** **Sign out on the first launch after any reinstall**, on both platforms. The app keeps a marker in app storage, which iOS deletes on uninstall, and clears the keychain session when the marker is missing.
- **Why:**
  - A reinstall should not silently restore a session; the device may have changed hands.
  - The behaviour becomes the same on Android and iOS.
  - Signing in again takes seconds.
- **Status:** **Decided** (security). **Not built yet.** It was listed under Phase 6, but the Phase 6 delivery covered jury and volunteers only. It must be built before store submission (Phase 10), and D8 must then show "signed out" on both platforms.

### OD-03 · Maps and venue navigation (PRD §8, was "TBD (not in RQ)")
- **Decision:** Static map links inside venue content. No maps SDK or API key.
- **Why:** RQ requires venue information, not navigation. Links have no cost or key to protect.
- **Status:** **Decided**.

### OD-04 · Repository visibility (LAUNCH_CHECKLIST §A)
- **Decision:** **Private** until launch approval. CI and the code are unaffected.
- **Why:** The repository holds security design and staging identifiers. Nothing requires it to be public.
- **Approval:** The repository owner. This change does not alter it. **Status:** Default — awaiting repo owner.

### OD-05 · Descope order if the schedule slips (EXECUTION_PLAN §8)
- **Decision:** Pre-approve the proposed order with dated checkpoints:
  1. If WhatsApp business verification is not complete by **25 Nov**, launch the in-app Help Desk only.
  2. If Phase 9 is not on track by **5 Dec**, ship without the offline cache.
  3. Ship only the core reports.

  The registration website is never descoped.
- **Approval:** Organisers. **Status:** Default — awaiting Organisers.

---

## What this register changed in the repository (15 Oct 2026)

| Decision | Change |
|---|---|
| TBD-19 | Release above the selection limit requires `confirmOverLimit`. A 409 `selection_limit_exceeded` otherwise. Releases are serialised per edition. A separate audit event is written. The console asks for confirmation. |
| TBD-39 | Migration `0007_application_form.sql`: `event_editions.application_form` (six questions, version `2026-10-15`), a trigger that freezes it once applications exist, and `applications.form_version`. The API validates answers against the configuration. The website and app render the questions. |
| TBD-45 | `adultDeclaration` (must be `true`) in `RegistrationRequest`, in the website and app forms, and recorded in the `registration.submitted` audit event. |
| All | Code comments, console text and docs now cite this register instead of "not decided". |
| Phase 5 (15 Oct 2026) | Migrations `0008_ranking_selection.sql` and `0009_ranking_worker_set_role.sql`, and the ranking, outbox and correction modules build TBD-01, -13, -14, -18, -37, -42 and -44 and the TBD-35 adapters. See [PHASES.md](PHASES.md) for details. |
| Phase 6 (15 Oct 2026) | Migration `0010_jury_volunteers.sql` and the `jury` and `volunteers` modules build TBD-20, -21, -22, -23 and -43. New defaults TBD-47…50 record the choices the requirements leave open. See [PHASES.md](PHASES.md). |
| Phase 7 (16 Oct 2026) | Migration `0011_event_content_notices.sql` and the `content` and `notices` modules build TBD-06, -24 and -29. New defaults TBD-51…53 record the choices the requirements leave open (documents, push provider, drafts and corrections). See [PHASES.md](PHASES.md). |

Sources for vendor and legal facts (checked 15 Oct 2026):
- [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase Send SMS hook](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook)
- [Supabase phone login](https://supabase.com/docs/guides/auth/phone-login)
- [Twilio India SMS guidelines](https://www.twilio.com/en-us/guidelines/in/sms)
- [WhatsApp pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [Vercel Hobby](https://vercel.com/docs/plans/hobby)
- [Google Play testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465)
- [Expo SDK versions](https://docs.expo.dev/versions/latest/)
- [DPDP Rules 2025 summary (SCC Online)](https://www.scconline.com/blog/post/2025/12/26/digital-personal-data-protection-rules-2025-key-highlights/)
- Supabase pricing summary ([Makerkit](https://makerkit.dev/blog/saas/supabase-pricing))
- SES pricing summary ([rohitraj.tech](https://rohitraj.tech/notes/resend-vs-sendgrid-vs-aws-ses-india-mvp-2026))

Re-check prices and vendor terms when contracting.
