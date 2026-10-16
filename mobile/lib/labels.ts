import type { ApplicantStatus, Role } from "@sj/contracts";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin", management: "Management Team", startup_team_leader: "Startup Team Leader", startup_team_member: "Startup Team Member",
  jury_member: "Jury Member", volunteer: "Volunteer", delegate: "Delegate", customer_support: "Customer Support",
};
export const STAFF_ROLES: Role[] = ["admin", "management", "customer_support"];
export const STATUS_LABEL: Record<ApplicantStatus, string> = { under_review: "Under review", selected: "Selected", not_selected: "Not selected", withdrawn: "Withdrawn" };
export const STATUS_TONE: Record<ApplicantStatus, "warn" | "ok" | "neutral"> = { under_review: "warn", selected: "ok", not_selected: "neutral", withdrawn: "neutral" };
