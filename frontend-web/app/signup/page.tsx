"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { normaliseMobile, type SignupRole } from "@sj/contracts";
import { api, startSignIn, verifyCode } from "@/lib/session";

const ROLES: { id: SignupRole; title: string; desc: string }[] = [
  { id: "startup_team_leader", title: "Startup Leader", desc: "Founders & leaders applying or leading their startup" },
  { id: "startup_team_member", title: "Student Innovator", desc: "Student innovators & team members with working prototypes" },
  { id: "volunteer", title: "Volunteer", desc: "Volunteers helping coordinate the event" },
];

export default function SignUpPage() {
  const router = useRouter();
  const [role, setRole] = useState<SignupRole>("startup_team_leader");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [startupName, setStartupName] = useState("");
  const [edition] = useState("2026");

  const [step, setStep] = useState<"form" | "otp">("form");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const normEmail = email.trim().toLowerCase();
      if (!normEmail) throw new Error("Please enter a valid email address.");

      let normMobile: string | undefined = undefined;
      if (mobile.trim()) {
        const parsed = normaliseMobile(mobile);
        if (!parsed) throw new Error("Please enter a valid 10-digit mobile number.");
        normMobile = parsed;
      }

      await api.signup({
        fullName: fullName.trim(),
        email: normEmail,
        mobile: normMobile,
        role,
        edition: Number(edition) || 2026,
        startupName: (role === "startup_team_leader" || role === "startup_team_member") ? startupName.trim() : undefined,
      });

      // Dispatch real Nodemailer OTP
      await startSignIn(normEmail);
      setStep("otp");
      setStatusMsg(`A verification code was dispatched via Nodemailer to ${normEmail}`);
    } catch (err) {
      setError((err as Error).message || "Sign-up failed. Please check details.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      await verifyCode(email.trim().toLowerCase(), code.trim());
      router.push("/status");
    } catch (err) {
      setError((err as Error).message || "Invalid or expired verification code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-viewport">
      <style jsx>{`
        .auth-viewport {
          min-height: calc(100vh - 120px);
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          position: relative;
          padding: 32px 16px 24px;
          overflow: hidden;
        }
        .glass-bg-canvas {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 0;
          overflow: hidden;
        }
        .shape-disk {
          position: absolute;
          width: 260px;
          height: 140px;
          border-radius: 50%;
          border: 10px solid rgba(249, 115, 22, 0.45);
          background: radial-gradient(circle, rgba(255, 255, 255, 0.4) 0%, rgba(254, 215, 170, 0.25) 100%);
          transform: rotate(-25deg);
          top: 10%;
          left: 10%;
        }
        .shape-rect {
          position: absolute;
          width: 170px;
          height: 240px;
          border-radius: 12px;
          border: 4px solid rgba(56, 189, 248, 0.5);
          background: rgba(224, 242, 254, 0.45);
          backdrop-filter: blur(8px);
          bottom: 10%;
          left: 18%;
        }
        .shape-loop {
          position: absolute;
          width: 220px;
          height: 380px;
          border-radius: 100px;
          border: 14px solid rgba(168, 85, 247, 0.35);
          background: rgba(243, 232, 255, 0.2);
          backdrop-filter: blur(8px);
          transform: rotate(20deg);
          top: 5%;
          right: 15%;
        }
        .shape-circle {
          position: absolute;
          width: 200px;
          height: 200px;
          border-radius: 50%;
          border: 8px solid rgba(34, 197, 94, 0.45);
          background: rgba(220, 252, 231, 0.3);
          bottom: 12%;
          right: 8%;
        }

        .auth-card {
          position: relative;
          z-index: 10;
          width: 100%;
          max-width: 480px;
          background: #ffffff;
          border-radius: 20px;
          padding: 40px 38px;
          box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.05);
        }
        .card-header {
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          margin-bottom: 22px;
        }
        .back-btn {
          position: absolute;
          left: -8px;
          top: 0;
          background: none;
          border: none;
          font-size: 1.25rem;
          color: #334155;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 6px;
        }
        .back-btn:hover {
          background: #f1f5f9;
        }
        .brand-logo-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .ms-tiles {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 2.5px;
          width: 20px;
          height: 20px;
        }
        .tile-red { background: #f25022; }
        .tile-green { background: #7fba00; }
        .tile-blue { background: #00a4ef; }
        .tile-yellow { background: #ffb900; }
        .brand-title {
          font-size: 1.35rem;
          font-weight: 700;
          color: #0f172a;
          letter-spacing: -0.02em;
        }

        .identity-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: #f1f5f9;
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          padding: 4px 14px;
          font-size: 0.825rem;
          color: #334155;
          margin: 0 auto 18px;
        }

        .card-heading {
          font-size: 1.55rem;
          font-weight: 700;
          color: #0f172a;
          margin: 0 0 6px;
          letter-spacing: -0.02em;
        }
        .card-subtext {
          font-size: 0.85rem;
          color: #64748b;
          margin: 0 0 20px;
        }

        .form-group {
          margin-bottom: 14px;
        }
        .input-label {
          display: block;
          font-size: 0.825rem;
          font-weight: 600;
          color: #334155;
          margin-bottom: 5px;
        }
        .styled-input, .styled-select {
          width: 100%;
          padding: 11px 14px;
          font-size: 0.925rem;
          color: #0f172a;
          background: #ffffff;
          border: 1.5px solid #cbd5e1;
          border-radius: 8px;
          outline: none;
          box-sizing: border-box;
          transition: all 0.2s;
        }
        .styled-input:focus, .styled-select:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
        }

        .btn-next {
          width: 100%;
          padding: 13px 20px;
          font-size: 0.95rem;
          font-weight: 600;
          color: #ffffff;
          background: #334155;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.18s;
          margin-top: 8px;
        }
        .btn-next:hover:not(:disabled) {
          background: #1e293b;
        }
        .btn-next:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .action-links {
          margin: 18px 0 0;
          font-size: 0.825rem;
          color: #64748b;
          text-align: center;
        }
        .action-link {
          color: #2563eb;
          text-decoration: none;
        }
        .action-link:hover {
          text-decoration: underline;
        }

        .error-alert {
          background: #fef2f2;
          color: #b91c1c;
          border: 1px solid #fecaca;
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 0.85rem;
          margin-bottom: 16px;
        }
        .status-alert {
          background: #f0fdf4;
          color: #15803d;
          border: 1px solid #bbf7d0;
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 0.85rem;
          margin-bottom: 16px;
        }

        .bottom-links {
          position: relative;
          z-index: 10;
          display: flex;
          gap: 16px;
          margin-top: 24px;
          font-size: 0.775rem;
          color: #64748b;
        }
        .bottom-links a {
          color: #64748b;
          text-decoration: none;
        }
        .bottom-links a:hover {
          text-decoration: underline;
        }

        @media (max-width: 480px) {
          .auth-card {
            padding: 30px 20px;
          }
        }
      `}</style>

      <div className="glass-bg-canvas" aria-hidden="true">
        <div className="shape-disk" />
        <div className="shape-rect" />
        <div className="shape-loop" />
        <div className="shape-circle" />
      </div>

      <div className="auth-card">
        <div className="card-header">
          {step === "otp" && (
            <button
              type="button"
              className="back-btn"
              onClick={() => { setStep("form"); setError(null); }}
              aria-label="Back"
            >
              ←
            </button>
          )}

          <div className="brand-logo-wrap" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <img src="/logos/udbhav.png" alt="Udbhav" style={{ width: "32px", height: "32px", objectFit: "contain", borderRadius: "6px" }} />
            <span className="brand-title">Udbhav</span>
          </div>
        </div>

        {error && <div className="error-alert" role="alert">{error}</div>}
        {statusMsg && <div className="status-alert" role="status">{statusMsg}</div>}

        {step === "form" ? (
          <form onSubmit={handleSignUp}>
            <h1 className="card-heading">Create account</h1>
            <p className="card-subtext">Register for Udbhav — Startup Jathara</p>

            <div className="form-group">
              <label className="input-label" htmlFor="role-select">Select your participation role</label>
              <select
                id="role-select"
                value={role}
                onChange={(e) => setRole(e.target.value as SignupRole)}
                className="styled-select"
              >
                {ROLES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title} — {r.desc}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="input-label" htmlFor="full-name">Full Name</label>
              <input
                id="full-name"
                type="text"
                required
                placeholder="Enter your full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="styled-input"
              />
            </div>

            <div className="form-group">
              <label className="input-label" htmlFor="user-email">Email Address</label>
              <input
                id="user-email"
                type="email"
                required
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="styled-input"
              />
            </div>

            {(role === "startup_team_leader" || role === "startup_team_member") && (
              <div className="form-group">
                <label className="input-label" htmlFor="startup-name">Startup / Venture Name</label>
                <input
                  id="startup-name"
                  type="text"
                  required
                  placeholder="e.g. AgriCool Technologies"
                  value={startupName}
                  onChange={(e) => setStartupName(e.target.value)}
                  className="styled-input"
                />
              </div>
            )}

            <div className="form-group">
              <label className="input-label" htmlFor="user-mobile">Mobile Number (Optional)</label>
              <input
                id="user-mobile"
                type="tel"
                placeholder="10-digit mobile number"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                className="styled-input"
              />
            </div>

            <button type="submit" className="btn-next" disabled={busy}>
              {busy ? "Registering…" : "Create account"}
            </button>

            <div className="action-links">
              Already have an account? <Link href="/signin" className="action-link">Sign in</Link>
            </div>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp}>
            <div style={{ textAlign: "center" }}>
              <div className="identity-pill">
                <span>{email}</span>
              </div>
            </div>

            <h1 className="card-heading">Enter verification code</h1>
            <p className="card-subtext">Dispatched via Nodemailer to {email}</p>

            <div style={{ marginBottom: 14 }}>
              <input
                type="text"
                inputMode="numeric"
                required
                autoFocus
                placeholder="Enter 6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="styled-input"
              />
            </div>

            <button type="submit" className="btn-next" disabled={busy}>
              {busy ? "Activating account…" : "Verify & Activate"}
            </button>
          </form>
        )}
      </div>

      <div className="bottom-links">
        <Link href="/privacy">Help</Link>
        <Link href="/privacy">Terms of use</Link>
        <Link href="/privacy">Privacy and cookies</Link>
      </div>
    </div>
  );
}
