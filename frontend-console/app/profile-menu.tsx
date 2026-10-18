"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMe } from "@/lib/me";
import { signOut, useSessionEmail } from "@/lib/session";

export function ProfileMenu() {
  const router = useRouter();
  const email = useSessionEmail();
  const { me } = useMe();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on click outside or escape key
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!email) return null;

  const displayName = me?.account?.fullName || email.split("@")[0] || "Admin";
  const initial = (displayName.charAt(0) || email.charAt(0) || "U").toUpperCase();
  const roles = me?.roles || [];

  async function handleLogout() {
    setOpen(false);
    await signOut();
    router.replace("/login");
  }

  return (
    <div className="profile-menu-container" ref={menuRef} style={{ position: "relative" }}>
      {/* Profile Trigger Button */}
      <button
        type="button"
        className={`profile-trigger-btn ${open ? "active" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="User profile and account menu"
      >
        <span className="profile-avatar-pill">
          {initial}
        </span>
        <span className="profile-trigger-label">Profile</span>
        <svg
          className={`chevron-icon ${open ? "open" : ""}`}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown Menu Card */}
      {open && (
        <div className="profile-dropdown-card" role="menu">
          {/* User Details Header */}
          <div className="dropdown-user-header">
            <div className="dropdown-avatar-large">
              {initial}
            </div>
            <div className="dropdown-user-meta">
              <div className="dropdown-user-name" title={displayName}>
                {displayName}
              </div>
              <div className="dropdown-user-email" title={email}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <rect width="20" height="16" x="2" y="4" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
                <span>{email}</span>
              </div>
            </div>
          </div>

          {/* Roles Badge List */}
          {roles.length > 0 && (
            <div className="dropdown-roles-row">
              {roles.map((r) => (
                <span key={r} className="role-tag">
                  {r === "admin" ? "Admin" : r === "management" ? "Management" : r === "customer_support" ? "Support" : r}
                </span>
              ))}
            </div>
          )}

          <div className="dropdown-divider" />

          {/* Action Links */}
          <div className="dropdown-links-list">
            <Link
              href="/dashboard"
              className="dropdown-link-item"
              onClick={() => setOpen(false)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="7" height="9" x="3" y="3" rx="1" />
                <rect width="7" height="5" x="14" y="3" rx="1" />
                <rect width="7" height="9" x="14" y="12" rx="1" />
                <rect width="7" height="5" x="3" y="16" rx="1" />
              </svg>
              <span>Dashboard</span>
            </Link>

            <Link
              href="/profile"
              className="dropdown-link-item"
              onClick={() => setOpen(false)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span>Account Settings & Security</span>
            </Link>
          </div>

          <div className="dropdown-divider" />

          {/* Logout Action */}
          <div className="dropdown-footer">
            <button
              type="button"
              className="dropdown-logout-btn"
              onClick={handleLogout}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" x2="9" y1="12" y2="12" />
              </svg>
              <span>Log out</span>
            </button>
          </div>
        </div>
      )}

      <style jsx>{`
        .profile-menu-container {
          position: relative;
          display: inline-block;
        }

        .profile-trigger-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px 6px 6px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 9999px;
          color: #0f172a;
          font-family: inherit;
          font-size: 0.875rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.18s ease;
          user-select: none;
        }

        .profile-trigger-btn:hover,
        .profile-trigger-btn.active {
          background: #eff6ff;
          border-color: #bfdbfe;
          color: #1d4ed8;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        }

        .profile-avatar-pill {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
          color: #ffffff;
          font-size: 0.8rem;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 1px 2px rgba(37, 99, 235, 0.3);
        }

        .profile-trigger-label {
          font-weight: 600;
          letter-spacing: -0.01em;
        }

        .chevron-icon {
          color: #64748b;
          transition: transform 0.2s ease;
        }

        .chevron-icon.open {
          transform: rotate(180deg);
          color: #1d4ed8;
        }

        /* Dropdown Card */
        .profile-dropdown-card {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          width: 290px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          box-shadow: 0 12px 32px -4px rgba(15, 23, 42, 0.12), 0 4px 12px -2px rgba(15, 23, 42, 0.06);
          padding: 12px 0 8px;
          z-index: 1000;
          animation: popIn 0.18s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        @keyframes popIn {
          from {
            opacity: 0;
            transform: translateY(-6px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        .dropdown-user-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 6px 16px 10px;
        }

        .dropdown-avatar-large {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          background: linear-gradient(135deg, #1e40af 0%, #2563eb 50%, #3b82f6 100%);
          color: #ffffff;
          font-size: 1.15rem;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          box-shadow: 0 2px 6px rgba(37, 99, 235, 0.25);
        }

        .dropdown-user-meta {
          min-width: 0;
          flex: 1;
        }

        .dropdown-user-name {
          font-size: 0.925rem;
          font-weight: 700;
          color: #0f172a;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .dropdown-user-email {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 0.775rem;
          color: #64748b;
          margin-top: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .dropdown-user-email span {
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .dropdown-roles-row {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding: 0 16px 10px;
        }

        .role-tag {
          font-size: 0.7rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 2px 7px;
          border-radius: 4px;
          background: #eff6ff;
          color: #1d4ed8;
          border: 1px solid #dbeafe;
        }

        .dropdown-divider {
          height: 1px;
          background: #f1f5f9;
          margin: 6px 0;
        }

        .dropdown-links-list {
          padding: 2px 8px;
        }

        .dropdown-link-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 9px 12px;
          border-radius: 8px;
          font-size: 0.85rem;
          font-weight: 500;
          color: #334155;
          text-decoration: none;
          transition: background 0.15s, color 0.15s;
        }

        .dropdown-link-item:hover {
          background: #f1f5f9;
          color: #0f172a;
        }

        .dropdown-footer {
          padding: 2px 8px 4px;
        }

        .dropdown-logout-btn {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 9px 12px;
          border-radius: 8px;
          background: transparent;
          border: none;
          color: #dc2626;
          font-family: inherit;
          font-size: 0.85rem;
          font-weight: 600;
          text-align: left;
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
        }

        .dropdown-logout-btn:hover {
          background: #fef2f2;
          color: #b91c1c;
        }
      `}</style>
    </div>
  );
}
