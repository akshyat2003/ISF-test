"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { storeSessionToken } from "@/lib/session";

type CategoryId =
  | "startup_founder"
  | "student_innovator"
  | "volunteer"
  | "investor"
  | "corporate"
  | "mentor"
  | "observer";

interface CategoryMeta {
  id: CategoryId;
  title: string;
  badge: string;
  icon: string;
  desc: string;
  teamLabel: string;
}

const CATEGORIES: CategoryMeta[] = [
  {
    id: "startup_founder",
    title: "Startup Founder & Innovators",
    badge: "Founders",
    icon: "🚀",
    desc: "Founders, co-founders & innovators building early-stage or growth ventures",
    teamLabel: "Startup / Company Name",
  },
  {
    id: "student_innovator",
    title: "Student Innovators",
    badge: "Students",
    icon: "🎓",
    desc: "Undergraduates, researchers & college teams with working prototypes",
    teamLabel: "Project / Team / College Name",
  },
  {
    id: "volunteer",
    title: "Volunteers (Individual)",
    badge: "Volunteers",
    icon: "🤝",
    desc: "Individual student & campus volunteers for summit coordination & venue operations",
    teamLabel: "Institution / Organization",
  },
  {
    id: "investor",
    title: "Investors, VCs & Angel Networks",
    badge: "Investors",
    icon: "💼",
    desc: "Venture capitalists, angel investors, family offices & seed funds seeking dealflow",
    teamLabel: "Fund / Firm / Network Name",
  },
  {
    id: "corporate",
    title: "Corporate, GCC & Industry Delegates",
    badge: "Corporate",
    icon: "🏢",
    desc: "Enterprise leaders, GCC innovation heads & industrial technology delegates",
    teamLabel: "Company / Corporate Entity",
  },
  {
    id: "mentor",
    title: "Mentors, Academicians & Sector Experts",
    badge: "Mentors",
    icon: "🧭",
    desc: "Domain experts, academic scholars, incubation directors & technical advisors",
    teamLabel: "Affiliated Institution / Organization",
  },
  {
    id: "observer",
    title: "Ecosystem Observers & Cultural Guests",
    badge: "Observers",
    icon: "🌐",
    desc: "Government dignitaries, policy fellows, ecosystem observers & special invitees",
    teamLabel: "Delegation / Organization",
  },
];

const DOMAINS = [
  "AgriTech & Rural Economy",
  "AI & Generative Intelligence",
  "DeepTech & Semiconductor",
  "HealthTech & BioSciences",
  "CleanTech, Solar & Renewable Energy",
  "FinTech & Digital Commerce",
  "EdTech & Future Skills",
  "Robotics, Drones & Aerospace",
  "Defense & Smart Surveillance",
  "IoT, Smart Cities & Mobility",
  "Web3, Blockchain & CyberSecurity",
  "Social Impact & Inclusive Innovation",
  "Other / Multi-disciplinary",
];

