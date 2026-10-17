"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/session";

function ResetPasswordForm() {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "update" | "success">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    setBusy(true);
    try {
      await api.sendOtp({ email: email.trim().toLowerCase(), purpose: "verification" });
      setStep("update");
      setStatusMsg(`A 6-digit OTP code was dispatched via Nodemailer to ${email.trim()}`);
    } catch (err) {
      setError((err as Error).message || "Failed to send reset code.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match. Please re-enter.");
      return;
    }

    setBusy(true);
    try {
      await api.updatePassword({
        email: email.trim().toLowerCase(),
        code: code.trim(),
        newPassword: newPassword.trim(),
      });
      setStep("success");
    } catch (err) {
      setError((err as Error).message || "Failed to update password. Check your code.");
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
          top: 14%;
          left: 12%;
        }
        .shape-rect {
          position: absolute;
          width: 170px;
          height: 240px;
          border-radius: 12px;
          border: 4px solid rgba(56, 189, 248, 0.5);
          background: rgba(224, 242, 254, 0.45);
          backdrop-filter: blur(8px);
          bottom: 12%;
          left: 20%;
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
          top: 8%;
          right: 18%;
        }
        .shape-circle {
          position: absolute;
          width: 200px;
          height: 200px;
          border-radius: 50%;
          border: 8px solid rgba(34, 197, 94, 0.45);
          background: rgba(220, 252, 231, 0.3);
          bottom: 15%;
          right: 10%;
        }

        .auth-card {
          position: relative;
          z-index: 10;
          width: 100%;
          max-width: 440px;
          background: #ffffff;
          border-radius: 20px;
          padding: 44px 42px;
          box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.05);
        }
        .card-header {
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          margin-bottom: 24px;
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
          margin: 0 0 8px;
          letter-spacing: -0.02em;
        }
        .card-subtext {
          font-size: 0.85rem;
          color: #64748b;
          margin: 0 0 24px;
        }

        .form-group {
          margin-bottom: 16px;
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
          padding: 12px 14px;
          font-size: 0.95rem;
          color: #0f172a;
          background: #ffffff;
          border: 1.5px solid #cbd5e1;
          border-radius: 8px;
          outline: none;
          box-sizing: border-box;
          transition: all 0.2s;
        }
        .styled-input:focus {
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

        .error-alert {
          background: #fef2f2;
          color: #b91c1c;
          border: 1px solid #fecaca;
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 0.85rem;
          margin-bottom: 18px;
        }
        .status-alert {
          background: #f0fdf4;
          color: #15803d;
          border: 1px solid #bbf7d0;
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 0.85rem;
          margin-bottom: 18px;
        }

        .action-links {
          margin-top: 20px;
          text-align: center;
          font-size: 0.825rem;
        }
        .action-link {
          color: #2563eb;
          text-decoration: none;
        }
        .action-link:hover {
          text-decoration: underline;
        }

        .bottom-links {
          position: relative;
          z-index: 10;
          display: flex;
          gap: 16px;
          margin-top: 28px;
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
            padding: 32px 24px;
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
          {step === "update" && (
            <button
              type="button"
              className="back-btn"
              onClick={() => { setStep("email"); setError(null); }}
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

        {step === "email" && (
          <form onSubmit={handleSendOtp}>
            <h1 className="card-heading">Reset Password</h1>
            <p className="card-subtext">Enter your registered email to receive a verification OTP</p>

            <div className="form-group">
              <label className="input-label" htmlFor="reset-email">Email Address</label>
              <input
                id="reset-email"
                type="email"
                required
                autoFocus
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="styled-input"
              />
            </div>

            <button type="submit" className="btn-next" disabled={busy}>
              {busy ? "Sending OTP…" : "Send Reset Code"}
            </button>

            <div className="action-links">
              Remember your password? <Link href="/signin" className="action-link">Sign in</Link>
            </div>
          </form>
        )}

        {step === "update" && (
          <form onSubmit={handleUpdatePassword}>
            <div style={{ textAlign: "center" }}>
              <div className="identity-pill">
                <span>{email}</span>
              </div>
            </div>

            <h1 className="card-heading">Create new password</h1>
            <p className="card-subtext">Enter the 6-digit OTP from your email and your new password</p>

            <div className="form-group">
              <label className="input-label" htmlFor="otp-code">Verification Code (OTP)</label>
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
            </div>

            <div className="form-group">
              <label className="input-label" htmlFor="new-password">New Password</label>
              <input
                id="new-password"
                type="password"
                required
                placeholder="At least 6 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="styled-input"
              />
            </div>

            <div className="form-group">
              <label className="input-label" htmlFor="confirm-password">Confirm New Password</label>
              <input
                id="confirm-password"
                type="password"
                required
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="styled-input"
              />
            </div>

            <button type="submit" className="btn-next" disabled={busy}>
              {busy ? "Updating…" : "Update Password"}
            </button>
          </form>
        )}

        {step === "success" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "3rem", margin: "10px 0" }}>✓</div>
            <h1 className="card-heading">Password Updated!</h1>
            <p className="card-subtext">
              Your password has been securely updated. You can now sign in with your new credentials.
            </p>

            <button
              type="button"
              className="btn-next"
              onClick={() => router.push("/signin")}
            >
              Sign in now
            </button>
          </div>
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

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<p className="muted" style={{ padding: 24, textAlign: "center" }}>Loading…</p>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
