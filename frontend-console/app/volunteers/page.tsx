"use client";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, formatIst } from "@sj/client";
import type { VolunteerAssignmentItem, VolunteerOverview, VolunteerTarget } from "@sj/contracts";
import { can, useMe } from "@/lib/me";
import { api, useSessionEmail } from "@/lib/session";
import { MfaPrompt } from "../mfa-prompt";

export type VolunteerDeskItem = {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  mobile: string;
  altMobile: string | null;
  organisationName: string;
  redgNo: string;
  rollNo: string;
  city: string;
  state: string;
  country: string;
  linkedinUrl: string | null;
  photoUrl: string | null;
  editionId: number;
  createdAt: string;
  updatedAt: string;
  accountStatus: string;
  activatedAt: string | null;
  assignmentId: string | null;
  assignmentState: string | null;
  assignedSince: string | null;
  assignmentReason: string | null;
  targetType: "startup" | "jury" | null;
  targetId: string | null;
  targetName: string | null;
};

const targetLabel = (t: VolunteerTarget) => `${t.name} (${t.type === "startup" ? "startup" : "jury member"})`;
const targetValue = (t: { type: string; id: string }) => `${t.type}:${t.id}`;
const parseTarget = (v: string) => {
  const [type, id] = v.split(":");
  return { type: type as "startup" | "jury", id: id! };
};

/** Delivery status exactly as recorded */
function Delivery({ a }: { a: VolunteerAssignmentItem }) {
  if (!a.notifications.length) return <span className="muted small">No messages</span>;
  return (
    <ul className="small plain">
      {a.notifications.map((n, i) => (
        <li key={i}>
          {n.recipient === "volunteer" ? "Volunteer" : "Target"} · {n.channel.replace("_", "-")}:{" "}
          <span className="status">{n.status}</span>
        </li>
      ))}
    </ul>
  );
}

function compressImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new window.Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 800;
        const MAX_HEIGHT = 800;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width = Math.round((width * MAX_HEIGHT) / height);
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(event.target?.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => resolve(event.target?.result as string);
    };
    reader.onerror = (err) => reject(err);
  });
}

function getAuthToken(): string {
  if (typeof window === "undefined") return "";
  function getCookie(name: string): string | null {
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]!) : null;
  }
  return (
    sessionStorage.getItem("sj.console.session") ||
    sessionStorage.getItem("sj_token") ||
    localStorage.getItem("sj.console.session") ||
    localStorage.getItem("sj_token") ||
    getCookie("sj.console.session") ||
    getCookie("sj_token") ||
    ""
  );
}

async function authFetch(path: string, init?: RequestInit) {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    ...((init?.headers as Record<string, string>) || {}),
  };
  if (token && !headers["authorization"]) {
    headers["authorization"] = `Bearer ${token}`;
  }
  return fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });
}