export default function RegisterPage() {
  const router = useRouter();

  const [category, setCategory] = useState<CategoryId>("startup_founder");
  const [teamName, setTeamName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mobile, setMobile] = useState("");
  const [altMobile, setAltMobile] = useState("");
  const [domain, setDomain] = useState("AI & Generative Intelligence");
  const [teamMembers, setTeamMembers] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [country, setCountry] = useState("India");
  const [linkedinUrl, setLinkedinUrl] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState<{
    email: string;
    fullName: string;
    category: string;
    role: string;
  } | null>(null);

  const activeCategory = CATEGORIES.find((c) => c.id === category) || CATEGORIES[0];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const normEmail = email.trim().toLowerCase();
    if (!normEmail || !normEmail.includes("@")) {
      setError("Please provide a valid email address.");
      return;
    }
    if (!fullName.trim()) {
      setError("Please enter your team lead / full name.");
      return;
    }
    if (!password || password.length < 6) {
      setError("Please enter a password of at least 6 characters.");
      return;
    }
    if (!mobile.trim()) {
      setError("Please provide a primary phone number.");
      return;
    }

    setBusy(true);

    try {
      const res = await fetch("/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          teamName: teamName.trim(),
          fullName: fullName.trim(),
          email: normEmail,
          password: password.trim(),
          mobile: mobile.trim(),
          altMobile: altMobile.trim(),
          domain,
          teamMembers: teamMembers.trim(),
          city: city.trim(),
          state: state.trim(),
          country: country.trim(),
          linkedinUrl: linkedinUrl.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || data.message || "Registration failed. Please check your inputs.");
      }

      if (data.token) {
        storeSessionToken(data.token);
      }

      setRegistered({
        email: normEmail,
        fullName: fullName.trim(),
        category: activeCategory.title,
        role: data.role || "delegate",
      });
    } catch (err) {
      setError((err as Error).message || "An unexpected error occurred. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------- Successful Confirmation State
  if (registered) {
    return (
      <div className="reg-viewport">
        <style jsx>{`
          .reg-viewport {
            min-height: calc(100vh - 120px);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 40px 16px;
            background: linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%);
          }
          .success-card {
            background: #ffffff;
            border-radius: 24px;
            padding: 44px 36px;
            max-width: 580px;
            width: 100%;
            box-shadow: 0 20px 45px -10px rgba(30, 58, 138, 0.15);
            border: 1px solid #e0e7ff;
            text-align: center;
          }
          .success-icon {
            width: 68px;
            height: 68px;
            border-radius: 50%;
            background: #ecfdf5;
            color: #059669;
            font-size: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 20px;
            box-shadow: 0 0 0 8px #d1fae5;
          }
          .success-title {
            font-size: 26px;
            font-weight: 800;
            color: #0f172a;
            margin: 0 0 10px;
          }
          .success-sub {
            font-size: 15px;
            color: #475569;
            line-height: 1.5;
            margin: 0 0 24px;
          }
          .info-box {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            padding: 20px;
            text-align: left;
            margin-bottom: 28px;
          }
          .info-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            font-size: 14px;
            border-bottom: 1px solid #f1f5f9;
          }
          .info-row:last-child {
            border-bottom: none;
          }
          .info-label {
            color: #64748b;
            font-weight: 500;
          }
          .info-val {
            color: #0f172a;
            font-weight: 600;
          }
          .actions {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }
          .btn-primary {
            background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%);
            color: #ffffff;
            border: none;
            padding: 14px 24px;
            border-radius: 12px;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
            text-decoration: none;
            display: block;
            transition: all 0.2s ease;
          }
          .btn-primary:hover {
            opacity: 0.95;
            transform: translateY(-1px);
          }
          .btn-secondary {
            background: #f1f5f9;
            color: #334155;
            border: 1px solid #cbd5e1;
            padding: 12px 20px;
            border-radius: 12px;
            font-size: 14px;
            font-weight: 600;
            text-decoration: none;
            display: block;
          }
        `}</style>

        <div className="success-card">
          <div className="success-icon">✓</div>
          <h1 className="success-title">Registration Confirmed!</h1>
          <p className="success-sub">
            Welcome to <strong>Udbhav @ Startup Jathara 2026</strong>. Your profile and login credentials have been created and authenticated.
          </p>

          <div className="info-box">
            <div className="info-row">
              <span className="info-label">Full Name:</span>
              <span className="info-val">{registered.fullName}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Email:</span>
              <span className="info-val">{registered.email}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Category:</span>
              <span className="info-val">{registered.category}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Status:</span>
              <span className="info-val" style={{ color: "#059669" }}>Active · Logged In</span>
            </div>
          </div>

          <div className="actions">
            <Link href="/status" className="btn-primary">
              View Application & Summit Status →
            </Link>
            <Link href="/signin" className="btn-secondary">
              Go to Sign In Page
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- Registration Form
  return (
    <div className="reg-viewport">
      <style jsx>{`
        .reg-viewport {
          min-height: calc(100vh - 120px);
          padding: 40px 16px 80px;
          background: linear-gradient(180deg, #f8fafc 0%, #eff6ff 100%);
        }
        .reg-container {
          max-width: 980px;
          margin: 0 auto;
        }
        .reg-header {
          text-align: center;
          margin-bottom: 36px;
        }
        .brand-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: #ffffff;
          border: 1px solid #e0e7ff;
          padding: 6px 16px;
          border-radius: 9999px;
          font-size: 13px;
          font-weight: 600;
          color: #1e3a8a;
          margin-bottom: 16px;
          box-shadow: 0 4px 12px rgba(30, 58, 138, 0.05);
        }
        .reg-title {
          font-size: 36px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 10px;
          letter-spacing: -0.02em;
        }
        .reg-subtitle {
          font-size: 16px;
          color: #64748b;
          max-width: 680px;
          margin: 0 auto;
          line-height: 1.5;
        }
        .reg-card {
          background: #ffffff;
          border-radius: 24px;
          padding: 36px;
          box-shadow: 0 20px 45px -10px rgba(0, 0, 0, 0.08);
          border: 1px solid #e2e8f0;
        }
        .section-label {
          font-size: 14px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #1e3a8a;
          margin: 0 0 16px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .categories-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 12px;
          margin-bottom: 32px;
        }
        .category-pill {
          background: #f8fafc;
          border: 1.5px solid #e2e8f0;
          border-radius: 14px;
          padding: 14px 16px;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: flex-start;
          gap: 12px;
          text-align: left;
        }
        .category-pill:hover {
          border-color: #3b82f6;
          background: #f0f7ff;
        }
        .category-pill.active {
          border-color: #2563eb;
          background: #eff6ff;
          box-shadow: 0 4px 14px rgba(37, 99, 235, 0.15);
        }
        .cat-icon {
          font-size: 24px;
          flex-shrink: 0;
          margin-top: 2px;
        }
        .cat-title {
          font-size: 13px;
          font-weight: 700;
          color: #0f172a;
          margin: 0 0 2px;
          line-height: 1.3;
        }
        .cat-desc {
          font-size: 11px;
          color: #64748b;
          line-height: 1.3;
          margin: 0;
        }
        .form-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 20px;
          margin-bottom: 24px;
        }
        .form-full {
          grid-column: 1 / -1;
        }
        .input-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .input-label {
          font-size: 13px;
          font-weight: 600;
          color: #334155;
          display: flex;
          justify-content: space-between;
        }
        .input-req {
          color: #ef4444;
        }
        .input-field {
          width: 100%;
          padding: 12px 16px;
          border-radius: 10px;
          border: 1.5px solid #cbd5e1;
          font-size: 14px;
          color: #0f172a;
          outline: none;
          background: #ffffff;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
          box-sizing: border-box;
        }
        .input-field:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
        }
        .password-wrap {
          position: relative;
        }
        .password-toggle {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          color: #64748b;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .error-banner {
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #dc2626;
          border-radius: 12px;
          padding: 14px 18px;
          font-size: 14px;
          font-weight: 500;
          margin-bottom: 24px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .submit-btn {
          width: 100%;
          background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%);
          color: #ffffff;
          border: none;
          padding: 16px 28px;
          border-radius: 12px;
          font-size: 16px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 8px 24px -6px rgba(37, 99, 235, 0.4);
          margin-top: 12px;
        }
        .submit-btn:hover:not(:disabled) {
          opacity: 0.95;
          transform: translateY(-1px);
        }
        .submit-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .footer-links {
          margin-top: 24px;
          text-align: center;
          font-size: 14px;
          color: #64748b;
        }
        .footer-links a {
          color: #2563eb;
          font-weight: 600;
          text-decoration: none;
        }
        .footer-links a:hover {
          text-decoration: underline;
        }
      `}</style>

      <div className="reg-container">
        {/* Header */}
        <div className="reg-header">
          <div className="brand-badge">
            <img src="/logos/udbhav.png" alt="Udbhav" style={{ width: 22, height: 22, objectFit: "contain" }} />
            <span>Startup Jathara 2026 · Dandakaranya</span>
          </div>
          <h1 className="reg-title">Summit Delegate & Participant Registration</h1>
          <p className="reg-subtitle">
            Register your startup, delegation, or participant credentials for the Dandakaranya Innovation Summit (18–20 December 2026 at GIET University).
          </p>
        </div>

        <div className="reg-card">
          {error && (
            <div className="error-banner" role="alert">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* 1. Category Selection */}
            <div className="section-label">
              <span>Step 1</span> · Choose Your Registration Category
            </div>
            <div className="categories-grid">
              {CATEGORIES.map((cat) => (
                <div
                  key={cat.id}
                  className={`category-pill ${category === cat.id ? "active" : ""}`}
                  onClick={() => setCategory(cat.id)}
                  role="button"
                  tabIndex={0}
                >
                  <span className="cat-icon">{cat.icon}</span>
                  <div>
                    <h3 className="cat-title">{cat.title}</h3>
                    <p className="cat-desc">{cat.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* 2. Primary Information */}
            <div className="section-label">
              <span>Step 2</span> · Participant & Organisation Details
            </div>
            <div className="form-grid">
              {category !== "volunteer" && (
                <div className="input-group">
                  <label className="input-label" htmlFor="teamName">
                    <span>{activeCategory.teamLabel} <span className="input-req">*</span></span>
                  </label>
                  <input
                    id="teamName"
                    className="input-field"
                    type="text"
                    required
                    placeholder={
                      category === "startup_founder"
                        ? "e.g. AgriSmart Robotics Pvt Ltd"
                        : category === "student_innovator"
                        ? "e.g. GIET AI Innovation Lab"
                        : "e.g. Venture Network / Institution"
                    }
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                  />
                </div>
              )}

              <div className="input-group">
                <label className="input-label" htmlFor="fullName">
                  <span>{category === "volunteer" ? "Volunteer Full Name" : "Team Lead / Full Name"} <span className="input-req">*</span></span>
                </label>
                <input
                  id="fullName"
                  className="input-field"
                  type="text"
                  required
                  placeholder="e.g. Akshat Rajpati"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>

              <div className="input-group">
                <label className="input-label" htmlFor="email">
                  <span>Official Email Address <span className="input-req">*</span></span>
                </label>
                <input
                  id="email"
                  className="input-field"
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="input-group">
                <label className="input-label" htmlFor="password">
                  <span>Create Account Password <span className="input-req">*</span></span>
                </label>
                <div className="password-wrap">
                  <input
                    id="password"
                    className="input-field"
                    type={showPassword ? "text" : "password"}
                    required
                    placeholder="Minimum 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              <div className="input-group">
                <label className="input-label" htmlFor="mobile">
                  <span>Primary Phone Number <span className="input-req">*</span></span>
                </label>
                <input
                  id="mobile"
                  className="input-field"
                  type="tel"
                  required
                  placeholder="+91 98765 43210"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                />
              </div>

              <div className="input-group">
                <label className="input-label" htmlFor="altMobile">
                  <span>Alternative Phone Number</span>
                </label>
                <input
                  id="altMobile"
                  className="input-field"
                  type="tel"
                  placeholder="Secondary / Emergency contact"
                  value={altMobile}
                  onChange={(e) => setAltMobile(e.target.value)}
                />
              </div>

              <div className="input-group">
                <label className="input-label" htmlFor="domain">
                  <span>Domain / Sector <span className="input-req">*</span></span>
                </label>
                <select
                  id="domain"
                  className="input-field"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                >
                  {DOMAINS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div className="input-group">
                <label className="input-label" htmlFor="linkedinUrl">
                  <span>LinkedIn Profile / URL</span>
                </label>
                <input
                  id="linkedinUrl"
                  className="input-field"
                  type="url"
                  placeholder="https://linkedin.com/in/username"
                  value={linkedinUrl}
                  onChange={(e) => setLinkedinUrl(e.target.value)}
                />
              </div>

              {category !== "volunteer" && (
                <div className="input-group form-full">
                  <label className="input-label" htmlFor="teamMembers">
                    <span>Attending Members Details (Names, roles & count)</span>
                  </label>
                  <textarea
                    id="teamMembers"
                    className="input-field"
                    rows={2}
                    placeholder="e.g. 3 members: Rahul (Tech Lead), Priya (Hardware Engineer), Akshat (CEO)"
                    value={teamMembers}
                    onChange={(e) => setTeamMembers(e.target.value)}
                  />
                </div>
              )}

              <div className="input-group">
                <label className="input-label" htmlFor="city">
                  <span>City <span className="input-req">*</span></span>
                </label>
                <input
                  id="city"
                  className="input-field"
                  type="text"
                  required
                  placeholder="e.g. Bhubaneswar / Gunupur"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />
              </div>

              <div className="input-group">
                <label className="input-label" htmlFor="state">
                  <span>State <span className="input-req">*</span></span>
                </label>
                <input
                  id="state"
                  className="input-field"
                  type="text"
                  required
                  placeholder="e.g. Odisha"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                />
              </div>

              <div className="input-group">
                <label className="input-label" htmlFor="country">
                  <span>Country</span>
                </label>
                <input
                  id="country"
                  className="input-field"
                  type="text"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                />
              </div>
            </div>

            <button type="submit" className="submit-btn" disabled={busy}>
              {busy ? "Registering & Creating Account…" : `Register as ${activeCategory.badge} →`}
            </button>
          </form>

          <div className="footer-links">
            Already registered?{" "}
            <Link href="/signin">Sign in to your account here</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
