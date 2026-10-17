"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { safeReturnPath, WEB_RETURN_PATHS } from "@sj/contracts";
import { startSignIn, verifyCode } from "@/lib/session";

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeReturnPath(searchParams.get("next"), WEB_RETURN_PATHS, "/status");
  const isTimeout = searchParams.get("timeout") === "1";

  const [step, setStep] = useState<"email" | "password" | "otp">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function handleEmailNext(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    setStep("password");
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (password.trim()) {
        try {
          await verifyCode(email.trim(), "000000", password.trim());
          router.push(next);
          return;
        } catch {
          // Fall through to OTP if password doesn't match
        }
      }
      // If no password or failed, send OTP code via Nodemailer
      await startSignIn(email.trim());
      setStep("otp");
      setStatusMsg(`A verification code was sent via Nodemailer to ${email.trim()}`);
    } catch (err) {
      setError((err as Error).message || "Sign-in failed. Please verify credentials.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSendOtp() {
    setError(null);
    setBusy(true);
    try {
      await startSignIn(email.trim());
      setStep("otp");
      setStatusMsg(`A verification code was sent via Nodemailer to ${email.trim()}`);
    } catch (err) {
      setError((err as Error).message || "Failed to dispatch verification code.");
    } finally {
      setBusy(false);
    }
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await verifyCode(email.trim(), code.trim(), password.trim() || undefined);
      router.push(next);
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
        /* 3D Frosted Glass Background Shapes */
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
          filter: blur(1px);
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
          box-shadow: 0 15px 35px rgba(56, 189, 248, 0.15);
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

        /* Floating Modern Card */
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
          max-width: 100%;
          word-break: break-all;
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

        .action-links {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin: 12px 0 24px;
          font-size: 0.825rem;
        }
        .action-link {
          color: #2563eb;
          text-decoration: none;
          cursor: pointer;
        }
        .action-link:hover {
          text-decoration: underline;
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
        }
        .btn-next:hover:not(:disabled) {
          background: #1e293b;
        }
        .btn-next:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .footer-note {
          margin-top: 24px;
          font-size: 0.825rem;
          color: #64748b;
          text-align: center;
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
        .timeout-alert {
          background: #fffbeb;
          color: #b45309;
          border: 1px solid #fde68a;
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 0.85rem;
          margin-bottom: 18px;
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

      {/* Decorative 3D Pastel Frosted Glass Elements */}
      <div className="glass-bg-canvas" aria-hidden="true">
        <div className="shape-disk" />
        <div className="shape-rect" />
        <div className="shape-loop" />
        <div className="shape-circle" />
      </div>

      {/* Center Floating White Card */}
      <div className="auth-card">
        <div className="card-header">
          {step !== "email" && (
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

        {isTimeout && (
          <div className="timeout-alert" role="alert">
            ⏱ Your session expired after 10 minutes of inactivity. Please sign in again.
          </div>
        )}

        {error && <div className="error-alert" role="alert">{error}</div>}
        {statusMsg && <div className="status-alert" role="status">{statusMsg}</div>}

        {/* Step 1: Enter Email */}
        {step === "email" && (
          <form onSubmit={handleEmailNext}>
            <h1 className="card-heading">Sign in</h1>
            <p className="card-subtext">to continue to Udbhav Portal</p>

            <div style={{ marginBottom: 16 }}>
              <input
                type="email"
                required
                autoFocus
                placeholder="Email or phone"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="styled-input"
              />
            </div>

            <button type="submit" className="btn-next">Next</button>
          </form>
        )}

        {/* Step 2: Enter Password (or request OTP) */}
        {step === "password" && (
          <form onSubmit={handlePasswordSubmit}>
            <div style={{ textAlign: "center" }}>
              <div className="identity-pill">
                <span>{email}</span>
              </div>
            </div>

            <h1 className="card-heading">Enter your password</h1>

            <div style={{ marginBottom: 12 }}>
              <input
                type="password"
                autoFocus
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="styled-input"
              />
            </div>

            <div className="action-links">
              <Link href="/reset-password" className="action-link">
                Forgot your password?
              </Link>
            </div>

            <button type="submit" className="btn-next" disabled={busy}>
              {busy ? "Signing in…" : "Next"}
            </button>

            <div className="footer-note">
              <a
                href="#send-code"
                className="action-link"
                onClick={(e) => { e.preventDefault(); void handleSendOtp(); }}
              >
                Sign in with OTP code via email
              </a>
            </div>
          </form>
        )}

        {/* Step 3: Enter OTP Verification Code */}
        {step === "otp" && (
          <form onSubmit={handleOtpSubmit}>
            <div style={{ textAlign: "center" }}>
              <div className="identity-pill">
                <span>{email}</span>
              </div>
            </div>

            <h1 className="card-heading">Enter verification code</h1>
            <p className="card-subtext">Dispatched to your email via Nodemailer</p>

            <div style={{ marginBottom: 12 }}>
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

            <div className="action-links">
              <a
                href="#resend"
                className="action-link"
                onClick={(e) => { e.preventDefault(); void handleSendOtp(); }}
              >
                Resend code
              </a>
            </div>

            <button type="submit" className="btn-next" disabled={busy}>
              {busy ? "Verifying…" : "Sign in"}
            </button>
          </form>
        )}
      </div>

      {/* Microsoft-style Bottom Links */}
      <div className="bottom-links">
        <Link href="/privacy">Help</Link>
        <Link href="/privacy">Terms of use</Link>
        <Link href="/privacy">Privacy and cookies</Link>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<p className="muted" style={{ padding: 24, textAlign: "center" }}>Loading…</p>}>
      <SignInForm />
    </Suspense>
  );
}