function VolunteersContent() {
  const email = useSessionEmail();
  const { me } = useMe();
  const router = useRouter();
  const searchParams = useSearchParams();
  const year = Number(searchParams.get("edition") ?? 2026);
  const currentTab = searchParams.get("tab") === "assignments" ? "assignments" : "desk";

  // Tab 1: Volunteer Desk State
  const [volunteers, setVolunteers] = useState<VolunteerDeskItem[]>([]);
  const [deskSummary, setDeskSummary] = useState({
    totalVolunteers: 0,
    assignedCount: 0,
    unassignedCount: 0,
    organisationsCount: 0,
    availableColleges: [] as string[],
  });
  const [loadingDesk, setLoadingDesk] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [collegeFilter, setCollegeFilter] = useState("all");
  const [assignmentFilter, setAssignmentFilter] = useState<"all" | "assigned" | "unassigned">("all");

  // Modals & Action State
  const [modalMode, setModalMode] = useState<"add" | "edit" | "delete" | "badge" | "assign" | null>(null);
  const [selectedVolunteer, setSelectedVolunteer] = useState<VolunteerDeskItem | null>(null);

  // Form Fields State
  const [formFullName, setFormFullName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPassword, setFormPassword] = useState("Volunteer@2026!");
  const [formMobile, setFormMobile] = useState("");
  const [formAltMobile, setFormAltMobile] = useState("");
  const [formOrganisationName, setFormOrganisationName] = useState("GIET University");
  const [formRedgNo, setFormRedgNo] = useState("");
  const [formRollNo, setFormRollNo] = useState("");
  const [formCity, setFormCity] = useState("Gunupur");
  const [formState, setFormState] = useState("Odisha");
  const [formCountry, setFormCountry] = useState("India");
  const [formLinkedinUrl, setFormLinkedinUrl] = useState("");
  const [formPhotoUrl, setFormPhotoUrl] = useState("");
  const [formAccountStatus, setFormAccountStatus] = useState("active");

  // Quick Assign form state
  const [quickTarget, setQuickTarget] = useState("");
  const [quickReason, setQuickReason] = useState("Assigned via Volunteer Operations Desk");

  // Tab 2: Assignment Engine State
  const [o, setO] = useState<VolunteerOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [change, setChange] = useState<{ id: string; mode: "reassign" | "close"; volunteer: string; target: string; reason: string } | null>(null);
  const [manual, setManual] = useState({ volunteer: "", target: "", reason: "" });

  const mayGenerate = can(me, "volunteer.generate") || me?.roles.includes("admin") || me?.roles.includes("management");
  const mayReview = can(me, "volunteer.review") || me?.roles.includes("admin") || me?.roles.includes("management");
  const mayChange = can(me, "volunteer.reassign") || me?.roles.includes("admin") || me?.roles.includes("management");

  // Load Volunteer Desk records from database
  const loadDesk = useCallback(async () => {
    setLoadingDesk(true);
    try {
      const qParams = new URLSearchParams();
      qParams.set("edition", String(year));
      if (searchQuery.trim()) qParams.set("q", searchQuery.trim());
      if (collegeFilter !== "all") qParams.set("organisation", collegeFilter);
      if (assignmentFilter !== "all") qParams.set("assignment", assignmentFilter);

      const res = await authFetch(`/v1/manage/volunteers?${qParams.toString()}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch volunteers: ${res.statusText}`);
      }
      const data = await res.json();
      if (data.ok) {
        setVolunteers(data.items || []);
        if (data.summary) {
          setDeskSummary(data.summary);
        }
      }
    } catch (err: any) {
      console.error("[LOAD DESK ERROR]", err);
      setError((err as Error).message);
    } finally {
      setLoadingDesk(false);
    }
  }, [year, searchQuery, collegeFilter, assignmentFilter]);

  // Load Assignment Engine overview
  const loadAssignments = useCallback(async () => {
    try {
      setO(await api.manage.volunteers(year));
      setError(null);
    } catch (e) {
      try {
        const fallbackRes = await authFetch(`/v1/manage/editions/${year}/volunteers`);
        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json();
          setO(fallbackData);
          setError(null);
          return;
        }
      } catch {}
      setError(
        e instanceof ApiError && e.code === "mfa_required"
          ? "mfa_required"
          : e instanceof ApiError && e.status === 403
          ? "Your account cannot view volunteer assignments."
          : (e as Error).message
      );
    }
  }, [year]);

  useEffect(() => {
    if (email) {
      void loadDesk();
      void loadAssignments();
    }
  }, [email, loadDesk, loadAssignments]);

  useEffect(() => {
    if (email === null) router.replace("/login?next=/volunteers");
  }, [email, router]);

  // Generic helper for assignment actions
  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await fn();
      if (ok) setMessage(ok);
      await Promise.allSettled([loadAssignments(), loadDesk()]);
    } catch (e) {
      setError(
        e instanceof ApiError && e.problem.errors?.length
          ? e.problem.errors.map((x) => x.message).join(" ")
          : (e as Error).message
      );
    } finally {
      setBusy(false);
    }
  }

  // Open Modal Helpers
  function openAddModal() {
    setFormFullName("");
    setFormEmail("");
    setFormPassword("Volunteer@2026!");
    setFormMobile("");
    setFormAltMobile("");
    setFormOrganisationName("GIET University");
    setFormRedgNo("");
    setFormRollNo("");
    setFormCity("Gunupur");
    setFormState("Odisha");
    setFormCountry("India");
    setFormLinkedinUrl("");
    setFormPhotoUrl("");
    setFormAccountStatus("active");
    setSelectedVolunteer(null);
    setModalMode("add");
    setMessage(null);
    setError(null);
  }

  function openEditModal(v: VolunteerDeskItem) {
    setSelectedVolunteer(v);
    setFormFullName(v.fullName);
    setFormEmail(v.email);
    setFormMobile(v.mobile);
    setFormAltMobile(v.altMobile || "");
    setFormOrganisationName(v.organisationName);
    setFormRedgNo(v.redgNo);
    setFormRollNo(v.rollNo);
    setFormCity(v.city);
    setFormState(v.state);
    setFormCountry(v.country);
    setFormLinkedinUrl(v.linkedinUrl || "");
    setFormPhotoUrl(v.photoUrl || "");
    setFormAccountStatus(v.accountStatus || "active");
    setModalMode("edit");
    setMessage(null);
    setError(null);
  }

  function openDeleteModal(v: VolunteerDeskItem) {
    setSelectedVolunteer(v);
    setModalMode("delete");
    setMessage(null);
    setError(null);
  }

  function openBadgeModal(v: VolunteerDeskItem) {
    setSelectedVolunteer(v);
    setModalMode("badge");
  }

  function openAssignModal(v: VolunteerDeskItem) {
    setSelectedVolunteer(v);
    setQuickTarget("");
    setQuickReason(`Assigned by operations desk at ${v.organisationName}`);
    setModalMode("assign");
  }

  // Photo change handler
  const photoInputRef = useRef<HTMLInputElement>(null);
  async function handlePhotoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageFile(file);
      setFormPhotoUrl(dataUrl);
    } catch (err) {
      setError("Failed to process photo upload.");
    }
  }

  // CRUD Submissions
  async function handleCreateVolunteer(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await authFetch("/v1/manage/volunteers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: formFullName.trim(),
          email: formEmail.trim().toLowerCase(),
          password: formPassword.trim(),
          mobile: formMobile.trim(),
          altMobile: formAltMobile.trim() || null,
          organisationName: formOrganisationName.trim(),
          redgNo: formRedgNo.trim(),
          rollNo: formRollNo.trim(),
          city: formCity.trim(),
          state: formState.trim(),
          country: formCountry.trim(),
          linkedinUrl: formLinkedinUrl.trim() || null,
          photoUrl: formPhotoUrl || null,
          edition: year,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.detail || "Failed to create volunteer.");
      }
      setMessage(`Volunteer ${formFullName} registered and accredited successfully!`);
      setModalMode(null);
      await Promise.allSettled([loadDesk(), loadAssignments()]);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateVolunteer(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedVolunteer) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await authFetch(`/v1/manage/volunteers/${selectedVolunteer.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: formFullName.trim(),
          email: formEmail.trim().toLowerCase(),
          mobile: formMobile.trim(),
          altMobile: formAltMobile.trim() || null,
          organisationName: formOrganisationName.trim(),
          redgNo: formRedgNo.trim(),
          rollNo: formRollNo.trim(),
          city: formCity.trim(),
          state: formState.trim(),
          country: formCountry.trim(),
          linkedinUrl: formLinkedinUrl.trim() || null,
          photoUrl: formPhotoUrl || null,
          accountStatus: formAccountStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.detail || "Failed to update volunteer details.");
      }
      setMessage(`Volunteer details for ${formFullName} updated successfully!`);
      setModalMode(null);
      await Promise.allSettled([loadDesk(), loadAssignments()]);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteVolunteer() {
    if (!selectedVolunteer) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await authFetch(`/v1/manage/volunteers/${selectedVolunteer.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.detail || "Failed to delete volunteer.");
      }
      setMessage(`Volunteer ${selectedVolunteer.fullName} was removed from database.`);
      setModalMode(null);
      await Promise.allSettled([loadDesk(), loadAssignments()]);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setBusy(false);
    }
  }

  async function handleQuickAssign() {
    if (!selectedVolunteer || !quickTarget) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const parsed = parseTarget(quickTarget);
      try {
        await api.manage.assignVolunteer(year, selectedVolunteer.userId, parsed, quickReason.trim());
      } catch {
        const res = await authFetch(`/v1/manage/editions/${year}/volunteer-assignments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            volunteerUserId: selectedVolunteer.userId,
            target: parsed,
            reason: quickReason.trim(),
          }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.message || "Failed to assign volunteer.");
        }
      }
      setMessage(`Volunteer ${selectedVolunteer.fullName} assigned successfully!`);
      setModalMode(null);
      await Promise.allSettled([loadDesk(), loadAssignments()]);
    } catch (err: any) {
      setError(err.message || "Failed to assign volunteer.");
    } finally {
      setBusy(false);
    }
  }

  // Export CSV Roster
  function handleExportCsv() {
    if (!volunteers.length) return;
    const headers = [
      "ID",
      "Full Name",
      "Email",
      "Mobile",
      "Alternate Mobile",
      "Organisation / College",
      "Registration No",
      "Roll No",
      "City",
      "State",
      "Country",
      "Account Status",
      "Duty State",
      "Assigned To",
      "Assigned Reason",
      "Registered On",
    ];

    const rows = volunteers.map((v) => [
      `"${v.id}"`,
      `"${v.fullName.replace(/"/g, '""')}"`,
      `"${v.email}"`,
      `"${v.mobile}"`,
      `"${v.altMobile || ""}"`,
      `"${v.organisationName.replace(/"/g, '""')}"`,
      `"${v.redgNo}"`,
      `"${v.rollNo}"`,
      `"${v.city}"`,
      `"${v.state}"`,
      `"${v.country}"`,
      `"${v.accountStatus}"`,
      `"${v.assignmentId ? "Assigned" : "Available"}"`,
      `"${v.targetName ? `${v.targetType === "startup" ? "Startup" : "Jury"}: ${v.targetName.replace(/"/g, '""')}` : ""}"`,
      `"${v.assignmentReason ? v.assignmentReason.replace(/"/g, '""') : ""}"`,
      `"${formatIst(v.createdAt)}"`,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `ISF2026_Volunteer_Roster_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  if (email === undefined || email === null) return null;
  const run = o?.draftRun;

  return (
    <>
      <div className="desk-header-flex">
        <div>
          <span className="eyebrow">ISF 2026 · OPERATIONS & ACCREDITATION</span>
          <h1 style={{ marginBottom: 4 }}>Volunteers & Desk</h1>
          <p className="muted" style={{ maxWidth: "75ch" }}>
            Comprehensive volunteer database management and duty assignment engine. Perform real-time CRUD operations on
            volunteer profiles, verify student registration numbers, preview badges, and coordinate summit duties.
          </p>
        </div>
        <div className="desk-quick-actions">
          <button type="button" className="btn btn-primary" onClick={openAddModal}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6, verticalAlign: "-2px" }}>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Volunteer
          </button>
          <button type="button" className="btn" onClick={handleExportCsv} disabled={volunteers.length === 0}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6, verticalAlign: "-2px" }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export CSV Roster
          </button>
        </div>
      </div>

      {error === "mfa_required" ? (
        <MfaPrompt next="/volunteers" />
      ) : (
        error && <p className="notice notice-error" role="alert">{error}</p>
      )}
      {message && <p className="notice notice-ok" role="status">{message}</p>}

      {/* Main Mode Tabs */}
      <div className="tabs" style={{ marginTop: 16 }}>
        <button
          type="button"
          className="tab"
          aria-current={currentTab === "desk" ? "true" : undefined}
          onClick={() => router.replace(`/volunteers?tab=desk&edition=${year}`)}
        >
          Volunteer Directory & Desk ({deskSummary.totalVolunteers || volunteers.length})
        </button>
        <button
          type="button"
          className="tab"
          aria-current={currentTab === "assignments" ? "true" : undefined}
          onClick={() => router.replace(`/volunteers?tab=assignments&edition=${year}`)}
        >
          Duty & Assignment Engine ({deskSummary.assignedCount} active)
        </button>
      </div>

      {/* ======================================================== TAB 1: VOLUNTEER DESK & DIRECTORY ======================================================== */}
      {currentTab === "desk" && (
        <div className="desk-container">
          {/* Summary KPI Ribbon */}
          <div className="kpi-ribbon">
            <div className="kpi-card">
              <span className="kpi-icon" style={{ background: "#edf2f7", color: "#2d3748" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </span>
              <div>
                <div className="kpi-val">{deskSummary.totalVolunteers}</div>
                <div className="kpi-lbl">Total Registered Volunteers</div>
              </div>
            </div>
            <div className="kpi-card">
              <span className="kpi-icon" style={{ background: "#e6efeb", color: "#1d5a47" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="6" />
                  <circle cx="12" cy="12" r="2" />
                </svg>
              </span>
              <div>
                <div className="kpi-val" style={{ color: "#1d5a47" }}>{deskSummary.assignedCount}</div>
                <div className="kpi-lbl">Assigned to Duty</div>
              </div>
            </div>
            <div className="kpi-card">
              <span className="kpi-icon" style={{ background: "#fbf3e2", color: "#8a5a00" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </span>
              <div>
                <div className="kpi-val" style={{ color: "#8a5a00" }}>{deskSummary.unassignedCount}</div>
                <div className="kpi-lbl">Available on Deck</div>
              </div>
            </div>
            <div className="kpi-card">
              <span className="kpi-icon" style={{ background: "#f3f4f6", color: "#374151" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 21h18" />
                  <path d="M5 21V7l8-4v18" />
                  <path d="M19 21V11l-6-3" />
                  <path d="M9 9v.01" />
                  <path d="M9 12v.01" />
                  <path d="M9 15v.01" />
                  <path d="M9 18v.01" />
                </svg>
              </span>
              <div>
                <div className="kpi-val">{deskSummary.organisationsCount || 1}</div>
                <div className="kpi-lbl">Institutions Represented</div>
              </div>
            </div>
          </div>

          {/* Search & Filter Toolbar */}
          <div className="desk-toolbar">
            <div className="search-field-box">
              <span className="search-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </span>
              <input
                type="text"
                placeholder="Search by name, Redg No, Roll No, college, mobile, city…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
              {searchQuery && (
                <button type="button" className="clear-btn" onClick={() => setSearchQuery("")}>✕</button>
              )}
            </div>

            <div className="filter-group">
              <label className="filter-label">
                <span>College:</span>
                <select value={collegeFilter} onChange={(e) => setCollegeFilter(e.target.value)}>
                  <option value="all">All Colleges / Orgs</option>
                  {deskSummary.availableColleges.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>

              <label className="filter-label">
                <span>Duty Status:</span>
                <select
                  value={assignmentFilter}
                  onChange={(e) => setAssignmentFilter(e.target.value as any)}
                >
                  <option value="all">All Volunteers</option>
                  <option value="assigned">Assigned Only</option>
                  <option value="unassigned">Available on Deck</option>
                </select>
              </label>

              <button type="button" className="btn btn-sm" onClick={() => void loadDesk()} disabled={loadingDesk}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 5, verticalAlign: "-1px" }}>
                  <path d="M23 4v6h-6" />
                  <path d="M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                {loadingDesk ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>

          {/* Volunteer Table / Directory */}
          {loadingDesk && volunteers.length === 0 ? (
            <div className="loading-state card">
              <div className="spinner" />
              <p className="muted" style={{ margin: 0 }}>Loading volunteer database records from Postgres…</p>
            </div>
          ) : volunteers.length === 0 ? (
            <div className="empty-state card">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: "0 auto 8px", display: "block" }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              <h3>No volunteers match your criteria</h3>
              <p className="muted">
                Try clearing your search query or college filter, or register a new volunteer using the button below.
              </p>
              <button type="button" className="btn btn-primary" onClick={openAddModal}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6, verticalAlign: "-2px" }}>
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Register First Volunteer
              </button>
            </div>
          ) : (
            <div className="table-wrap">
              <table aria-label="Volunteer Directory">
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>Photo</th>
                    <th>Volunteer & Contact</th>
                    <th>Academic Credentials</th>
                    <th>Location</th>
                    <th>Duty & Assignment</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {volunteers.map((v) => {
                    const isAssigned = Boolean(v.assignmentId);
                    return (
                      <tr key={v.id} className="volunteer-row">
                        <td>
                          <div className="avatar-box">
                            {v.photoUrl ? (
                              <img src={v.photoUrl} alt={v.fullName} className="avatar-img" />
                            ) : (
                              <div className="avatar-fallback">
                                {v.fullName.slice(0, 2).toUpperCase()}
                              </div>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="vol-name">{v.fullName}</div>
                          <div className="vol-email">{v.email}</div>
                          <div className="vol-phones">
                            <a href={`tel:${v.mobile}`} className="phone-link">
                              {v.mobile}
                            </a>
                            {v.mobile && (
                              <a
                                href={`https://wa.me/${v.mobile.replace(/[^0-9]/g, "")}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="whatsapp-link"
                                title="Chat on WhatsApp"
                              >
                                WhatsApp
                              </a>
                            )}
                            {v.altMobile && <span className="alt-phone">Alt: {v.altMobile}</span>}
                          </div>
                        </td>
                        <td>
                          <div className="vol-org">{v.organisationName}</div>
                          <div className="credential-tags">
                            <span className="cred-badge cred-redg" title="Registration Number">
                              Reg: {v.redgNo}
                            </span>
                            <span className="cred-badge cred-roll" title="Roll Number / Student ID">
                              Roll: {v.rollNo}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="vol-city">{v.city}, {v.state}</div>
                          <div className="muted small">{v.country}</div>
                          {v.linkedinUrl && (
                            <a
                              href={v.linkedinUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="linkedin-link"
                            >
                              LinkedIn ↗
                            </a>
                          )}
                        </td>
                        <td>
                          {isAssigned ? (
                            <div className="duty-box duty-assigned">
                              <span className="duty-status-badge assigned">
                                {v.targetType === "startup" ? "Startup Assigned" : "Jury Assigned"}
                              </span>
                              <div className="duty-target-name">{v.targetName}</div>
                              {v.assignedSince && (
                                <div className="duty-time">Since {formatIst(v.assignedSince)}</div>
                              )}
                            </div>
                          ) : (
                            <div className="duty-box duty-unassigned">
                              <span className="duty-status-badge available">
                                Available on Deck
                              </span>
                              {o && o.unassignedTargets.length > 0 && (
                                <button
                                  type="button"
                                  className="btn-link-action"
                                  onClick={() => openAssignModal(v)}
                                >
                                  + Assign Duty
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={`status-pill ${v.accountStatus}`}>
                            <span className="status-dot" />
                            {v.accountStatus}
                          </span>
                          <div className="muted small" style={{ marginTop: 4 }}>
                            {formatIst(v.createdAt).split(" ")[0]}
                          </div>
                        </td>
                        <td>
                          <div className="table-actions-cell">
                            <button
                              type="button"
                              className="btn btn-sm btn-badge-preview"
                              onClick={() => openBadgeModal(v)}
                              title="Preview Official Accreditation Badge"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, verticalAlign: "-1px" }}>
                                <rect x="3" y="4" width="18" height="16" rx="2" />
                                <line x1="7" y1="8" x2="17" y2="8" />
                                <line x1="7" y1="12" x2="13" y2="12" />
                              </svg>
                              Badge
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-edit-row"
                              onClick={() => openEditModal(v)}
                              title="Edit Volunteer Details"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, verticalAlign: "-1px" }}>
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                              </svg>
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-delete-row"
                              onClick={() => openDeleteModal(v)}
                              title="Revoke / Delete Volunteer"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, verticalAlign: "-1px" }}>
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ======================================================== TAB 2: ASSIGNMENT ENGINE ======================================================== */}
      {currentTab === "assignments" && o && (
        <div className="assignments-container">
          <h2>Random assignment</h2>
          {!run ? (
            <>
              <p className="muted small">
                {o.freeVolunteers.length} volunteer(s) without an assignment and {o.unassignedTargets.length} target(s)
                without a volunteer. Generating creates a draft that nobody else sees until it is saved.
              </p>
              {mayGenerate && (
                <div className="actions">
                  <button
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => api.manage.generateVolunteerRun(year),
                        "Draft generated. Review it below, then save or discard it."
                      )
                    }
                  >
                    Generate random assignment
                  </button>
                </div>
              )}
            </>
          ) : (
            <section className="card" aria-label="Draft assignment">
              <h3>
                Draft for review <span className="badge">Not visible to participants</span>
              </h3>
              <p className="muted small">
                Generated by {run.startedBy} on {formatIst(run.createdAt)} IST from {run.volunteerCount} volunteer(s) and{" "}
                {run.targetCount} target(s). Seed <code>{run.seed.slice(0, 12)}…</code> recorded for reproducibility.
              </p>
              {run.pairs.length > 0 && (
                <div className="table-wrap">
                  <table aria-label="Draft pairs">
                    <thead>
                      <tr>
                        <th>Volunteer</th>
                        <th>Assigned to</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.pairs.map((p) => (
                        <tr key={p.id}>
                          <td>{p.volunteer.name}</td>
                          <td>{targetLabel(p.target)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {run.unassignedTargets.length > 0 && (
                <div className="notice notice-warn" role="note">
                  <strong>Not enough volunteers: {run.unassignedTargets.length} target(s) will have no volunteer.</strong>
                  <ul className="small">
                    {run.unassignedTargets.map((t) => (
                      <li key={targetValue(t)}>{targetLabel(t)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {run.surplusVolunteers.length > 0 && (
                <div className="notice" role="note">
                  <strong>{run.surplusVolunteers.length} volunteer(s) left without a target.</strong>
                  <ul className="small">
                    {run.surplusVolunteers.map((v) => (
                      <li key={v.id}>{v.name}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="actions">
                {mayReview && (
                  <button
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => api.manage.approveVolunteerRun(run.id),
                        "Assignments saved. Volunteers and targets have been notified."
                      )
                    }
                  >
                    Save and notify
                  </button>
                )}
                {mayGenerate && (
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => void act(() => api.manage.discardVolunteerRun(run.id), "Draft discarded.")}
                  >
                    Discard draft
                  </button>
                )}
                {!mayReview && (
                  <span className="muted small">A Management user must review and save this draft.</span>
                )}
              </div>
            </section>
          )}

          <h2 style={{ marginTop: 28 }}>Current assignments ({o.active.length})</h2>
          {o.active.length === 0 ? (
            <p className="muted">No saved assignments yet.</p>
          ) : (
            <div className="table-wrap">
              <table aria-label="Current assignments">
                <thead>
                  <tr>
                    <th>Volunteer</th>
                    <th>Assigned to</th>
                    <th>Since (IST)</th>
                    <th>Messages</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {o.active.map((a) => (
                    <tr key={a.id}>
                      <td><strong>{a.volunteer.name}</strong></td>
                      <td>
                        {targetLabel(a.target)}
                        {a.reason && <div className="muted small">{a.reason}</div>}
                      </td>
                      <td>{a.activatedAt ? formatIst(a.activatedAt) : ""}</td>
                      <td>
                        <Delivery a={a} />
                      </td>
                      <td>
                        {mayChange && change?.id !== a.id && (
                          <span className="actions" style={{ marginTop: 0 }}>
                            <button
                              className="btn btn-sm"
                              onClick={() =>
                                setChange({ id: a.id, mode: "reassign", volunteer: "", target: "", reason: "" })
                              }
                            >
                              Reassign
                            </button>
                            <button
                              className="btn btn-sm"
                              onClick={() =>
                                setChange({ id: a.id, mode: "close", volunteer: "", target: "", reason: "" })
                              }
                            >
                              End
                            </button>
                          </span>
                        )}
                        {change?.id === a.id && (
                          <div className="stack" aria-label={change.mode === "reassign" ? "Reassign" : "End assignment"}>
                            {change.mode === "reassign" && (
                              <>
                                <label className="small">
                                  New volunteer
                                  <select
                                    value={change.volunteer}
                                    onChange={(e) => setChange({ ...change, volunteer: e.target.value })}
                                  >
                                    <option value="">Keep {a.volunteer.name}</option>
                                    {o.freeVolunteers.map((v) => (
                                      <option key={v.id} value={v.id}>
                                        {v.name}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="small">
                                  New target
                                  <select
                                    value={change.target}
                                    onChange={(e) => setChange({ ...change, target: e.target.value })}
                                  >
                                    <option value="">Keep {a.target.name}</option>
                                    {o.unassignedTargets.map((t) => (
                                      <option key={targetValue(t)} value={targetValue(t)}>
                                        {targetLabel(t)}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              </>
                            )}
                            <label className="small">
                              Reason (recorded)
                              <input
                                value={change.reason}
                                onChange={(e) => setChange({ ...change, reason: e.target.value })}
                              />
                            </label>
                            <span className="actions" style={{ marginTop: 0 }}>
                              <button
                                className="btn btn-sm btn-primary"
                                disabled={
                                  busy ||
                                  !change.reason.trim() ||
                                  (change.mode === "reassign" && !change.volunteer && !change.target)
                                }
                                onClick={() =>
                                  void act(async () => {
                                    if (change.mode === "close")
                                      await api.manage.closeVolunteerAssignment(a.id, change.reason.trim());
                                    else
                                      await api.manage.reassignVolunteer(a.id, {
                                        reason: change.reason.trim(),
                                        ...(change.volunteer ? { volunteerUserId: change.volunteer } : {}),
                                        ...(change.target ? { target: parseTarget(change.target) } : {}),
                                      });
                                    setChange(null);
                                  }, change.mode === "close" ? "Assignment ended." : "Reassigned.")
                                }
                              >
                                {change.mode === "close" ? "Confirm end" : "Confirm reassignment"}
                              </button>
                              <button className="btn btn-sm" onClick={() => setChange(null)}>
                                Cancel
                              </button>
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2 style={{ marginTop: 28 }}>Without a volunteer ({o.unassignedTargets.length})</h2>
          {o.unassignedTargets.length === 0 ? (
            <p className="muted">Every startup and jury member has a volunteer assigned.</p>
          ) : (
            <ul aria-label="Unassigned targets">
              {o.unassignedTargets.map((t) => (
                <li key={targetValue(t)}>{targetLabel(t)}</li>
              ))}
            </ul>
          )}

          {o.freeVolunteers.length > 0 && (
            <p className="muted small">
              Volunteers without an assignment ({o.freeVolunteers.length}): {o.freeVolunteers.map((v) => v.name).join(", ")}.
            </p>
          )}

          {mayChange && o.unassignedTargets.length > 0 && o.freeVolunteers.length > 0 && !run && (
            <section className="card" aria-label="Assign by hand" style={{ marginTop: 16 }}>
              <h3>Assign by hand</h3>
              <div className="release-bar">
                <label>
                  Volunteer
                  <select
                    value={manual.volunteer}
                    onChange={(e) => setManual({ ...manual, volunteer: e.target.value })}
                  >
                    <option value="">Choose volunteer…</option>
                    {o.freeVolunteers.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Target
                  <select
                    value={manual.target}
                    onChange={(e) => setManual({ ...manual, target: e.target.value })}
                  >
                    <option value="">Choose target…</option>
                    {o.unassignedTargets.map((t) => (
                      <option key={targetValue(t)} value={targetValue(t)}>
                        {targetLabel(t)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Reason
                  <input
                    value={manual.reason}
                    onChange={(e) => setManual({ ...manual, reason: e.target.value })}
                    placeholder="e.g. Venue lead"
                  />
                </label>
                <button
                  className="btn btn-primary"
                  disabled={busy || !manual.volunteer || !manual.target || !manual.reason.trim()}
                  onClick={() =>
                    void act(async () => {
                      await api.manage.assignVolunteer(
                        year,
                        manual.volunteer,
                        parseTarget(manual.target),
                        manual.reason.trim()
                      );
                      setManual({ volunteer: "", target: "", reason: "" });
                    }, "Volunteer assigned successfully.")
                  }
                >
                  Assign
                </button>
              </div>
            </section>
          )}

          <h2 style={{ marginTop: 28 }}>Assignment History</h2>
          {o.history.length === 0 ? (
            <p className="muted">No reassignments or ended assignments yet.</p>
          ) : (
            <div className="table-wrap">
              <table aria-label="Assignment history">
                <thead>
                  <tr>
                    <th>Volunteer</th>
                    <th>Was assigned to</th>
                    <th>Ended (IST)</th>
                    <th>By</th>
                    <th>Reason</th>
                    <th>Replaced by</th>
                  </tr>
                </thead>
                <tbody>
                  {o.history.map((h) => {
                    const next = [...o.active, ...o.history].find((x) => x.replacesId === h.id);
                    return (
                      <tr key={h.id}>
                        <td>{h.volunteer.name}</td>
                        <td>{targetLabel(h.target)}</td>
                        <td>{h.closedAt ? formatIst(h.closedAt) : ""}</td>
                        <td>{h.closedBy}</td>
                        <td>{h.closeReason}</td>
                        <td>{next ? `${next.volunteer.name} → ${next.target.name}` : <span className="muted">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ======================================================== MODALS ======================================================== */}
      {/* 1. ADD / EDIT VOLUNTEER MODAL */}
      {(modalMode === "add" || modalMode === "edit") && (
        <div className="modal-overlay" onClick={() => setModalMode(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  {modalMode === "add" ? (
                    <>
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </>
                  ) : (
                    <>
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </>
                  )}
                </svg>
                {modalMode === "add" ? "Register New Volunteer" : `Edit Volunteer: ${formFullName}`}
              </h3>
              <button className="close-btn" onClick={() => setModalMode(null)}>✕</button>
            </div>

            <form onSubmit={modalMode === "add" ? handleCreateVolunteer : handleUpdateVolunteer} className="modal-form">
              <div className="form-cols-two">
                {/* Column 1: Identity & Credentials */}
                <div>
                  <label>
                    <span>Full Name <span style={{ color: "red" }}>*</span></span>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Soumya Ranjan"
                      value={formFullName}
                      onChange={(e) => setFormFullName(e.target.value)}
                    />
                  </label>

                  <label>
                    <span>Official Email Address <span style={{ color: "red" }}>*</span></span>
                    <input
                      type="email"
                      required
                      placeholder="e.g. volunteer@giet.edu"
                      value={formEmail}
                      onChange={(e) => setFormEmail(e.target.value)}
                    />
                  </label>

                  {modalMode === "add" && (
                    <label>
                      <span>Temporary Password <span style={{ color: "red" }}>*</span></span>
                      <input
                        type="text"
                        required
                        value={formPassword}
                        onChange={(e) => setFormPassword(e.target.value)}
                      />
                      <span className="hint">Initial sign-in password for the portal.</span>
                    </label>
                  )}

                  <label>
                    <span>College / Organisation Name <span style={{ color: "red" }}>*</span></span>
                    <input
                      type="text"
                      required
                      placeholder="e.g. GIET University"
                      value={formOrganisationName}
                      onChange={(e) => setFormOrganisationName(e.target.value)}
                    />
                  </label>

                  <div className="form-cols-two" style={{ marginTop: 0 }}>
                    <label>
                      <span>Registration No (Redg No) <span style={{ color: "red" }}>*</span></span>
                      <input
                        type="text"
                        required
                        placeholder="e.g. 24UG01LE06"
                        value={formRedgNo}
                        onChange={(e) => setFormRedgNo(e.target.value)}
                      />
                    </label>
                    <label>
                      <span>Roll No / Student ID <span style={{ color: "red" }}>*</span></span>
                      <input
                        type="text"
                        required
                        placeholder="e.g. 24LECSE003"
                        value={formRollNo}
                        onChange={(e) => setFormRollNo(e.target.value)}
                      />
                    </label>
                  </div>
                </div>

                {/* Column 2: Contact, Location & Photo */}
                <div>
                  <div className="form-cols-two" style={{ marginTop: 0 }}>
                    <label>
                      <span>Primary Phone (Mobile) <span style={{ color: "red" }}>*</span></span>
                      <input
                        type="tel"
                        required
                        placeholder="+91 82605 21302"
                        value={formMobile}
                        onChange={(e) => setFormMobile(e.target.value)}
                      />
                    </label>
                    <label>
                      <span>Alternate Mobile</span>
                      <input
                        type="tel"
                        placeholder="Emergency contact"
                        value={formAltMobile}
                        onChange={(e) => setFormAltMobile(e.target.value)}
                      />
                    </label>
                  </div>

                  <div className="form-cols-two" style={{ marginTop: 0 }}>
                    <label>
                      <span>City</span>
                      <input
                        type="text"
                        value={formCity}
                        onChange={(e) => setFormCity(e.target.value)}
                      />
                    </label>
                    <label>
                      <span>State</span>
                      <input
                        type="text"
                        value={formState}
                        onChange={(e) => setFormState(e.target.value)}
                      />
                    </label>
                  </div>

                  <label>
                    <span>LinkedIn Profile URL</span>
                    <input
                      type="url"
                      placeholder="https://linkedin.com/in/username"
                      value={formLinkedinUrl}
                      onChange={(e) => setFormLinkedinUrl(e.target.value)}
                    />
                  </label>

                  {modalMode === "edit" && (
                    <label>
                      <span>Account Status</span>
                      <select
                        value={formAccountStatus}
                        onChange={(e) => setFormAccountStatus(e.target.value)}
                      >
                        <option value="active">Active</option>
                        <option value="deactivated">Deactivated</option>
                      </select>
                    </label>
                  )}

                  {/* Photo Upload Section */}
                  <div className="photo-picker-box">
                    <span className="photo-picker-title">Summit Badge Photograph</span>
                    <div className="photo-preview-row">
                      <div className="modal-avatar-preview">
                        {formPhotoUrl ? (
                          <img src={formPhotoUrl} alt="Preview" />
                        ) : (
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                          </svg>
                        )}
                      </div>
                      <div style={{ flex: 1 }}>
                        <input
                          ref={photoInputRef}
                          type="file"
                          accept="image/*"
                          style={{ display: "none" }}
                          onChange={handlePhotoFileChange}
                        />
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => photoInputRef.current?.click()}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6, verticalAlign: "-1px" }}>
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                            <circle cx="12" cy="13" r="4" />
                          </svg>
                          {formPhotoUrl ? "Change Photo" : "Upload Photo"}
                        </button>
                        {formPhotoUrl && (
                          <button
                            type="button"
                            className="btn btn-sm"
                            style={{ marginLeft: 8 }}
                            onClick={() => setFormPhotoUrl("")}
                          >
                            Remove
                          </button>
                        )}
                        <p className="hint" style={{ marginTop: 4, marginBottom: 0 }}>
                          High quality headshot for physical summit accreditation pass.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn" onClick={() => setModalMode(null)} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? "Saving to Database…" : modalMode === "add" ? "Create Volunteer Record" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. DELETE VOLUNTEER MODAL */}
      {modalMode === "delete" && selectedVolunteer && (
        <div className="modal-overlay" onClick={() => setModalMode(null)}>
          <div className="modal-dialog modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ color: "#a1271b", display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a1271b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                Revoke Volunteer Accreditation
              </h3>
              <button className="close-btn" onClick={() => setModalMode(null)}>✕</button>
            </div>
            <div style={{ padding: "16px 20px" }}>
              <p>
                Are you sure you want to permanently remove <strong>{selectedVolunteer.fullName}</strong> (
                <code>{selectedVolunteer.email}</code>) from the volunteer roster?
              </p>
              {selectedVolunteer.assignmentId && (
                <div className="notice notice-warn" style={{ marginBottom: 16 }}>
                  <strong>Note:</strong> This volunteer is currently assigned to{" "}
                  <strong>{selectedVolunteer.targetName}</strong>. Deleting them will automatically close and end this
                  duty assignment.
                </div>
              )}
              <p className="muted small">
                This action revokes their volunteer role grant, purges their profile from the active roster, and updates
                the database.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setModalMode(null)} disabled={busy}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                style={{ background: "#a1271b", borderColor: "#a1271b" }}
                onClick={handleDeleteVolunteer}
                disabled={busy}
              >
                {busy ? "Removing…" : "Confirm Delete & Revoke"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. QUICK ASSIGN MODAL */}
      {modalMode === "assign" && selectedVolunteer && o && (
        <div className="modal-overlay" onClick={() => setModalMode(null)}>
          <div className="modal-dialog modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="6" />
                  <circle cx="12" cy="12" r="2" />
                </svg>
                Assign Duty: {selectedVolunteer.fullName}
              </h3>
              <button className="close-btn" onClick={() => setModalMode(null)}>✕</button>
            </div>
            <div style={{ padding: "16px 20px", display: "grid", gap: 14 }}>
              <label>
                <span>Select Target (Startup or Jury Member)</span>
                <select
                  value={quickTarget}
                  onChange={(e) => setQuickTarget(e.target.value)}
                  required
                >
                  <option value="">Choose target…</option>
                  {o.unassignedTargets.map((t) => (
                    <option key={targetValue(t)} value={targetValue(t)}>
                      {targetLabel(t)}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Reason / Assignment Note</span>
                <input
                  type="text"
                  value={quickReason}
                  onChange={(e) => setQuickReason(e.target.value)}
                  placeholder="e.g. Assigned via operations desk"
                />
              </label>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setModalMode(null)} disabled={busy}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleQuickAssign}
                disabled={busy || !quickTarget}
              >
                {busy ? "Assigning…" : "Confirm Assignment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. OFFICIAL SUMMIT ACCREDITATION BADGE PASS MODAL */}
      {modalMode === "badge" && selectedVolunteer && (
        <div className="modal-overlay" onClick={() => setModalMode(null)}>
          <div className="modal-dialog modal-badge-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header no-print">
              <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <line x1="7" y1="8" x2="17" y2="8" />
                  <line x1="7" y1="12" x2="13" y2="12" />
                </svg>
                Summit Accreditation Pass
              </h3>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => window.print()}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6, verticalAlign: "-1px" }}>
                    <polyline points="6 9 6 2 18 2 18 9" />
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                    <rect x="6" y="14" width="12" height="8" />
                  </svg>
                  Print Badge Card
                </button>
                <button className="close-btn" onClick={() => setModalMode(null)}>✕</button>
              </div>
            </div>

            <div className="badge-preview-wrap">
              {/* Physical Pass Card Card Container */}
              <div className="summit-badge-pass" id="printable-summit-badge">
                {/* Lanyard Ring Mockup */}
                <div className="lanyard-hole" />

                {/* Badge Top Header */}
                <div className="badge-top-banner">
                  <div className="badge-logo-row">
                    <span className="badge-summit-name">STARTUP JATHARA 2026</span>
                  </div>
                  <div className="badge-sub-banner">
                    HOST CAMPUS · GIET UNIVERSITY, GUNUPUR
                  </div>
                </div>

                {/* Badge Role Ribbon */}
                <div className="badge-role-ribbon">
                  OFFICIAL SUMMIT VOLUNTEER
                </div>

                {/* Photo & Identity Section */}
                <div className="badge-body-content">
                  <div className="badge-photo-frame">
                    {selectedVolunteer.photoUrl ? (
                      <img
                        src={selectedVolunteer.photoUrl}
                        alt={selectedVolunteer.fullName}
                        className="badge-photo-img"
                      />
                    ) : (
                      <div className="badge-photo-fallback">
                        {selectedVolunteer.fullName.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>

                  <h2 className="badge-attendee-name">{selectedVolunteer.fullName}</h2>
                  <div className="badge-attendee-inst">{selectedVolunteer.organisationName}</div>

                  <div className="badge-id-pills-row">
                    <div className="badge-pill-item">
                      <span className="pill-k">REDG NO</span>
                      <span className="pill-v">{selectedVolunteer.redgNo}</span>
                    </div>
                    <div className="badge-pill-item">
                      <span className="pill-k">ROLL NO</span>
                      <span className="pill-v">{selectedVolunteer.rollNo}</span>
                    </div>
                  </div>

                  {/* Location & Duty Info */}
                  <div className="badge-location-text">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, verticalAlign: "-1px" }}>
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    {selectedVolunteer.city}, {selectedVolunteer.state}
                  </div>

                  {selectedVolunteer.targetName && (
                    <div className="badge-duty-banner">
                      <span>DUTY: </span>
                      <strong>{selectedVolunteer.targetType === "startup" ? "STARTUP" : "JURY"}: {selectedVolunteer.targetName}</strong>
                    </div>
                  )}

                  {/* Security Barcode & Hologram Seal */}
                  <div className="badge-footer-security">
                    <div className="barcode-mockup">
                      <div className="barcode-lines" />
                      <span className="barcode-num">ISF26-VOL-{selectedVolunteer.redgNo.replace(/[^a-zA-Z0-9]/g, "")}</span>
                    </div>
                    <div className="hologram-seal">
                      <span>VERIFIED</span>
                      <small>ISF·GIET</small>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="badge-modal-tip no-print">
              Tip: Click <strong>Print Badge Card</strong> to output on high-resolution cardstock or PVC badge printer.
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== STYLES ======================================================== */}
      <style jsx>{`
        .desk-header-flex {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 20px;
          flex-wrap: wrap;
          margin-bottom: 20px;
        }
        .desk-quick-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        /* KPI Ribbon */
        .kpi-ribbon {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 16px;
          margin-bottom: 20px;
        }
        .kpi-card {
          background: #ffffff;
          border: 1px solid var(--line);
          border-radius: var(--radius);
          padding: 16px;
          display: flex;
          align-items: center;
          gap: 14px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
        }
        .kpi-icon {
          width: 44px;
          height: 44px;
          border-radius: 10px;
          background: #f1f5f9;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
        }
        .kpi-val {
          font-size: 24px;
          font-weight: 800;
          line-height: 1.1;
          color: var(--ink);
        }
        .kpi-lbl {
          font-size: 12px;
          color: var(--muted);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          margin-top: 2px;
        }

        /* Desk Toolbar */
        .desk-toolbar {
          background: #ffffff;
          border: 1px solid var(--line);
          border-radius: var(--radius);
          padding: 12px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          margin-bottom: 16px;
        }
        .search-field-box {
          position: relative;
          flex: 1;
          min-width: 260px;
        }
        .search-icon {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          color: #94a3b8;
          font-size: 14px;
        }
        .search-input {
          padding-left: 36px !important;
          padding-right: 32px !important;
        }
        .clear-btn {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          font-size: 14px;
        }
        .filter-group {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .filter-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          font-weight: 600;
          color: var(--muted);
        }
        .filter-label select {
          padding: 6px 10px;
          font-size: 13px;
          width: auto;
          min-width: 140px;
        }

        /* Volunteer Table Rows */
        .avatar-box {
          width: 40px;
          height: 40px;
          border-radius: 8px;
          overflow: hidden;
          background: #f1f5f9;
          border: 1px solid var(--line);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .avatar-fallback {
          font-weight: 700;
          font-size: 13px;
          color: var(--muted);
        }
        .vol-name {
          font-weight: 700;
          color: var(--ink);
          font-size: 14px;
        }
        .vol-email {
          font-size: 12px;
          color: #2563eb;
        }
        .vol-phones {
          display: flex;
          gap: 8px;
          align-items: center;
          margin-top: 2px;
          font-size: 12px;
        }
        .phone-link {
          color: var(--muted);
          text-decoration: none;
        }
        .whatsapp-link {
          background: #25d366;
          color: #ffffff;
          padding: 1px 6px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 700;
          text-decoration: none;
        }
        .alt-phone {
          color: #94a3b8;
          font-size: 11px;
        }
        .vol-org {
          font-weight: 600;
          font-size: 13px;
          color: var(--ink);
        }
        .credential-tags {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          margin-top: 4px;
        }
        .cred-badge {
          font-family: monospace;
          font-size: 11px;
          padding: 1px 6px;
          border-radius: 4px;
          font-weight: 600;
        }
        .cred-redg {
          background: #eef2ff;
          color: #3730a3;
          border: 1px solid #c7d2fe;
        }
        .cred-roll {
          background: #f0fdf4;
          color: #166534;
          border: 1px solid #bbf7d0;
        }
        .vol-city {
          font-size: 13px;
          font-weight: 500;
        }
        .linkedin-link {
          font-size: 11px;
          color: #0a66c2;
          text-decoration: none;
          font-weight: 600;
        }

        /* Duty Box */
        .duty-box {
          display: grid;
          gap: 2px;
        }
        .duty-status-badge {
          display: inline-block;
          font-size: 11px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 999px;
          width: fit-content;
        }
        .duty-status-badge.assigned {
          background: #e6efeb;
          color: #1d5a47;
          border: 1px solid #c6dbd2;
        }
        .duty-status-badge.available {
          background: #fbf3e2;
          color: #8a5a00;
          border: 1px solid #ecd9ae;
        }
        .duty-target-name {
          font-weight: 700;
          font-size: 13px;
          color: var(--ink);
        }
        .duty-time {
          font-size: 11px;
          color: var(--muted);
        }
        .btn-link-action {
          background: none;
          border: none;
          color: var(--accent);
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          padding: 0;
          text-align: left;
          text-decoration: underline;
        }

        /* Status Pill */
        .status-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 600;
          text-transform: capitalize;
        }
        .status-pill.active { color: #166534; }
        .status-pill.deactivated { color: #991b1b; }
        .status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: currentColor;
        }

        /* Actions Cell */
        .table-actions-cell {
          display: flex;
          justify-content: flex-end;
          gap: 6px;
        }
        .btn-badge-preview {
          background: #1d5a47 !important;
          color: #ffffff !important;
          border-color: #1d5a47 !important;
          font-weight: 600;
        }
        .btn-badge-preview:hover {
          background: #154536 !important;
        }
        .btn-edit-row {
          background: #f8fafc;
          color: #1e293b;
          border: 1px solid #cbd5e1;
          font-weight: 600;
        }
        .btn-edit-row:hover {
          background: #e2e8f0;
          color: #0f172a;
          border-color: #94a3b8;
        }
        .btn-delete-row {
          background: #fff;
          color: #b91c1c;
          border: 1px solid #fecaca;
          font-weight: 600;
        }
        .btn-delete-row:hover {
          background: #fee2e2;
          color: #991b1b;
          border-color: #fca5a5;
        }

        /* Modals */
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.65);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 16px;
          overflow-y: auto;
        }
        .modal-dialog {
          background: #ffffff;
          border-radius: 14px;
          width: 100%;
          max-width: 820px;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2);
          overflow: hidden;
          animation: modalPop 0.2s ease-out;
        }
        .modal-sm {
          max-width: 480px;
        }
        .modal-badge-dialog {
          max-width: 460px;
        }
        @keyframes modalPop {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }
        .modal-header {
          padding: 16px 20px;
          border-bottom: 1px solid var(--line);
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #f8fafc;
        }
        .modal-header h3 {
          margin: 0;
          font-size: 17px;
          font-weight: 700;
        }
        .close-btn {
          background: none;
          border: none;
          font-size: 18px;
          color: var(--muted);
          cursor: pointer;
        }
        .modal-form {
          padding: 20px;
          display: grid;
          gap: 16px;
        }
        .form-cols-two {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 16px;
        }
        .photo-picker-box {
          border: 1px dashed var(--line);
          border-radius: 10px;
          padding: 14px;
          background: #f8fafc;
        }
        .photo-picker-title {
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          color: var(--muted);
          display: block;
          margin-bottom: 8px;
        }
        .photo-preview-row {
          display: flex;
          gap: 14px;
          align-items: center;
        }
        .modal-avatar-preview {
          width: 64px;
          height: 64px;
          border-radius: 10px;
          background: #e2e8f0;
          border: 1.5px solid var(--line);
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .modal-avatar-preview img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .modal-footer {
          padding: 14px 20px;
          background: #f8fafc;
          border-top: 1px solid var(--line);
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }

        /* Summit Pass Card Mockup */
        .badge-preview-wrap {
          padding: 24px;
          display: flex;
          justify-content: center;
          background: #0f172a;
        }
        .summit-badge-pass {
          width: 320px;
          background: #ffffff;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.2);
          position: relative;
          text-align: center;
        }
        .lanyard-hole {
          width: 50px;
          height: 12px;
          border-radius: 6px;
          background: #334155;
          margin: 12px auto 0;
          box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5);
        }
        .badge-top-banner {
          background: linear-gradient(135deg, #1d5a47 0%, #143e30 100%);
          color: #ffffff;
          padding: 14px 12px 10px;
          margin-top: 8px;
        }
        .badge-logo-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-weight: 800;
          font-size: 15px;
          letter-spacing: 0.05em;
        }
        .badge-sub-banner {
          font-size: 9px;
          letter-spacing: 0.12em;
          color: #d6b25e;
          font-weight: 700;
          margin-top: 4px;
        }
        .badge-role-ribbon {
          background: #d6b25e;
          color: #143e30;
          font-weight: 900;
          font-size: 12px;
          letter-spacing: 0.1em;
          padding: 5px 0;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
        }
        .badge-body-content {
          padding: 18px 20px;
        }
        .badge-photo-frame {
          width: 100px;
          height: 100px;
          border-radius: 14px;
          border: 3px solid #1d5a47;
          margin: 0 auto 12px;
          overflow: hidden;
          background: #f1f5f9;
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.15);
        }
        .badge-photo-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .badge-photo-fallback {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 32px;
          font-weight: 800;
          color: #1d5a47;
          background: #e6efeb;
        }
        .badge-attendee-name {
          font-size: 19px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 2px;
          line-height: 1.2;
        }
        .badge-attendee-inst {
          font-size: 12px;
          font-weight: 700;
          color: #475569;
          margin-bottom: 12px;
        }
        .badge-id-pills-row {
          display: flex;
          justify-content: center;
          gap: 10px;
          margin-bottom: 10px;
        }
        .badge-pill-item {
          background: #f8fafc;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          padding: 3px 8px;
          display: flex;
          flex-direction: column;
        }
        .pill-k {
          font-size: 8px;
          font-weight: 800;
          color: #64748b;
          letter-spacing: 0.05em;
        }
        .pill-v {
          font-family: monospace;
          font-size: 12px;
          font-weight: 700;
          color: #0f172a;
        }
        .badge-location-text {
          font-size: 11px;
          color: #64748b;
          margin-bottom: 10px;
        }
        .badge-duty-banner {
          background: #e6efeb;
          border: 1px solid #c6dbd2;
          color: #1d5a47;
          border-radius: 6px;
          padding: 4px 8px;
          font-size: 11px;
          margin-bottom: 12px;
        }
        .badge-footer-security {
          border-top: 1px dashed #cbd5e1;
          padding-top: 10px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .barcode-mockup {
          text-align: left;
        }
        .barcode-lines {
          width: 140px;
          height: 26px;
          background: repeating-linear-gradient(
            90deg,
            #0f172a 0px,
            #0f172a 2px,
            transparent 2px,
            transparent 4px,
            #0f172a 4px,
            #0f172a 7px,
            transparent 7px,
            transparent 9px,
            #0f172a 9px,
            #0f172a 12px,
            transparent 12px,
            transparent 13px,
            #0f172a 13px,
            #0f172a 16px,
            transparent 16px,
            transparent 19px
          );
        }
        .barcode-num {
          font-family: monospace;
          font-size: 8px;
          color: #64748b;
          display: block;
          margin-top: 2px;
        }
        .hologram-seal {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: radial-gradient(circle, #fde047 0%, #ca8a04 70%, #854d0e 100%);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          font-size: 7px;
          font-weight: 900;
          color: #422006;
          border: 1px solid #eab308;
          box-shadow: 0 0 8px rgba(234, 179, 8, 0.4);
        }
        .badge-modal-tip {
          padding: 12px 20px;
          font-size: 13px;
          color: var(--muted);
          background: #f8fafc;
          border-top: 1px solid var(--line);
        }

        /* Print Media Styles */
        @media print {
          .no-print {
            display: none !important;
          }
          body * {
            visibility: hidden;
          }
          #printable-summit-badge, #printable-summit-badge * {
            visibility: visible;
          }
          #printable-summit-badge {
            position: absolute;
            left: 50%;
            top: 20px;
            transform: translateX(-50%);
            box-shadow: none !important;
            border: 1px solid #000;
          }
        }
      `}</style>
    </>
  );
}

export default function VolunteersPage() {
  return (
    <Suspense fallback={null}>
      <VolunteersContent />
    </Suspense>
  );
}
