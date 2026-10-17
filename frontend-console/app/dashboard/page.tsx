"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { can, useMe } from "@/lib/me";
import { signOut, api } from "@/lib/session";

export default function DashboardPage() {
  const { me, email, error } = useMe();
  const router = useRouter();

  // 10-minute session inactivity timeout tracking
  const [lastActivity, setLastActivity] = useState(Date.now());
  const [secondsRemaining, setSecondsRemaining] = useState(600);
  const [stats, setStats] = useState({
    applications: "12",
    tickets: "3",
    users: "6",
    ranking: "Ready",
  });
  const [backendHealth, setBackendHealth] = useState<"checking" | "online" | "degraded">("checking");

  // Track user activity to reset 10-minute countdown
  useEffect(() => {
    function resetTimer() {
      setLastActivity(Date.now());
    }
    window.addEventListener("mousemove", resetTimer);
    window.addEventListener("keydown", resetTimer);
    window.addEventListener("click", resetTimer);
    window.addEventListener("scroll", resetTimer);

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - lastActivity) / 1000);
      const remaining = Math.max(0, 600 - elapsed);
      setSecondsRemaining(remaining);
      if (remaining === 0) {
        clearInterval(interval);
        signOut();
        router.replace("/login?timeout=1");
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      window.removeEventListener("mousemove", resetTimer);
      window.removeEventListener("keydown", resetTimer);
      window.removeEventListener("click", resetTimer);
      window.removeEventListener("scroll", resetTimer);
    };
  }, [lastActivity, router]);

  // Check backend health & fetch overview stats
  useEffect(() => {
    if (!email) return;

    fetch("/healthz")
      .then((res) => (res.ok ? setBackendHealth("online") : setBackendHealth("degraded")))
      .catch(() => setBackendHealth("degraded"));

    // Fetch live counts if permissions allow
    if (me && can(me, "application.read_all")) {
      api.manage
        .list(2026)
        .then((data: any) => {
          if (data?.applications) {
            setStats((prev) => ({ ...prev, applications: String(data.applications.length) }));
          }
        })
        .catch(() => {});
    }

    if (me && (can(me, "support.handle") || can(me, "support.review"))) {
      api.support
        .queue()
        .then((q: any) => {
          if (q?.tickets) {
            setStats((prev) => ({ ...prev, tickets: String(q.tickets.length) }));
          }
        })
        .catch(() => {});
    }

    if (me && can(me, "user.read")) {
      api.admin
        .users({ limit: 50 })
        .then((u: any) => {
          if (u?.users) {
            setStats((prev) => ({ ...prev, users: String(u.users.length) }));
          }
        })
        .catch(() => {});
    }
  }, [email, me]);

  if (email === undefined) return null;
  if (!email) {
    router.replace("/login");
    return null;
  }

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const isAdmin = me?.roles.includes("admin");
  const isManagement = me?.roles.includes("management");
  const isSupport = me?.roles.includes("customer_support");

  return (
    <div className="dashboard-container">
      <style jsx>{`
        .dashboard-container {
          padding: 24px 0 60px;
          max-width: 1200px;
          margin: 0 auto;
        }
        .hero-banner {
          background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 60%, #3b82f6 100%);
          border-radius: 20px;
          padding: 32px 36px;
          color: #ffffff;
          box-shadow: 0 16px 36px -10px rgba(30, 58, 138, 0.35);
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 28px;
          position: relative;
          overflow: hidden;
        }
        .hero-banner::after {
          content: "";
          position: absolute;
          right: -40px;
          bottom: -40px;
          width: 220px;
          height: 220px;
          background: radial-gradient(circle, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 70%);
          border-radius: 50%;
        }
        .hero-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 12px;
          background: rgba(255, 255, 255, 0.2);
          backdrop-filter: blur(8px);
          border-radius: 9999px;
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 12px;
        }
        .hero-title {
          font-size: 28px;
          font-weight: 800;
          margin: 0 0 6px;
          letter-spacing: -0.02em;
        }
        .hero-sub {
          font-size: 15px;
          opacity: 0.9;
          margin: 0;
          max-width: 600px;
        }
        .session-badge {
          background: rgba(0, 0, 0, 0.25);
          backdrop-filter: blur(8px);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 12px;
          padding: 12px 18px;
          text-align: right;
        }
        .session-timer {
          font-family: monospace;
          font-size: 20px;
          font-weight: 800;
          color: #fef08a;
        }
        .session-label {
          font-size: 11px;
          opacity: 0.8;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 16px;
          margin-bottom: 32px;
        }
        .stat-card {
          background: #ffffff;
          border-radius: 16px;
          padding: 20px;
          border: 1px solid #e2e8f0;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        .stat-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
        }
        .stat-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        .stat-label {
          font-size: 13px;
          font-weight: 600;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .stat-icon {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
        }
        .stat-value {
          font-size: 32px;
          font-weight: 800;
          color: #0f172a;
          line-height: 1;
          margin-bottom: 6px;
        }
        .stat-desc {
          font-size: 13px;
          color: #94a3b8;
        }
        .section-title {
          font-size: 20px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 16px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .modules-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          gap: 20px;
          margin-bottom: 32px;
        }
        .module-card {
          background: #ffffff;
          border-radius: 18px;
          padding: 24px;
          border: 1px solid #e2e8f0;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04);
          text-decoration: none;
          color: inherit;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          transition: all 0.2s ease;
          position: relative;
        }
        .module-card:hover {
          border-color: #3b82f6;
          box-shadow: 0 12px 30px -8px rgba(37, 99, 235, 0.2);
          transform: translateY(-3px);
        }
        .module-top {
          display: flex;
          align-items: flex-start;
          gap: 16px;
          margin-bottom: 16px;
        }
        .module-icon-wrap {
          width: 48px;
          height: 48px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          flex-shrink: 0;
        }
        .module-name {
          font-size: 18px;
          font-weight: 700;
          color: #0f172a;
          margin: 0 0 4px;
        }
        .module-desc {
          font-size: 14px;
          color: #64748b;
          line-height: 1.45;
          margin: 0;
        }
        .module-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-top: 16px;
          border-top: 1px solid #f1f5f9;
          font-size: 13px;
          font-weight: 600;
          color: #2563eb;
        }
        .system-strip {
          background: #f8fafc;
          border-radius: 16px;
          padding: 18px 24px;
          border: 1px solid #e2e8f0;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 16px;
        }
        .system-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: #475569;
        }
        .pulse-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: #10b981;
          box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.25);
        }
        .pulse-dot.warn {
          background: #f59e0b;
          box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.25);
        }
      `}</style>

      {/* Top Hero Banner */}
      <div className="hero-banner">
        <div>
          <div className="hero-badge">
            <span>🛡️</span>
            <span>
              {isAdmin ? "Super Administrator" : isSupport ? "Customer Support" : "Staff Console"}
            </span>
          </div>
          <h1 className="hero-title">
            Welcome, {me?.account?.fullName || email.split("@")[0]}
          </h1>
          <p className="hero-sub">
            Startup Jathara 2026 Admin & Operations Console · GIET University
          </p>
        </div>
        <div className="session-badge">
          <div className="session-timer">{formatTime(secondsRemaining)}</div>
          <div className="session-label">Session Timeout (10m idle)</div>
        </div>
      </div>

      {/* Overview Stat Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Applications</span>
            <div className="stat-icon" style={{ background: "#eff6ff", color: "#2563eb" }}>📝</div>
          </div>
          <div className="stat-value">{stats.applications}</div>
          <div className="stat-desc">Startup applications registered</div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Support Queue</span>
            <div className="stat-icon" style={{ background: "#fef2f2", color: "#dc2626" }}>🎧</div>
          </div>
          <div className="stat-value">{stats.tickets}</div>
          <div className="stat-desc">Active tickets & emergency help</div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Active Users</span>
            <div className="stat-icon" style={{ background: "#f0fdf4", color: "#16a34a" }}>👥</div>
          </div>
          <div className="stat-value">{stats.users}</div>
          <div className="stat-desc">Staff, jury & volunteer accounts</div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">AI Ranking</span>
            <div className="stat-icon" style={{ background: "#faf5ff", color: "#9333ea" }}>⚡</div>
          </div>
          <div className="stat-value" style={{ fontSize: 24 }}>{stats.ranking}</div>
          <div className="stat-desc">Scoring models & evaluation criteria</div>
        </div>
      </div>

      {/* Management Modules */}
      <h2 className="section-title">Console Operations</h2>
      <div className="modules-grid">
        {/* Applications */}
        {can(me, "application.read_all") && (
          <Link href="/applications" className="module-card">
            <div className="module-top">
              <div className="module-icon-wrap" style={{ background: "#dbeafe", color: "#1d4ed8" }}>
                📄
              </div>
              <div>
                <h3 className="module-name">Startup Applications</h3>
                <p className="module-desc">
                  Inspect startup registrations, team leader profiles, pitch deck answers, and status updates.
                </p>
              </div>
            </div>
            <div className="module-footer">
              <span>Manage submissions</span>
              <span>→</span>
            </div>
          </Link>
        )}

        {/* Customer Support */}
        {(can(me, "support.handle") || can(me, "support.review") || isSupport || isAdmin) && (
          <Link href="/support" className="module-card">
            <div className="module-top">
              <div className="module-icon-wrap" style={{ background: "#fee2e2", color: "#dc2626" }}>
                🆘
              </div>
              <div>
                <h3 className="module-name">Customer Support Desk</h3>
                <p className="module-desc">
                  Handle live participant tickets, respond to delegate emergencies, and manage resolution notes.
                </p>
              </div>
            </div>
            <div className="module-footer" style={{ color: "#dc2626" }}>
              <span>Open Help Desk</span>
              <span>→</span>
            </div>
          </Link>
        )}

        {/* User Accounts & Credentials */}
        {can(me, "user.read") && (
          <Link href="/users" className="module-card">
            <div className="module-top">
              <div className="module-icon-wrap" style={{ background: "#dcfce7", color: "#15803d" }}>
                👤
              </div>
              <div>
                <h3 className="module-name">Accounts & Roles</h3>
                <p className="module-desc">
                  Administer staff access, grant evaluator & jury permissions, view audit logs, and activate accounts.
                </p>
              </div>
            </div>
            <div className="module-footer" style={{ color: "#15803d" }}>
              <span>Manage staff & permissions</span>
              <span>→</span>
            </div>
          </Link>
        )}

        {/* AI Ranking */}
        {can(me, "ranking.read") && (
          <Link href="/ranking" className="module-card">
            <div className="module-top">
              <div className="module-icon-wrap" style={{ background: "#f3e8ff", color: "#7e22ce" }}>
                🤖
              </div>
              <div>
                <h3 className="module-name">AI Ranking Runs</h3>
                <p className="module-desc">
                  Execute cohort ranking algorithms, manage scoring rubrics, and inspect automated AI score sheets.
                </p>
              </div>
            </div>
            <div className="module-footer" style={{ color: "#7e22ce" }}>
              <span>View ranking models</span>
              <span>→</span>
            </div>
          </Link>
        )}

        {/* Jury Panels */}
        {can(me, "jury.manage") && (
          <Link href="/jury" className="module-card">
            <div className="module-top">
              <div className="module-icon-wrap" style={{ background: "#ffedd5", color: "#c2410c" }}>
                ⚖️
              </div>
              <div>
                <h3 className="module-name">Jury & Evaluations</h3>
                <p className="module-desc">
                  Assign evaluators to pitch tracks, review rubric scoring, and calibrate selection panels.
                </p>
              </div>
            </div>
            <div className="module-footer" style={{ color: "#c2410c" }}>
              <span>Configure jury slots</span>
              <span>→</span>
            </div>
          </Link>
        )}

        {/* Volunteers */}
        {can(me, "volunteer.read") && (
          <Link href="/volunteers" className="module-card">
            <div className="module-top">
              <div className="module-icon-wrap" style={{ background: "#ccfbf1", color: "#0f766e" }}>
                🤝
              </div>
              <div>
                <h3 className="module-name">Volunteers & Desk</h3>
                <p className="module-desc">
                  Coordinate volunteer assignments, shift duties, venue checkpoints, and badge distribution.
                </p>
              </div>
            </div>
            <div className="module-footer" style={{ color: "#0f766e" }}>
              <span>Manage volunteers</span>
              <span>→</span>
            </div>
          </Link>
        )}

        {/* Broadcast Notices */}
        {can(me, "notice.publish") && (
          <Link href="/notices" className="module-card">
            <div className="module-top">
              <div className="module-icon-wrap" style={{ background: "#fef3c7", color: "#b45309" }}>
                📢
              </div>
              <div>
                <h3 className="module-name">Notices & Broadcasts</h3>
                <p className="module-desc">
                  Publish critical event notifications, schedule adjustments, and multi-channel SMS/Email broadcasts.
                </p>
              </div>
            </div>
            <div className="module-footer" style={{ color: "#b45309" }}>
              <span>Send announcement</span>
              <span>→</span>
            </div>
          </Link>
        )}

        {/* Event Info / Content */}
        {can(me, "content.read_all") && (
          <Link href="/content" className="module-card">
            <div className="module-top">
              <div className="module-icon-wrap" style={{ background: "#f1f5f9", color: "#475569" }}>
                📅
              </div>
              <div>
                <h3 className="module-name">Event Schedule & Info</h3>
                <p className="module-desc">
                  Update official summit timelines, keynote speakers, venue hall maps, and FAQs.
                </p>
              </div>
            </div>
            <div className="module-footer" style={{ color: "#475569" }}>
              <span>Edit content</span>
              <span>→</span>
            </div>
          </Link>
        )}

        {/* Imports */}
        {can(me, "import.manage") && (
          <Link href="/imports" className="module-card">
            <div className="module-top">
              <div className="module-icon-wrap" style={{ background: "#e0e7ff", color: "#4338ca" }}>
                📥
              </div>
              <div>
                <h3 className="module-name">Bulk Data Import</h3>
                <p className="module-desc">
                  Upload CSV spreadsheets of approved delegates, VIP attendees, and generate activation keys.
                </p>
              </div>
            </div>
            <div className="module-footer" style={{ color: "#4338ca" }}>
              <span>Import attendees</span>
              <span>→</span>
            </div>
          </Link>
        )}
      </div>

      {/* System Status Strip */}
      <div className="system-strip">
        <div className="system-item">
          <div className={`pulse-dot ${backendHealth === "online" ? "" : "warn"}`} />
          <span>
            API Backend: <strong>https://isf-api.onrender.com</strong> ({backendHealth})
          </span>
        </div>
        <div className="system-item">
          <span>🗄️</span>
          <span>
            Database: <strong>Supabase PostgreSQL (Active)</strong>
          </span>
        </div>
        <div className="system-item">
          <span>🔐</span>
          <Link href="/reset-password" style={{ color: "#2563eb", fontWeight: 600 }}>
            Update Password
          </Link>
        </div>
        <div className="system-item">
          <button
            onClick={() => {
              signOut();
              router.replace("/login");
            }}
            style={{
              background: "#fee2e2",
              color: "#dc2626",
              border: "none",
              padding: "6px 14px",
              borderRadius: "8px",
              fontWeight: 600,
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
