"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSessionIdentity, api } from "@/lib/session";
import { normalizeLinkedInUrl } from "@/lib/utils";

export default function ProfilePage() {
  const router = useRouter();
  const email = useSessionIdentity();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Profile Edit Form State
  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
  const [altMobile, setAltMobile] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [country, setCountry] = useState("India");
  const [domain, setDomain] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamMembers, setTeamMembers] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");

  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);

  // Password Change State
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  function getAuthHeaders(): HeadersInit {
    if (typeof window === "undefined") return { "Content-Type": "application/json" };
    function getCookie(name: string): string | null {
      const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
      return match ? decodeURIComponent(match[1]!) : null;
    }
    const tok =
      sessionStorage.getItem("sj.web.session") ||
      sessionStorage.getItem("sj_token") ||
      sessionStorage.getItem("sj.console.session") ||
      localStorage.getItem("sj.web.session") ||
      localStorage.getItem("sj_token") ||
      localStorage.getItem("sj.console.session") ||
      getCookie("sj.web.session") ||
      getCookie("sj_token") ||
      getCookie("sj.console.session");
    return {
      "Content-Type": "application/json",
      ...(tok ? { authorization: `Bearer ${tok}` } : {}),
    };
  }

  async function loadProfile() {
    setLoading(true);
    setError(null);
    try {
      if (email) {
        setProfile((prev: any) => prev || { email, fullName: email.split("@")[0] });
        setFullName((prev) => prev || email.split("@")[0]);
      }

      const res = await fetch("/v1/me/profile", { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data?.user) {
          setProfile(data.user);
          setFullName(data.user.fullName || "");
          setMobile(data.user.mobile || "");
          setAltMobile(data.user.altMobile || "");
          setCity(data.user.city || "");
          setState(data.user.state || "");
          setCountry(data.user.country || "India");
          setDomain(data.user.domain || "");
          setTeamName(data.user.teamName || "");
          setTeamMembers(data.user.teamMembers || "");
          setLinkedinUrl(data.user.linkedinUrl || "");
          return;
        }
      }

      // Fallback: try api.me()
      const freshMe = await api.me().catch(() => null);
      if (freshMe?.account) {
        const u = freshMe.account as any;
        setProfile(u);
        setFullName(u.fullName || "");
        setMobile(u.mobile || "");
        setAltMobile(u.altMobile || "");
        setCity(u.city || "");
        setState(u.state || "");
        setCountry(u.country || "India");
        setDomain(u.domain || "");
        setTeamName(u.teamName || "");
        setTeamMembers(u.teamMembers || "");
        setLinkedinUrl(u.linkedinUrl || "");
        return;
      }
    } catch (err) {
      if (!email) {
        setError((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (email === null) {
      router.replace("/signin?next=/profile");
      return;
    }
    if (email) {
      void loadProfile();
    }
  }, [email, router]);

  async function handleUpdateProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setProfileSuccess(null);
    setError(null);
    const cleanLinkedin = normalizeLinkedInUrl(linkedinUrl);
    setLinkedinUrl(cleanLinkedin);
    try {
      const res = await fetch("/v1/me/profile", {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          fullName,
          mobile,
          altMobile,
          city,
          state,
          country,
          domain,
          teamName,
          teamMembers,
          linkedinUrl: cleanLinkedin,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to update profile.");
      }
      setProfileSuccess("✓ Your profile details have been saved successfully.");
      setProfile((prev: any) => ({ ...prev, ...data.user }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (newPassword.length < 6) {
      setPasswordError("New password must be at least 6 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New password and confirmation do not match.");
      return;
    }

    setSavingPassword(true);
    try {
      const res = await fetch("/v1/me/password", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.detail || data.title || "Failed to update password.");
      }
      setPasswordSuccess("✓ Your password has been updated successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPasswordError((err as Error).message);
    } finally {
      setSavingPassword(false);
    }
  }

  if (email === undefined) return null;

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 16px 64px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: "0 0 6px", fontSize: "1.85rem", fontWeight: 800 }}>My Participant Profile</h1>
          <p className="muted" style={{ margin: 0 }}>
            Manage your personal details, contact preferences, and summit credentials.
          </p>
        </div>
        <Link href="/status" className="btn btn-sm">
          ← Application Status
        </Link>
      </div>

      {error && <p className="notice notice-error" role="alert">{error}</p>}

      {/* Profile Overview Card */}
      <section className="card" style={{ marginBottom: 24, background: "#f8fafc", borderColor: "#cbd5e1" }}>
        <h2 style={{ marginTop: 0, fontSize: "1.2rem" }}>Profile Information</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
          <div>
            <span className="muted small" style={{ display: "block" }}>Full Name</span>
            <strong>{profile?.fullName || "—"}</strong>
          </div>
          <div>
            <span className="muted small" style={{ display: "block" }}>Email</span>
            <code>{profile?.email || email}</code>
          </div>
          <div>
            <span className="muted small" style={{ display: "block" }}>Category</span>
            <span style={{ fontSize: "0.85rem", background: "#e0e7ff", color: "#3730a3", padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>
              {profile?.category ? profile.category.replace(/_/g, " ") : "Participant"}
            </span>
          </div>
          <div>
            <span className="muted small" style={{ display: "block" }}>Account Status</span>
            <span style={{ color: "#16a34a", fontWeight: 600 }}>● Active</span>
          </div>
        </div>
      </section>

      {/* Edit Details */}
      <section className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ marginTop: 0 }}>Update Profile Details</h2>
        {profileSuccess && <p className="notice notice-ok" role="status">{profileSuccess}</p>}

        <form onSubmit={handleUpdateProfile} style={{ display: "grid", gap: 14 }}>
          <div className="two">
            <label>Full Name *
              <input type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </label>
            <label>Primary Phone
              <input type="tel" placeholder="+91 98765 43210" value={mobile} onChange={(e) => setMobile(e.target.value)} />
            </label>
          </div>

          <div className="two">
            <label>Alternative Phone
              <input type="tel" placeholder="Secondary / Emergency" value={altMobile} onChange={(e) => setAltMobile(e.target.value)} />
            </label>
            <label>Domain / Sector
              <input type="text" placeholder="e.g. AgriTech / AI" value={domain} onChange={(e) => setDomain(e.target.value)} />
            </label>
          </div>

          <div className="two">
            <label>Startup / Team Name
              <input type="text" placeholder="e.g. AgriSmart Pvt Ltd" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
            </label>
            <label>LinkedIn Profile URL
              <input
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="e.g. linkedin.com/in/username or https://www.linkedin.com/in/username"
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
                onBlur={() => {
                  if (linkedinUrl.trim()) setLinkedinUrl(normalizeLinkedInUrl(linkedinUrl));
                }}
              />
            </label>
          </div>

          <div className="two">
            <label>City
              <input type="text" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
            </label>
            <label>State
              <input type="text" placeholder="State" value={state} onChange={(e) => setState(e.target.value)} />
            </label>
          </div>

          <div>
            <button type="submit" className="btn btn-primary" disabled={savingProfile}>
              {savingProfile ? "Saving Profile..." : "Save Changes"}
            </button>
          </div>
        </form>
      </section>

      {/* Update Password */}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Change Account Password</h2>
        <p className="muted small">
          Update the password you use to sign in to your dashboard.
        </p>

        {passwordSuccess && <p className="notice notice-ok" role="status">{passwordSuccess}</p>}
        {passwordError && <p className="notice notice-error" role="alert">{passwordError}</p>}

        <form onSubmit={handleUpdatePassword} style={{ display: "grid", gap: 14, maxWidth: 520 }}>
          <label>Current Password (leave blank if not yet set)
            <input type="password" placeholder="Enter current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </label>

          <label>New Password *
            <input type="password" required placeholder="Minimum 6 characters" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </label>

          <label>Confirm New Password *
            <input type="password" required placeholder="Re-enter new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </label>

          <div>
            <button type="submit" className="btn btn-primary" disabled={savingPassword}>
              {savingPassword ? "Updating Password..." : "Update Password"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
