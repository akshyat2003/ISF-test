"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CONSOLE_RETURN_PATHS, safeReturnPath } from "@sj/contracts";
import { authMode, startSignIn, verifyCode } from "@/lib/session";

const DEFAULT_ADMIN_PASSWORD = "Udbhav@2026";

const ADMIN_ACCOUNTS = [
  { email: "sarangeeamartya@gmail.com", name: "Amartya Sarangee" },
  { email: "arushkumar450@gmail.com", name: "Arush Kumar" },
  { email: "akshatrajpati@gmail.com", name: "Akshat Rajpati" },
] as const;

function LoginForm() {
  const router = useRouter();
  const next = safeReturnPath(useSearchParams().get("next"), CONSOLE_RETURN_PATHS, "/");
  const [email, setEmail] = useState("sarangeeamartya@gmail.com");
  const [password, setPassword] = useState(DEFAULT_ADMIN_PASSWORD);
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (stage === "email") {
        const res = await startSignIn(email.trim());
        if (res === "signed_in") {
          router.push(next);
        } else {
          setStage("code");
        }
      } else {
        await verifyCode(email.trim(), code.trim());
        router.push(next);
      }
    } catch (err) {
      setError((err as Error).message || "Log in failed. Please check credentials.");
    } finally {
      setLoading(false);
    }
  }

  function selectAdmin(adminEmail: string) {
    setEmail(adminEmail);
    setPassword(DEFAULT_ADMIN_PASSWORD);
    setError(null);
  }

  return (
    <div className="login-card-wrapper">
      <style jsx>{`
        .login-card-wrapper {
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 24px 0 48px;
          min-height: calc(85vh - 60px);
        }
        .login-card {
          width: 100%;
          max-width: 960px;
          min-height: 560px;
          background: #ffffff;
          border-radius: 24px;
          overflow: hidden;
          box-shadow: 0 25px 60px -15px rgba(30, 58, 138, 0.22), 0 0 0 1px rgba(0, 0, 0, 0.05);
          display: grid;
          grid-template-columns: 1fr 1.15fr;
        }
        .login-banner {
          background: linear-gradient(145deg, #1d4ed8 0%, #2563eb 50%, #1e40af 100%);
          color: #ffffff;
          padding: 48px 40px;
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        .banner-decor {
          position: absolute;
          right: -80px;
          bottom: -40px;
          width: 380px;
          height: 380px;
          pointer-events: none;
          opacity: 0.22;
        }
        .banner-star {
          width: 46px;
          height: 46px;
        }
        .banner-content {
          margin: 36px 0 auto;
          position: relative;
          z-index: 2;
        }
        .banner-title {
          font-size: clamp(2rem, 3.2vw, 2.75rem);
          font-weight: 800;
          color: #ffffff;
          line-height: 1.15;
          margin: 0 0 16px;
          letter-spacing: -0.02em;
        }
        .banner-text {
          font-size: 0.95rem;
          line-height: 1.6;
          color: rgba(255, 255, 255, 0.88);
          max-width: 320px;
          margin: 0;
        }
        .banner-footer {
          position: relative;
          z-index: 2;
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.65);
          letter-spacing: 0.05em;
          text-transform: uppercase;
          font-weight: 600;
          margin-top: 32px;
        }
        .login-form-side {
          padding: 48px 44px;
          background: #ffffff;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        .brand-name {
          font-size: 1.5rem;
          font-weight: 800;
          color: #0f172a;
          margin-bottom: 28px;
          letter-spacing: -0.02em;
        }
        .welcome-title {
          font-size: 2rem;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 6px;
          letter-spacing: -0.02em;
        }
        .welcome-subtitle {
          font-size: 0.875rem;
          color: #64748b;
          margin: 0 0 24px;
          line-height: 1.5;
        }
        .welcome-subtitle strong {
          color: #1e293b;
        }
        .input-group {
          margin-bottom: 18px;
        }
        .input-label {
          display: block;
          font-size: 0.825rem;
          font-weight: 600;
          color: #334155;
          margin-bottom: 6px;
        }
        .styled-input {
          width: 100%;
          padding: 13px 16px;
          font-size: 0.95rem;
          color: #0f172a;
          background: #f8fafc;
          border: 1.5px solid #e2e8f0;
          border-radius: 10px;
          outline: none;
          box-sizing: border-box;
          transition: all 0.2s ease;
        }
        .styled-input:focus {
          background: #ffffff;
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
        }
        .btn-submit {
          width: 100%;
          padding: 14px 20px;
          font-size: 0.95rem;
          font-weight: 700;
          color: #ffffff;
          background: #18181b;
          border: none;
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.18s ease;
          margin-top: 8px;
        }
        .btn-submit:hover:not(:disabled) {
          background: #000000;
          transform: translateY(-1px);
          box-shadow: 0 10px 22px -6px rgba(0, 0, 0, 0.35);
        }
        .btn-submit:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .error-badge {
          background: #fef2f2;
          color: #b91c1c;
          border: 1px solid #fecaca;
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 0.85rem;
          margin-bottom: 18px;
        }
        .admin-chips {
          margin-top: 24px;
          padding-top: 18px;
          border-top: 1px solid #f1f5f9;
        }
        .admin-chips-title {
          font-size: 0.75rem;
          color: #64748b;
          text-transform: uppercase;
          font-weight: 700;
          letter-spacing: 0.05em;
          margin-bottom: 8px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .chip-list {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .chip-btn {
          font-size: 0.775rem;
          padding: 6px 12px;
          background: #f1f5f9;
          border: 1.5px solid #e2e8f0;
          border-radius: 8px;
          color: #334155;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .chip-btn:hover {
          background: #e2e8f0;
          color: #0f172a;
          border-color: #cbd5e1;
        }
        .chip-btn.active {
          background: #eff6ff;
          border-color: #3b82f6;
          color: #1d4ed8;
        }
        @media (max-width: 768px) {
          .login-card {
            grid-template-columns: 1fr;
            min-height: auto;
          }
          .login-banner {
            padding: 36px 24px;
          }
          .banner-content {
            margin: 20px 0;
          }
          .login-form-side {
            padding: 36px 24px;
          }
        }
      `}</style>

      <div className="login-card">
        {/* Left Side: Vibrant Blue Gradient Banner */}
        <div className="login-banner">
          {/* Subtle Decorative Curves SVG */}
          <svg className="banner-decor" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 180 C 60 100, 140 100, 180 20" stroke="white" strokeWidth="2.5" />
            <path d="M40 190 C 80 120, 150 120, 190 40" stroke="white" strokeWidth="2.5" />
            <path d="M60 200 C 100 140, 160 140, 200 60" stroke="white" strokeWidth="2.5" />
            <path d="M10 160 C 50 80, 130 80, 170 10" stroke="white" strokeWidth="2" strokeDasharray="6 6" />
          </svg>

          {/* White Geometric Star / Asterisk */}
          <div className="banner-star" aria-hidden="true">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="2" x2="12" y2="22" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              <line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
            </svg>
          </div>

          <div className="banner-content">
            <h1 className="banner-title">
              Hello<br />
              Udbhav! 👋
            </h1>
            <p className="banner-text">
              Unified administration & real-time customer support console. Manage jury evaluations, delegate credentials, applications, and event operations with enterprise speed.
            </p>
          </div>

          <div className="banner-footer">
            ISF · GIET University · Incubatex
          </div>
        </div>

        {/* Right Side: Clean White Login Form */}
        <div className="login-form-side">
          <div className="brand-name">Udbhav</div>

          <h2 className="welcome-title">Welcome Back!</h2>
          <p className="welcome-subtitle">
            Restricted staff portal for <strong>Administrator</strong> and <strong>Customer Support</strong>.
          </p>

          {error && <div className="error-badge" role="alert">{error}</div>}

          <form onSubmit={submit}>
            {stage === "email" ? (
              <>
                <div className="input-group">
                  <label className="input-label" htmlFor="work-email">Work Email</label>
                  <input
                    id="work-email"
                    type="email"
                    required
                    autoFocus
                    placeholder="admin@domain.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="styled-input"
                  />
                </div>

                <div className="input-group">
                  <label className="input-label" htmlFor="work-password">Password</label>
                  <input
                    id="work-password"
                    type="password"
                    required
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="styled-input"
                  />
                </div>
              </>
            ) : (
              <div className="input-group">
                <label className="input-label" htmlFor="otp-code">One-time Security Code</label>
                <input
                  id="otp-code"
                  type="text"
                  inputMode="numeric"
                  required
                  autoFocus
                  placeholder="Enter 6-digit code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="styled-input"
                />
                <p style={{ margin: "6px 0 0", fontSize: "0.78rem", color: "#64748b" }}>
                  Code sent to <strong>{email}</strong>.{" "}
                  <a
                    href="#change"
                    onClick={(e) => { e.preventDefault(); setStage("email"); setError(null); }}
                    style={{ color: "#2563eb", textDecoration: "none" }}
                  >
                    Change email
                  </a>
                </p>
              </div>
            )}

            <button type="submit" className="btn-submit" disabled={loading}>
              {loading ? "Authenticating…" : stage === "email" ? "Login Now" : "Verify & Login"}
            </button>
          </form>

          {/* Dedicated Quick Login Chips for the 3 Admin Emails */}
          <div className="admin-chips">
            <div className="admin-chips-title">
              <span>Admin Accounts</span>
              <span style={{ fontSize: "0.7rem", color: "#94a3b8", textTransform: "none", fontWeight: 500 }}>Default: {DEFAULT_ADMIN_PASSWORD}</span>
            </div>
            <div className="chip-list">
              {ADMIN_ACCOUNTS.map((adm) => (
                <button
                  key={adm.email}
                  type="button"
                  className={`chip-btn ${email === adm.email ? "active" : ""}`}
                  onClick={() => selectAdmin(adm.email)}
                >
                  {adm.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Login() {
  return (
    <Suspense fallback={<p className="muted" style={{ padding: 24 }}>Loading login…</p>}>
      <LoginForm />
    </Suspense>
  );
}
