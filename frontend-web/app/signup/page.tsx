"use client";
import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { normaliseMobile, type SignupRole } from "@sj/contracts";
import { api, authMode, startSignIn, verifyCode } from "@/lib/session";

const ROLES: { id: SignupRole; title: string; desc: string; icon: string }[] = [
  { id: "startup_team_leader", title: "Startup Team Leader", desc: "Founders & leaders applying or leading their startup.", icon: "🚀" },
  { id: "startup_team_member", title: "Startup Team Member", desc: "Co-founders & team members participating with a startup.", icon: "💼" },
  { id: "volunteer", title: "Volunteer", desc: "Student & community volunteers helping coordinate the event.", icon: "🤝" },
  { id: "management", title: "Management Team", desc: "Core organizing committee & event operations.", icon: "🏛️" },
];

export default function SignUpPage() {
  const router = useRouter();
  const [role, setRole] = useState<SignupRole>("startup_team_leader");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [startupName, setStartupName] = useState("");
  const [edition, setEdition] = useState("2026");

  // OTP stage after signup
  const [stage, setStage] = useState<"signup" | "otp">("signup");
  const [otpCode, setOtpCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      // Call public signup endpoint
      await api.signup({
        fullName: fullName.trim(),
        email: normEmail,
        mobile: normMobile,
        role,
        edition: Number(edition) || 2026,
        startupName: (role === "startup_team_leader" || role === "startup_team_member") ? startupName.trim() : undefined,
      });

      // Initiate sign-in immediately
      const r = await startSignIn(normEmail);
      if (r === "signed_in") {
        router.push("/status");
      } else {
        setStage("otp");
      }
    } catch (err) {
      setError((err as Error).message || "Sign-up failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await verifyCode(email.trim().toLowerCase(), otpCode.trim());
      router.push("/status");
    } catch (err) {
      setError((err as Error).message || "Verification failed. Check the code and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "16px 0" }}>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <Image
          src="/logos/udbhav.png"
          alt="Udbhav"
          width={72}
          height={72}
          style={{ borderRadius: 12, objectFit: "contain", marginBottom: 12 }}
        />
        <h1 style={{ margin: "0 0 6px" }}>Join Udbhav</h1>
        <p className="muted" style={{ margin: 0 }}>
          Startup Jathara @ Dandakaranya · 18–20 December 2026
        </p>
      </div>

      {stage === "signup" ? (
        <form onSubmit={handleSignUp} className="card" style={{ display: "grid", gap: 16 }}>
          <h2 style={{ margin: "0 0 4px" }}>Create your account</h2>
          <p className="muted small" style={{ margin: "0 0 12px" }}>
            Sign up as a Startup Leader, Startup Member, Volunteer, or Management Team member.
          </p>

          <label>Select your role
            <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
              {ROLES.map((r) => (
                <label
                  key={r.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: `1.5px solid ${role === r.id ? "var(--accent)" : "var(--line)"}`,
                    backgroundColor: role === r.id ? "var(--accent-soft)" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="role"
                    value={r.id}
                    checked={role === r.id}
                    onChange={() => setRole(r.id)}
                    style={{ marginTop: 3 }}
                  />
                  <div>
                    <span style={{ fontWeight: 700, color: "var(--ink)" }}>{r.icon} {r.title}</span>
                    <p className="muted small" style={{ margin: "2px 0 0" }}>{r.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </label>

          <label>Full name *
            <input
              type="text"
              required
              placeholder="e.g. Rahul Sharma"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </label>

          {(role === "startup_team_leader" || role === "startup_team_member") && (
            <label>Startup / Company name *
              <input
                type="text"
                required
                placeholder="e.g. GreenTech Innovations"
                value={startupName}
                onChange={(e) => setStartupName(e.target.value)}
              />
            </label>
          )}

          <div className="two">
            <label>Email address *
              <input
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>Mobile number (optional)
              <input
                type="tel"
                placeholder="10-digit number"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
              />
            </label>
          </div>

          <label>Event Edition
            <select value={edition} onChange={(e) => setEdition(e.target.value)}>
              <option value="2026">Startup Jathara 2026</option>
              <option value="2027">Startup Jathara 2027</option>
            </select>
          </label>

          {error && <p className="notice notice-error" role="alert">{error}</p>}
          {authMode === "dev" && (
            <p className="notice notice-warn small">
              Development mode: You will be signed in instantly without an OTP code.
            </p>
          )}

          <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: "100%", padding: 12 }}>
            {busy ? "Creating account..." : "Sign up and continue"}
          </button>

          <p className="small muted" style={{ textAlign: "center", margin: "8px 0 0" }}>
            Already registered or received an invitation?{" "}
            <Link href="/signin" style={{ fontWeight: 600, color: "var(--accent)" }}>
              Sign in here
            </Link>
          </p>
        </form>
      ) : (
        <form onSubmit={handleVerifyOtp} className="card" style={{ display: "grid", gap: 16 }}>
          <h2 style={{ margin: "0 0 4px" }}>Verify your email</h2>
          <p className="muted">
            We sent a one-time verification code to <strong>{email}</strong>. Enter it below to complete sign-in.
          </p>

          <label>One-time code
            <input
              type="text"
              inputMode="numeric"
              required
              placeholder="e.g. 123456"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
              autoFocus
            />
          </label>

          {error && <p className="notice notice-error" role="alert">{error}</p>}

          <button type="submit" className="btn btn-primary" disabled={busy || otpCode.trim().length < 6}>
            {busy ? "Verifying..." : "Verify & Sign in"}
          </button>

          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setStage("signup")}
            style={{ marginTop: 4 }}
          >
            ← Back to sign up details
          </button>
        </form>
      )}
    </div>
  );
}
