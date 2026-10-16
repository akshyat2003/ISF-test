// Role → permission mapping. Default deny: a route without a matching permission is not reachable.
// Grows milestone by milestone; mirrors the PRD role-permission matrix (§4.4). Every entry is test-covered.
import type { Role } from "@sj/contracts";

export type Permission =
  // any signed-in user (M1)
  | "registration.submit"
  | "application.read_own"
  | "notification.read_own"
  | "application.withdraw_own"
  // management (M1)
  | "application.read_all"
  | "decision.draft"
  | "decision.release"
  | "selection_limit.configure"
  // management (Phase 5: AI ranking, corrections)
  | "criteria.manage"
  | "ranking.run"
  | "ranking.read"
  | "decision.correct"
  // Phase 6: jury evaluation (FR-JRY-*) — Management configures and reviews; jurors evaluate their own assignments
  | "jury.manage"
  | "jury.review"
  | "jury.evaluate"
  // Phase 6: volunteer assignment (FR-VOL-*, PRD §4.4 matrix)
  | "volunteer.read"
  | "volunteer.generate"
  | "volunteer.review"
  | "volunteer.reassign"
  | "volunteer.my_assignment"
  | "volunteer.my_volunteer"
  // Phase 7: event information and notices (FR-EVT-*, FR-NOT-*; TBD-24 splits who maintains which content)
  | "content.read_all"
  | "content.manage_source"
  | "content.manage_operational"
  | "notice.publish"
  | "push.register_own"
  // Phase 8: AI Help Desk (app), support tickets and emergencies (FR-HD-*, FR-SUP-*; RQ §11). Requesters act on their
  // own conversations and tickets only; support staff handle tickets; Management reviews (PRD §4.4 matrix "R").
  | "helpdesk.use"
  | "support.request_own"
  | "emergency.report"
  | "support.handle"
  | "support.review"
  | "support.alerts"
  | "support.configure"
  // admin (Phase 3)
  | "import.manage"
  | "user.read"
  | "user.manage"
  | "role.assign"
  | "activation.issue";

/** Granted to every authenticated principal regardless of role. */
export const AUTHENTICATED: ReadonlySet<Permission> = new Set([
  "registration.submit", "application.read_own", "notification.read_own", "application.withdraw_own", "push.register_own",
  // Phase 8: everyone signed in can use the Help Desk, raise and follow their own tickets, and report an emergency.
  // The emergency control is never gated on a role or on edition access (RQ §11.5).
  "helpdesk.use", "support.request_own", "emergency.report",
]);

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  // FR-IAM-06: Admin holds NO management permissions unless also granted the `management` role.
  // RQ §9: the Admin initiates or oversees volunteer assignment; saving (review) and reassignment are Management's.
  // TBD-24: the Admin maintains the official source information (documents, emergency contacts, safety, pages).
  admin: ["import.manage", "user.read", "user.manage", "role.assign", "activation.issue", "volunteer.read", "volunteer.generate",
    "content.read_all", "content.manage_source"],
  management: [
    "application.read_all", "decision.draft", "decision.release", "selection_limit.configure",
    "criteria.manage", "ranking.run", "ranking.read", "decision.correct",
    "jury.manage", "jury.review",
    "volunteer.read", "volunteer.generate", "volunteer.review", "volunteer.reassign",
    // TBD-24: operational information (schedule, venues, food, accommodation, travel) and notices.
    "content.read_all", "content.manage_operational", "notice.publish",
    // Phase 8: Management reviews support issues read-only (FR-SUP-10), receives escalations (TBD-27) and sets the
    // per-edition acknowledgement windows.
    "support.review", "support.alerts", "support.configure",
  ],
  // Participant permissions are further limited to the caller's own startup, assignments and edition on the server.
  startup_team_leader: ["volunteer.my_volunteer"],
  startup_team_member: [],
  jury_member: ["jury.evaluate", "volunteer.my_volunteer"],
  volunteer: ["volunteer.my_assignment"],
  delegate: [],
  // RQ §3.8: handle tickets and emergency alerts (FR-SUP-01…09).
  customer_support: ["support.handle", "support.alerts"],
};

/** Roles whose permissions require an MFA (aal2) session when REQUIRE_STAFF_MFA=true (FR-IAM-11). */
export const STAFF_ROLES: ReadonlySet<Role> = new Set(["admin", "management", "customer_support"]);
