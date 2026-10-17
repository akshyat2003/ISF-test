"use client";
import { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { storeSessionToken } from "@/lib/session";

type CategoryId =
  | "startup_founder"
  | "student_innovator"
  | "volunteer";

interface CategoryMeta {
  id: CategoryId;
  title: string;
  badge: string;
  icon: string;
  desc: string;
  teamLabel: string;
  themeColor: string;
  accentBg: string;
  borderColor: string;
  tag: string;
}

const CATEGORIES: CategoryMeta[] = [
  {
    id: "startup_founder",
    title: "Startup Leader",
    badge: "Startup Founders & Leaders",
    icon: "🚀",
    desc: "Founders, co-founders & growth ventures building high-impact tech & business models",
    teamLabel: "Startup / Company Name",
    themeColor: "#2563eb",
    accentBg: "linear-gradient(135deg, rgba(37, 99, 235, 0.08) 0%, rgba(59, 130, 246, 0.03) 100%)",
    borderColor: "#3b82f6",
    tag: "₹1 Cr+ Pitch Pool · VC Mixer",
  },
  {
    id: "student_innovator",
    title: "Student Innovator",
    badge: "Student Innovators & Labs",
    icon: "🎓",
    desc: "Undergraduates, research scholars & campus innovator teams with working prototypes",
    teamLabel: "Project / Team Name",
    themeColor: "#7c3aed",
    accentBg: "linear-gradient(135deg, rgba(124, 58, 237, 0.08) 0%, rgba(168, 85, 247, 0.03) 100%)",
    borderColor: "#8b5cf6",
    tag: "Prototype Arena · Student Grants",
  },
  {
    id: "volunteer",
    title: "Summit Volunteer",
    badge: "Campus & Youth Volunteers",
    icon: "🤝",
    desc: "Dedicated campus volunteers coordinating operations, guest relations & logistics",
    teamLabel: "Institution / Organisation Name",
    themeColor: "#059669",
    accentBg: "linear-gradient(135deg, rgba(5, 150, 105, 0.08) 0%, rgba(16, 185, 129, 0.03) 100%)",
    borderColor: "#10b981",
    tag: "All-Access Pass · Certificate",
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

export interface TeamMemberInput {
  id: string;
  name: string;
  photoUrl: string;
  phone: string;
  email: string;
}

// Client-side image compressor for lightweight, fast data URLs
function compressImageFile(file: File, maxWidth = 400, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Please select a valid image file (PNG, JPG, WEBP)."));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxWidth) {
            width = Math.round((width * maxWidth) / height);
            height = maxWidth;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Failed to load image file."));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

// Universal LinkedIn / URL normalizer
export function normalizeLinkedInUrl(input: string): string {
  let val = (input || "").trim();
  if (!val) return "";
  if (/^https?:\/\//i.test(val)) return val;
  if (val.startsWith("//")) return `https:${val}`;
  if (/^([a-z0-9-]+\.)?linkedin\.com/i.test(val)) return `https://${val}`;
  if (/^in\/[a-zA-Z0-9_\-%\.]+/i.test(val)) return `https://www.linkedin.com/${val}`;
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(val)) return `https://${val}`;
  const cleanUsername = val.replace(/^@/, "");
  return `https://www.linkedin.com/in/${cleanUsername}`;
}

// Universal E.164 phone normalizer
export function normalizeMobileNumber(input: string): string | null {
  if (!input) return null;
  let s = String(input).trim().replace(/[\s\-().]/g, "");
  if (!s) return null;

  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (/^[6-9]\d{9}$/.test(s)) return `+91${s}`;
  if (/^0[6-9]\d{9}$/.test(s)) return `+91${s.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(s)) return `+${s}`;
  if (/^\d{10}$/.test(s)) return `+91${s}`;
  if (/^0\d{10}$/.test(s)) return `+91${s.slice(1)}`;
  if (/^91\d{10}$/.test(s)) return `+${s}`;
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  if (/^[1-9]\d{7,14}$/.test(s)) return `+${s}`;
  return null;
}

export default function RegisterPage() {
  const router = useRouter();

  const [category, setCategory] = useState<CategoryId>("startup_founder");
  const [teamName, setTeamName] = useState("");
  const [fullName, setFullName] = useState("");
  const [leadPhoto, setLeadPhoto] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mobile, setMobile] = useState("");
  const [altMobile, setAltMobile] = useState("");
  const [domain, setDomain] = useState("AI & Generative Intelligence");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [country, setCountry] = useState("India");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [redgNo, setRedgNo] = useState("");
  const [rollNo, setRollNo] = useState("");

  // Team members (1 to 5 members, compulsory for startup leader & student innovator)
  const [members, setMembers] = useState<TeamMemberInput[]>([
    { id: "1", name: "", photoUrl: "", phone: "", email: "" },
  ]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFormError(msg: string) {
    setError(msg);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 180, behavior: "smooth" });
    }
  }

  const [registered, setRegistered] = useState<{
    email: string;
    fullName: string;
    category: string;
    role: string;
    teamName: string;
    leadPhoto: string;
    redgNo?: string;
    rollNo?: string;
    linkedinUrl?: string;
    members: TeamMemberInput[];
  } | null>(null);

  const activeCategory = CATEGORIES.find((c) => c.id === category) || CATEGORIES[0];
  const isStartupLeader = category === "startup_founder";
  const isStudentInnovator = category === "student_innovator";
  const isStartupOrInnovator = isStartupLeader || isStudentInnovator;
  const isVolunteer = category === "volunteer";

  // Team lead / Volunteer photo upload
  const leadFileInputRef = useRef<HTMLInputElement>(null);
  async function handleLeadPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageFile(file);
      setLeadPhoto(dataUrl);
      setError(null);
    } catch (err) {
      setError((err as Error).message || "Failed to process photo.");
    }
  }

  // Member photo upload
  async function handleMemberPhotoChange(memberId: string, file: File) {
    try {
      const dataUrl = await compressImageFile(file);
      setMembers((prev) =>
        prev.map((m) => (m.id === memberId ? { ...m, photoUrl: dataUrl } : m))
      );
      setError(null);
    } catch (err) {
      setError((err as Error).message || "Failed to process member photo.");
    }
  }

  // Add team member (max 5)
  function handleAddMember() {
    if (members.length >= 5) {
      setError("Maximum 5 team members are allowed.");
      return;
    }
    const newId = String(Date.now());
    setMembers((prev) => [
      ...prev,
      { id: newId, name: "", photoUrl: "", phone: "", email: "" },
    ]);
  }

  // Remove team member (min 1)
  function handleRemoveMember(memberId: string) {
    if (members.length <= 1) {
      setError("At least one team member detail is required.");
      return;
    }
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
  }

  // Update member field
  function handleMemberFieldChange(
    memberId: string,
    field: "name" | "phone" | "email",
    value: string
  ) {
    setMembers((prev) =>
      prev.map((m) => (m.id === memberId ? { ...m, [field]: value } : m))
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const normEmail = email.trim().toLowerCase();
    if (!normEmail || !normEmail.includes("@")) {
      handleFormError("Please provide a valid official email address.");
      return;
    }
    if (!fullName.trim()) {
      handleFormError("Please enter your full name.");
      return;
    }
    if (!password || password.length < 6) {
      handleFormError("Please enter a password of at least 6 characters.");
      return;
    }

    if (isStartupOrInnovator) {
      if (!teamName.trim()) {
        handleFormError("Please enter your Startup / Project Team Name.");
        return;
      }
      if (!leadPhoto) {
        handleFormError("Please upload the Team Lead Photograph.");
        return;
      }
      if (!mobile.trim()) {
        handleFormError("Please enter your Primary Phone Number.");
        return;
      }
      const normMobile = normalizeMobileNumber(mobile);
      if (!normMobile) {
        handleFormError("Please enter a valid Primary Phone Number (e.g. 10-digit mobile number or +91 98765 43210).");
        return;
      }
      setMobile(normMobile);

      if (!altMobile.trim()) {
        handleFormError("Please enter an Alternate Phone Number.");
        return;
      }
      if (!domain.trim()) {
        handleFormError("Please select a Domain / Sector.");
        return;
      }
      if (!city.trim()) {
        handleFormError("Please enter your City.");
        return;
      }
      if (!state.trim()) {
        handleFormError("Please enter your State.");
        return;
      }
      if (!country.trim()) {
        handleFormError("Please enter your Country.");
        return;
      }

      const formattedLinkedin = normalizeLinkedInUrl(linkedinUrl);
      if (!formattedLinkedin) {
        handleFormError("Please enter your LinkedIn Profile / URL.");
        return;
      }
      setLinkedinUrl(formattedLinkedin);

      if (members.length === 0) {
        handleFormError("Please provide details for at least 1 team member (max 5 members).");
        return;
      }
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        if (!m.name.trim()) {
          handleFormError(`Please enter the full name for Member #${i + 1}.`);
          return;
        }
        if (!m.photoUrl) {
          handleFormError(`Please upload a photo for Member #${i + 1} (${m.name || "Member"}).`);
          return;
        }
        if (!m.phone.trim()) {
          handleFormError(`Please enter a phone number for Member #${i + 1} (${m.name}).`);
          return;
        }
        const normMemberPhone = normalizeMobileNumber(m.phone);
        if (!normMemberPhone) {
          handleFormError(`Please enter a valid phone number for Member #${i + 1} (${m.name}) (e.g. 10-digit mobile number or +91 98765 43210).`);
          return;
        }
        if (!m.email.trim() || !m.email.includes("@")) {
          handleFormError(`Please enter a valid email address for Member #${i + 1} (${m.name}).`);
          return;
        }
      }
    } else if (isVolunteer) {
      if (!fullName.trim()) {
        handleFormError("Please enter your Volunteer Full Name.");
        return;
      }
      if (!leadPhoto) {
        handleFormError("Please upload your Volunteer Photograph for the event ID badge.");
        return;
      }
      if (!teamName.trim()) {
        handleFormError("Please enter your Organisation / Institution Name.");
        return;
      }
      if (!redgNo.trim()) {
        handleFormError("Please enter your Registration Number (Redg No).");
        return;
      }
      if (!rollNo.trim()) {
        handleFormError("Please enter your Roll Number / Student ID.");
        return;
      }
      if (!normEmail || !normEmail.includes("@")) {
        handleFormError("Please enter a valid email address.");
        return;
      }
      if (!password || password.length < 6) {
        handleFormError("Please enter an account password of at least 6 characters.");
        return;
      }
      if (!mobile.trim()) {
        handleFormError("Please enter your Primary Phone Number.");
        return;
      }
      const normMobile = normalizeMobileNumber(mobile);
      if (!normMobile) {
        handleFormError("Please enter a valid Primary Phone Number (e.g. 10-digit mobile number like 9876543210 or +91 98765 43210).");
        return;
      }
      setMobile(normMobile);

      if (!altMobile.trim()) {
        handleFormError("Please enter your Alternate Phone Number.");
        return;
      }
      if (!city.trim()) {
        handleFormError("Please enter your City.");
        return;
      }
      if (!state.trim()) {
        handleFormError("Please enter your State.");
        return;
      }
      if (!country.trim()) {
        handleFormError("Please enter your Country.");
        return;
      }
      if (linkedinUrl.trim()) {
        const formattedLinkedin = normalizeLinkedInUrl(linkedinUrl);
        setLinkedinUrl(formattedLinkedin);
      }
    }

    setBusy(true);

    try {
      const finalLinkedin = normalizeLinkedInUrl(linkedinUrl);
      const finalMobile = normalizeMobileNumber(mobile) || mobile.trim();
      const finalAltMobile = normalizeMobileNumber(altMobile) || altMobile.trim();
      const formattedMembers = members.map((m) => ({
        ...m,
        phone: normalizeMobileNumber(m.phone) || m.phone.trim(),
      }));

      const res = await fetch("/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          teamName: teamName.trim(),
          organisationName: isVolunteer ? teamName.trim() : null,
          fullName: fullName.trim(),
          photoUrl: leadPhoto || null,
          redgNo: isVolunteer ? redgNo.trim() : null,
          rollNo: isVolunteer ? rollNo.trim() : null,
          domain: isStartupOrInnovator ? domain.trim() : null,
          city: city.trim(),
          state: state.trim(),
          country: country.trim(),
          linkedinUrl: finalLinkedin || null,
          members: isStartupOrInnovator ? formattedMembers : [],
          email: normEmail,
          mobile: finalMobile,
          altMobile: finalAltMobile || null,
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        const errorMsg = data.detail || data.message || "Registration failed. Please verify your details.";
        handleFormError(errorMsg);
        setBusy(false);
        return;
      }

      if (data.token && data.user) {
        storeSessionToken(data.token, data.user);
      }

      setRegistered({
        email: normEmail,
        fullName: fullName.trim(),
        category: activeCategory.title,
        role: data.role || (isVolunteer ? "volunteer" : "startup_team_leader"),
        teamName: teamName.trim(),
        leadPhoto,
        redgNo: isVolunteer ? redgNo.trim() : undefined,
        rollNo: isVolunteer ? rollNo.trim() : undefined,
        linkedinUrl: finalLinkedin || undefined,
        members: isStartupOrInnovator ? formattedMembers : [],
      });

      if (typeof window !== "undefined") {
        window.scrollTo({ top: 80, behavior: "smooth" });
      }
    } catch (err: any) {
      console.error("[REGISTRATION SUBMIT FATAL]", err);
      handleFormError(err.message || "An unexpected network or server error occurred.");
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------- Confirmed State View
  if (registered) {
    return (
      <div className="reg-viewport">
        <style jsx>{`
          .reg-viewport {
            min-height: calc(100vh - 80px);
            padding: 48px 16px 80px;
            background: 
              radial-gradient(circle at 10% 20%, rgba(37, 99, 235, 0.08) 0%, transparent 40%),
              radial-gradient(circle at 90% 80%, rgba(124, 58, 237, 0.08) 0%, transparent 40%),
              #f8fafc;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          }
          .success-card {
            background: #ffffff;
            border-radius: 28px;
            padding: 48px 40px;
            max-width: 720px;
            width: 100%;
            text-align: center;
            box-shadow: 0 25px 60px -15px rgba(15, 23, 42, 0.12), 0 0 0 1px rgba(226, 232, 240, 0.8);
            position: relative;
            overflow: hidden;
          }
          .success-card::before {
            content: "";
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 6px;
            background: linear-gradient(90deg, #2563eb, #7c3aed, #059669);
          }
          .badge-check {
            width: 76px;
            height: 76px;
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: #ffffff;
            font-size: 38px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            margin: 0 auto 20px;
            box-shadow: 0 12px 28px -6px rgba(16, 185, 129, 0.4);
          }
          .lead-avatar-preview {
            width: 96px;
            height: 96px;
            border-radius: 20px;
            object-fit: cover;
            border: 3px solid #ffffff;
            box-shadow: 0 8px 24px rgba(15, 23, 42, 0.15);
            margin: 0 auto 18px;
            display: block;
          }
          .success-title {
            font-size: 32px;
            font-weight: 800;
            color: #0f172a;
            margin: 0 0 10px;
            letter-spacing: -0.02em;
          }
          .success-sub {
            font-size: 15px;
            color: #64748b;
            margin: 0 0 28px;
            line-height: 1.6;
          }
          .email-banner {
            background: #eff6ff;
            border: 1px solid #bfdbfe;
            color: #1e40af;
            border-radius: 14px;
            padding: 14px 20px;
            font-size: 14px;
            margin-bottom: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
          }
          .info-box {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 18px;
            padding: 24px;
            margin-bottom: 32px;
            text-align: left;
          }
          .info-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 0;
            border-bottom: 1px solid #e2e8f0;
            font-size: 14px;
          }
          .info-row:last-child {
            border-bottom: none;
          }
          .info-label {
            color: #64748b;
            font-weight: 600;
          }
          .info-val {
            color: #0f172a;
            font-weight: 700;
            text-align: right;
          }
          .members-summary-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 12px;
            font-size: 13px;
          }
          .members-summary-table th {
            background: #e2e8f0;
            padding: 8px 10px;
            text-align: left;
            color: #475569;
            font-weight: 600;
            border-radius: 6px;
          }
          .members-summary-table td {
            padding: 10px;
            border-top: 1px solid #e2e8f0;
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
            padding: 16px 28px;
            border-radius: 14px;
            font-size: 16px;
            font-weight: 700;
            cursor: pointer;
            text-decoration: none;
            display: block;
            transition: all 0.2s ease;
            box-shadow: 0 10px 25px -5px rgba(37, 99, 235, 0.4);
          }
          .btn-primary:hover {
            opacity: 0.95;
            transform: translateY(-2px);
          }
          .btn-secondary {
            background: #f1f5f9;
            color: #334155;
            border: 1px solid #cbd5e1;
            padding: 14px 20px;
            border-radius: 14px;
            font-size: 14px;
            font-weight: 600;
            text-decoration: none;
            display: block;
            transition: background 0.2s ease;
          }
          .btn-secondary:hover {
            background: #e2e8f0;
          }
        `}</style>

        <div className="success-card">
          <div className="badge-check">✓</div>
          {registered.leadPhoto && (
            <img
              src={registered.leadPhoto}
              alt={isVolunteer ? "Volunteer" : "Team Lead"}
              className="lead-avatar-preview"
            />
          )}
          <h1 className="success-title">Registration Confirmed!</h1>
          <p className="success-sub">
            Welcome to <strong>ISF @ Startup Jathara 2026</strong>. Your profile has been securely saved and authenticated.
          </p>

          <div className="email-banner">
            <span style={{ fontSize: 18 }}>✉️</span>
            <span>Confirmation dispatched to <strong>{registered.email}</strong>.</span>
          </div>

          <div className="info-box">
            {registered.teamName && (
              <div className="info-row">
                <span className="info-label">
                  {isVolunteer ? "Organisation Name:" : isStudentInnovator ? "Project / Team Name:" : "Startup / Company Name:"}
                </span>
                <span className="info-val">{registered.teamName}</span>
              </div>
            )}
            <div className="info-row">
              <span className="info-label">{isVolunteer ? "Volunteer Full Name:" : "Team Lead Full Name:"}</span>
              <span className="info-val">{registered.fullName}</span>
            </div>
            {registered.redgNo && (
              <div className="info-row">
                <span className="info-label">Registration No (Redg No):</span>
                <span className="info-val">{registered.redgNo}</span>
              </div>
            )}
            {registered.rollNo && (
              <div className="info-row">
                <span className="info-label">Roll Number / Student ID:</span>
                <span className="info-val">{registered.rollNo}</span>
              </div>
            )}
            {isStartupOrInnovator && domain && (
              <div className="info-row">
                <span className="info-label">Domain / Sector:</span>
                <span className="info-val">{domain}</span>
              </div>
            )}
            {registered.linkedinUrl && (
              <div className="info-row">
                <span className="info-label">LinkedIn Profile:</span>
                <span className="info-val">
                  <a
                    href={registered.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#2563eb", textDecoration: "none" }}
                  >
                    {registered.linkedinUrl} ↗
                  </a>
                </span>
              </div>
            )}
            <div className="info-row">
              <span className="info-label">Registered Email:</span>
              <span className="info-val">{registered.email}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Summit Track:</span>
              <span className="info-val" style={{ color: activeCategory.themeColor }}>{registered.category}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Account Status:</span>
              <span className="info-val" style={{ color: "#059669" }}>Active · Verified</span>
            </div>

            {registered.members.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <span className="info-label" style={{ fontWeight: 700, color: "#1e293b", display: "block", marginBottom: 8 }}>
                  Registered Team Members ({registered.members.length} / 5):
                </span>
                <table className="members-summary-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Photo</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {registered.members.map((m, idx) => (
                      <tr key={m.id || idx}>
                        <td>{idx + 1}</td>
                        <td>
                          {m.photoUrl ? (
                            <img
                              src={m.photoUrl}
                              alt={m.name}
                              style={{ width: 32, height: 32, borderRadius: 8, objectFit: "cover" }}
                            />
                          ) : (
                            "📷"
                          )}
                        </td>
                        <td style={{ fontWeight: 600 }}>{m.name}</td>
                        <td style={{ color: "#2563eb" }}>{m.email}</td>
                        <td>{m.phone}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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

  // ---------------------------------------------------------------- Interactive Main Registration Form
  return (
    <div className="reg-viewport">
      <style jsx>{`
        .reg-viewport {
          min-height: calc(100vh - 120px);
          padding: 40px 16px 100px;
          background: 
            radial-gradient(circle at 10% 15%, rgba(37, 99, 235, 0.08) 0%, transparent 45%),
            radial-gradient(circle at 90% 40%, rgba(124, 58, 237, 0.08) 0%, transparent 45%),
            radial-gradient(circle at 50% 90%, rgba(16, 185, 129, 0.06) 0%, transparent 50%),
            #f8fafc;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
        }
        .reg-container {
          max-width: 1040px;
          margin: 0 auto;
        }

        /* Hero Header */
        .reg-header {
          text-align: center;
          margin-bottom: 28px;
        }
        .brand-badge {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          padding: 8px 20px;
          border-radius: 9999px;
          font-size: 13px;
          font-weight: 700;
          color: #1e3a8a;
          margin-bottom: 18px;
          box-shadow: 0 4px 16px -2px rgba(30, 58, 138, 0.08);
          letter-spacing: 0.02em;
        }
        .reg-title {
          font-size: 38px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 12px;
          letter-spacing: -0.03em;
          line-height: 1.15;
        }
        .title-gradient {
          background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 50%, #7c3aed 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .reg-subtitle {
          font-size: 15px;
          color: #64748b;
          max-width: 720px;
          margin: 0 auto 28px;
          line-height: 1.6;
        }

        /* 4 Colourful Summit Highlights Cards */
        .highlight-boxes {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
          margin-bottom: 28px;
        }
        .stat-box {
          background: #ffffff;
          border-radius: 16px;
          padding: 14px 16px;
          border: 1px solid #e2e8f0;
          box-shadow: 0 4px 12px -2px rgba(15, 23, 42, 0.04);
          display: flex;
          align-items: center;
          gap: 12px;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .stat-box:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px -4px rgba(15, 23, 42, 0.08);
        }
        .stat-box-blue {
          border-left: 4px solid #2563eb;
          background: linear-gradient(135deg, #ffffff 60%, rgba(37, 99, 235, 0.04) 100%);
        }
        .stat-box-purple {
          border-left: 4px solid #7c3aed;
          background: linear-gradient(135deg, #ffffff 60%, rgba(124, 58, 237, 0.04) 100%);
        }
        .stat-box-emerald {
          border-left: 4px solid #059669;
          background: linear-gradient(135deg, #ffffff 60%, rgba(5, 150, 105, 0.04) 100%);
        }
        .stat-box-amber {
          border-left: 4px solid #d97706;
          background: linear-gradient(135deg, #ffffff 60%, rgba(217, 119, 6, 0.04) 100%);
        }
        .stat-icon {
          font-size: 24px;
          flex-shrink: 0;
        }
        .stat-title {
          font-size: 13px;
          font-weight: 700;
          color: #0f172a;
          margin: 0;
        }
        .stat-desc {
          font-size: 11px;
          color: #64748b;
          margin: 2px 0 0;
        }

        /* Main Registration Card */
        .reg-card {
          background: #ffffff;
          border-radius: 28px;
          padding: 40px;
          box-shadow: 0 25px 60px -15px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(226, 232, 240, 0.8);
          position: relative;
        }

        /* Stepper bar */
        .stepper-nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 32px;
          padding-bottom: 20px;
          border-bottom: 1px solid #f1f5f9;
        }
        .step-item {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 13px;
          font-weight: 600;
          color: #64748b;
        }
        .step-num {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: #f1f5f9;
          color: #475569;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 700;
          border: 1px solid #e2e8f0;
        }
        .step-active .step-num {
          background: #2563eb;
          color: #ffffff;
          border-color: #2563eb;
          box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.15);
        }
        .step-active {
          color: #1e3a8a;
          font-weight: 700;
        }
        .step-divider {
          flex: 1;
          height: 2px;
          background: #f1f5f9;
          margin: 0 14px;
        }

        /* Section Headings */
        .section-header-box {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin: 32px 0 18px;
          padding-bottom: 12px;
          border-bottom: 1.5px solid #f1f5f9;
        }
        .section-header-box:first-of-type {
          margin-top: 0;
        }
        .section-title {
          font-size: 16px;
          font-weight: 800;
          color: #0f172a;
          display: flex;
          align-items: center;
          gap: 8px;
          letter-spacing: -0.01em;
        }
        .section-tag {
          font-size: 12px;
          font-weight: 600;
          color: #64748b;
          background: #f8fafc;
          padding: 4px 10px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
        }

        /* Step 1: Category Cards Grid */
        .categories-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          margin-bottom: 24px;
        }
        .category-card {
          background: #ffffff;
          border: 2px solid #e2e8f0;
          border-radius: 20px;
          padding: 22px 18px;
          cursor: pointer;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          position: relative;
          text-align: left;
        }
        .category-card:hover {
          border-color: #94a3b8;
          transform: translateY(-3px);
          box-shadow: 0 12px 28px -6px rgba(15, 23, 42, 0.08);
        }
        .category-card.active {
          border-color: var(--active-border);
          background: var(--active-bg);
          box-shadow: 0 14px 32px -8px var(--active-glow);
          transform: translateY(-2px);
        }
        .cat-card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 14px;
        }
        .cat-icon-bubble {
          width: 48px;
          height: 48px;
          border-radius: 14px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
        }
        .cat-check-badge {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          border: 1.5px solid #cbd5e1;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 800;
          color: transparent;
          transition: all 0.2s;
        }
        .category-card.active .cat-check-badge {
          background: #2563eb;
          border-color: #2563eb;
          color: #ffffff;
        }
        .cat-card-title {
          font-size: 17px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 6px;
          letter-spacing: -0.01em;
        }
        .cat-card-desc {
          font-size: 12.5px;
          color: #64748b;
          line-height: 1.45;
          margin: 0 0 14px;
        }
        .cat-card-pill {
          font-size: 11.5px;
          font-weight: 700;
          padding: 5px 10px;
          border-radius: 8px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          color: #334155;
          display: inline-block;
          margin-top: auto;
        }
        .category-card.active .cat-card-pill {
          background: #ffffff;
          border-color: var(--active-border);
          color: var(--active-border);
          font-weight: 800;
        }

        /* Dynamic Track Perks Matrix (3 colourful boxes) */
        .perks-strip {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 14px;
          margin-bottom: 32px;
          padding: 16px;
          border-radius: 18px;
          background: #f8fafc;
          border: 1px dashed #cbd5e1;
        }
        .perk-box {
          background: #ffffff;
          border-radius: 14px;
          padding: 14px;
          border: 1px solid #e2e8f0;
          display: flex;
          gap: 12px;
          align-items: flex-start;
          box-shadow: 0 2px 8px rgba(15, 23, 42, 0.03);
        }
        .perk-icon-circle {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          flex-shrink: 0;
        }
        .perk-info h4 {
          margin: 0 0 3px;
          font-size: 13px;
          font-weight: 700;
          color: #0f172a;
        }
        .perk-info p {
          margin: 0;
          font-size: 11.5px;
          color: #64748b;
          line-height: 1.4;
        }

        /* Form Sub-cards with colourful accent badges */
        .form-section-card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          padding: 24px;
          margin-bottom: 24px;
          box-shadow: 0 4px 16px -4px rgba(15, 23, 42, 0.03);
        }
        .subcard-head {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 18px;
        }
        .subcard-badge {
          font-size: 12px;
          font-weight: 700;
          padding: 4px 12px;
          border-radius: 9999px;
          display: inline-block;
        }
        .subcard-badge-blue {
          background: #eff6ff;
          color: #1e40af;
          border: 1px solid #bfdbfe;
        }
        .subcard-badge-purple {
          background: #f5f3ff;
          color: #5b21b6;
          border: 1px solid #ddd6fe;
        }
        .subcard-badge-emerald {
          background: #ecfdf5;
          color: #065f46;
          border: 1px solid #a7f3d0;
        }
        .subcard-badge-amber {
          background: #fffbeb;
          color: #92400e;
          border: 1px solid #fde68a;
        }
        .subcard-title {
          font-size: 14px;
          font-weight: 700;
          color: #334155;
        }

        /* Form Inputs Grid */
        .form-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 18px;
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
          font-weight: 700;
          color: #334155;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .input-req {
          color: #ef4444;
          font-weight: bold;
        }
        .input-field {
          width: 100%;
          padding: 12px 14px;
          border-radius: 12px;
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

        /* Photo Upload & ID Badge Mockup */
        .photo-card-flex {
          display: flex;
          align-items: center;
          gap: 24px;
          background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
          border: 1.5px dashed #cbd5e1;
          border-radius: 18px;
          padding: 20px 24px;
          transition: all 0.2s ease;
        }
        .photo-card-flex:hover {
          border-color: #2563eb;
          background: linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%);
        }
        .id-badge-frame {
          width: 90px;
          height: 104px;
          border-radius: 14px;
          background: #ffffff;
          border: 2px solid #cbd5e1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          cursor: pointer;
          position: relative;
          box-shadow: 0 6px 16px rgba(15, 23, 42, 0.08);
          flex-shrink: 0;
          transition: transform 0.2s ease;
        }
        .id-badge-frame:hover {
          transform: scale(1.03);
          border-color: #2563eb;
        }
        .id-badge-lanyard-hole {
          position: absolute;
          top: 4px;
          width: 14px;
          height: 4px;
          border-radius: 4px;
          background: #94a3b8;
        }
        .photo-avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .photo-avatar-placeholder {
          font-size: 30px;
          color: #94a3b8;
          margin-top: 8px;
        }
        .photo-upload-meta {
          flex: 1;
        }
        .photo-status-tag {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 700;
          color: #059669;
          background: #ecfdf5;
          padding: 3px 10px;
          border-radius: 6px;
          margin-bottom: 8px;
        }
        .photo-status-tag-req {
          color: #d97706;
          background: #fffbeb;
        }
        .photo-upload-title {
          font-size: 15px;
          font-weight: 700;
          color: #0f172a;
          margin: 0 0 4px;
        }
        .photo-upload-sub {
          font-size: 12.5px;
          color: #64748b;
          margin: 0 0 12px;
          line-height: 1.4;
        }
        .photo-btn-row {
          display: flex;
          gap: 10px;
        }
        .btn-photo-pick {
          background: #2563eb;
          color: #ffffff;
          border: none;
          padding: 8px 16px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.2s;
        }
        .btn-photo-pick:hover {
          background: #1d4ed8;
        }
        .btn-photo-remove {
          background: #fee2e2;
          color: #b91c1c;
          border: 1px solid #fecaca;
          padding: 8px 14px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }

        /* Members Section (Step 3) */
        .members-container {
          display: flex;
          flex-direction: column;
          gap: 16px;
          margin-bottom: 24px;
        }
        .member-card {
          background: #ffffff;
          border: 1.5px solid #e2e8f0;
          border-radius: 18px;
          padding: 20px;
          transition: all 0.2s ease;
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.02);
        }
        .member-card:hover {
          border-color: #cbd5e1;
          box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
        }
        .member-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }
        .member-pill {
          background: #f5f3ff;
          color: #6d28d9;
          font-size: 12px;
          font-weight: 700;
          padding: 4px 12px;
          border-radius: 8px;
          border: 1px solid #ddd6fe;
        }
        .btn-remove-member {
          background: #fee2e2;
          border: 1px solid #fecaca;
          color: #b91c1c;
          font-size: 12px;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: 8px;
          cursor: pointer;
        }
        .member-body-flex {
          display: flex;
          gap: 20px;
          align-items: flex-start;
        }
        .member-photo-col {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          width: 90px;
          flex-shrink: 0;
        }
        .member-avatar-box {
          width: 76px;
          height: 76px;
          border-radius: 14px;
          background: #f8fafc;
          border: 1.5px dashed #94a3b8;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          cursor: pointer;
          transition: border-color 0.2s;
        }
        .member-avatar-box:hover {
          border-color: #7c3aed;
        }
        .member-avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .member-inputs-grid {
          flex: 1;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 14px;
        }
        .btn-add-member {
          background: #ffffff;
          border: 2px dashed #7c3aed;
          color: #7c3aed;
          padding: 14px 22px;
          border-radius: 14px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: all 0.2s ease;
        }
        .btn-add-member:hover:not(:disabled) {
          background: #f5f3ff;
          transform: translateY(-1px);
        }
        .btn-add-member:disabled {
          border-color: #cbd5e1;
          color: #94a3b8;
          cursor: not-allowed;
        }

        /* Security Trust Box */
        .trust-banner {
          background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%);
          border: 1px solid #bbf7d0;
          border-radius: 16px;
          padding: 14px 18px;
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: 18px;
          margin-bottom: 24px;
        }
        .trust-icon {
          font-size: 20px;
          flex-shrink: 0;
        }
        .trust-title {
          font-size: 13px;
          font-weight: 700;
          color: #14532d;
          margin: 0;
        }
        .trust-sub {
          font-size: 11.5px;
          color: #15803d;
          margin: 2px 0 0;
        }

        /* Error Banner */
        .error-banner {
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #dc2626;
          border-radius: 14px;
          padding: 14px 20px;
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 24px;
          display: flex;
          align-items: center;
          gap: 10px;
          box-shadow: 0 4px 12px rgba(220, 38, 38, 0.08);
        }

        /* Submit Button */
        .submit-btn {
          width: 100%;
          background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 50%, #1d4ed8 100%);
          color: #ffffff;
          border: none;
          padding: 18px 32px;
          border-radius: 16px;
          font-size: 17px;
          font-weight: 800;
          cursor: pointer;
          transition: all 0.25s ease;
          box-shadow: 0 10px 30px -5px rgba(37, 99, 235, 0.45);
          letter-spacing: -0.01em;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }
        .submit-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 14px 36px -4px rgba(37, 99, 235, 0.55);
        }
        .submit-btn:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }
        .footer-links {
          margin-top: 26px;
          text-align: center;
          font-size: 14px;
          color: #64748b;
        }
        .footer-links a {
          color: #2563eb;
          font-weight: 700;
          text-decoration: none;
        }
        .footer-links a:hover {
          text-decoration: underline;
        }

        /* Responsive */
        @media (max-width: 900px) {
          .highlight-boxes {
            grid-template-columns: repeat(2, 1fr);
          }
          .categories-grid {
            grid-template-columns: 1fr;
          }
          .perks-strip {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 640px) {
          .reg-card {
            padding: 24px 18px;
          }
          .highlight-boxes {
            grid-template-columns: 1fr;
          }
          .photo-card-flex {
            flex-direction: column;
            text-align: center;
          }
          .photo-btn-row {
            justify-content: center;
          }
          .member-body-flex {
            flex-direction: column;
            align-items: stretch;
          }
          .member-photo-col {
            width: 100%;
            flex-direction: row;
            justify-content: flex-start;
          }
          .stepper-nav {
            flex-direction: column;
            gap: 10px;
            align-items: flex-start;
          }
          .step-divider {
            display: none;
          }
        }
      `}</style>

      <div className="reg-container">
        {/* Summit Top Branding & Header */}
        <div className="reg-header">
          <div className="brand-badge">
            <img src="/logos/udbhav.png" alt="ISF Logo" style={{ width: 22, height: 22, objectFit: "contain" }} />
            <span>ISF · Startup Jathara 2026 · Dandakaranya</span>
          </div>
          <h1 className="reg-title">
            Innovation Summit <span className="title-gradient">Registration</span>
          </h1>
          <p className="reg-subtitle">
            Welcome to the official registration portal for Eastern India&apos;s premier innovation & startup congress.
            Select your track below to register credentials, upload accreditation photographs, and secure your summit pass.
          </p>

          {/* 4 Colourful Quick Highlights Boxes */}
          <div className="highlight-boxes">
            <div className="stat-box stat-box-blue">
              <span className="stat-icon">📍</span>
              <div>
                <p className="stat-title">GIET University Campus</p>
                <p className="stat-desc">Gunupur, Rayagada, Odisha</p>
              </div>
            </div>
            <div className="stat-box stat-box-purple">
              <span className="stat-icon">📅</span>
              <div>
                <p className="stat-title">18–20 December 2026</p>
                <p className="stat-desc">3 Full Days of Innovation & Demos</p>
              </div>
            </div>
            <div className="stat-box stat-box-emerald">
              <span className="stat-icon">🏆</span>
              <div>
                <p className="stat-title">₹1 Crore+ Grant Pool</p>
                <p className="stat-desc">Seed Pitching & Prototyping Stipends</p>
              </div>
            </div>
            <div className="stat-box stat-box-amber">
              <span className="stat-icon">🛡️</span>
              <div>
                <p className="stat-title">Accredited Summit Pass</p>
                <p className="stat-desc">Official ID Badges & Venue Access</p>
              </div>
            </div>
          </div>
        </div>

        {/* Main Form Container */}
        <div className="reg-card">
          {/* Stepper Progress */}
          <div className="stepper-nav">
            <div className="step-item step-active">
              <span className="step-num">1</span>
              <span>Select Summit Track</span>
            </div>
            <div className="step-divider" />
            <div className={`step-item ${fullName && email ? "step-active" : ""}`}>
              <span className="step-num">2</span>
              <span>{isVolunteer ? "Volunteer Profile" : "Lead & Venture Profile"}</span>
            </div>
            <div className="step-divider" />
            <div className={`step-item ${isVolunteer ? "step-active" : members.length > 0 && members[0].name ? "step-active" : ""}`}>
              <span className="step-num">3</span>
              <span>{isVolunteer ? "Badge & Access" : "Team Members"}</span>
            </div>
          </div>

          {error && (
            <div className="error-banner" role="alert">
              <span style={{ fontSize: 20 }}>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* STEP 1: Track Selection */}
            <div className="section-header-box">
              <span className="section-title">
                <span>🎯</span> Step 1 · Choose Your Summit Track
              </span>
              <span className="section-tag">Track-Specific Inclusions</span>
            </div>

            <div className="categories-grid">
              {CATEGORIES.map((cat) => {
                const isSelected = category === cat.id;
                return (
                  <div
                    key={cat.id}
                    className={`category-card ${isSelected ? "active" : ""}`}
                    style={
                      {
                        "--active-border": cat.borderColor,
                        "--active-bg": cat.accentBg,
                        "--active-glow": `${cat.themeColor}33`,
                      } as React.CSSProperties
                    }
                    onClick={() => setCategory(cat.id)}
                    role="button"
                    tabIndex={0}
                  >
                    <div>
                      <div className="cat-card-top">
                        <div className="cat-icon-bubble">{cat.icon}</div>
                        <div className="cat-check-badge">{isSelected ? "✓" : ""}</div>
                      </div>
                      <h3 className="cat-card-title">{cat.title}</h3>
                      <p className="cat-card-desc">{cat.desc}</p>
                    </div>
                    <span className="cat-card-pill">{cat.tag}</span>
                  </div>
                );
              })}
            </div>

            {/* Dynamic Perks Matrix based on activeCategory */}
            <div className="perks-strip">
              {isStartupLeader && (
                <>
                  <div className="perk-box">
                    <div className="perk-icon-circle" style={{ background: "#eff6ff", color: "#2563eb" }}>💼</div>
                    <div className="perk-info">
                      <h4>₹1 Cr+ Pitch & Seed Arena</h4>
                      <p>Compete for equity-free grants, state seed funding, and incubation fast-track.</p>
                    </div>
                  </div>
                  <div className="perk-box">
                    <div className="perk-icon-circle" style={{ background: "#f5f3ff", color: "#7c3aed" }}>🤝</div>
                    <div className="perk-info">
                      <h4>1-on-1 VC & Angel Speed Dating</h4>
                      <p>Curated private pitch slots with 40+ leading institutional and angel investors.</p>
                    </div>
                  </div>
                  <div className="perk-box">
                    <div className="perk-icon-circle" style={{ background: "#ecfdf5", color: "#059669" }}>🎪</div>
                    <div className="perk-info">
                      <h4>Exhibition Booth & VIP Lounge</h4>
                      <p>Dedicated demo space in Startup Expo + access to exclusive Founder Networking Galas.</p>
                    </div>
                  </div>
                </>
              )}

              {isStudentInnovator && (
                <>
                  <div className="perk-box">
                    <div className="perk-icon-circle" style={{ background: "#f5f3ff", color: "#7c3aed" }}>🔬</div>
                    <div className="perk-info">
                      <h4>Innovation Alley Demo Desk</h4>
                      <p>Showcase working hardware/software prototypes to top academic & industry juries.</p>
                    </div>
                  </div>
                  <div className="perk-box">
                    <div className="perk-icon-circle" style={{ background: "#eff6ff", color: "#2563eb" }}>💡</div>
                    <div className="perk-info">
                      <h4>Student Prototyping Stipends</h4>
                      <p>Eligible for prototype improvement grants, patent advisory & fabrication lab access.</p>
                    </div>
                  </div>
                  <div className="perk-box">
                    <div className="perk-icon-circle" style={{ background: "#fffbeb", color: "#d97706" }}>⚡</div>
                    <div className="perk-info">
                      <h4>Founder Mentorship Track</h4>
                      <p>Hands-on sprints with successful tech alumni and venture architects.</p>
                    </div>
                  </div>
                </>
              )}

              {isVolunteer && (
                <>
                  <div className="perk-box">
                    <div className="perk-icon-circle" style={{ background: "#ecfdf5", color: "#059669" }}>🏅</div>
                    <div className="perk-info">
                      <h4>Summit Leadership Certificate</h4>
                      <p>Official commendation & leadership certification issued jointly by GIET University & ISF.</p>
                    </div>
                  </div>
                  <div className="perk-box">
                    <div className="perk-icon-circle" style={{ background: "#eff6ff", color: "#2563eb" }}>🎟️</div>
                    <div className="perk-info">
                      <h4>All-Access Pass (3 Days)</h4>
                      <p>Backstage accreditation, access to keynote speaker tracks, fireside chats & masterclasses.</p>
                    </div>
                  </div>
                  <div className="perk-box">
                    <div className="perk-icon-circle" style={{ background: "#fffbeb", color: "#d97706" }}>🎒</div>
                    <div className="perk-info">
                      <h4>Summit Kit & Hospitality</h4>
                      <p>Custom Volunteer Kit, event t-shirt, branded lanyard ID pass & complimentary meals.</p>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* STEP 2: Profile Details */}
            <div className="section-header-box">
              <span className="section-title">
                <span>📝</span> Step 2 · {isVolunteer ? "Volunteer Profile & Campus Details" : isStudentInnovator ? "Project & Team Lead Credentials" : "Lead Founder & Venture Credentials"}
              </span>
              <span className="section-tag">Required for Verification</span>
            </div>

            {/* Sub-card A: Organization & Identity */}
            <div className="form-section-card">
              <div className="subcard-head">
                <span className="subcard-badge subcard-badge-blue">🏢 Organization & Venture</span>
                <span className="subcard-title">Institutional identity</span>
              </div>

              <div className="form-grid">
                <div className="input-group">
                  <label className="input-label" htmlFor="teamName">
                    <span>{isVolunteer ? "Organisation / Institution Name" : activeCategory.teamLabel} <span className="input-req">*</span></span>
                  </label>
                  <input
                    id="teamName"
                    className="input-field"
                    type="text"
                    required
                    placeholder={
                      isVolunteer
                        ? "e.g. GIET University / Silicon University"
                        : isStartupLeader
                        ? "e.g. AgriSmart Robotics Pvt Ltd"
                        : "e.g. GIET AI Innovation Lab"
                    }
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                  />
                </div>

                <div className="input-group">
                  <label className="input-label" htmlFor="fullName">
                    <span>{isVolunteer ? "Volunteer Full Name" : "Team Lead Full Name"} <span className="input-req">*</span></span>
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

                {isVolunteer && (
                  <>
                    <div className="input-group">
                      <label className="input-label" htmlFor="redgNo">
                        <span>Registration Number (Redg No) <span className="input-req">*</span></span>
                      </label>
                      <input
                        id="redgNo"
                        className="input-field"
                        type="text"
                        required
                        placeholder="e.g. 2101298012"
                        value={redgNo}
                        onChange={(e) => setRedgNo(e.target.value)}
                      />
                    </div>

                    <div className="input-group">
                      <label className="input-label" htmlFor="rollNo">
                        <span>Roll Number / Student ID <span className="input-req">*</span></span>
                      </label>
                      <input
                        id="rollNo"
                        className="input-field"
                        type="text"
                        required
                        placeholder="e.g. 21CSE105"
                        value={rollNo}
                        onChange={(e) => setRollNo(e.target.value)}
                      />
                    </div>
                  </>
                )}

                {!isVolunteer && (
                  <div className="input-group">
                    <label className="input-label" htmlFor="domain">
                      <span>Domain / Innovation Sector <span className="input-req">*</span></span>
                    </label>
                    <select
                      id="domain"
                      className="input-field"
                      value={domain}
                      onChange={(e) => setDomain(e.target.value)}
                      required
                    >
                      {DOMAINS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* Sub-card B: Contact & Credentials */}
            <div className="form-section-card">
              <div className="subcard-head">
                <span className="subcard-badge subcard-badge-purple">🔐 Account & Contact Details</span>
                <span className="subcard-title">Authentication & communication coordinates</span>
              </div>

              <div className="form-grid">
                <div className="input-group">
                  <label className="input-label" htmlFor="email">
                    <span>Official Email Address <span className="input-req">*</span></span>
                  </label>
                  <input
                    id="email"
                    className="input-field"
                    type="email"
                    required
                    placeholder={isVolunteer ? "volunteer@college.edu" : isStudentInnovator ? "innovator@college.edu" : "name@company.com"}
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
                    <span>Primary Phone Number (WhatsApp / Calling) <span className="input-req">*</span></span>
                  </label>
                  <input
                    id="mobile"
                    className="input-field"
                    type="tel"
                    required
                    placeholder="+91 98765 43210 or 10-digit mobile"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    onBlur={() => {
                      if (mobile.trim()) {
                        const formatted = normalizeMobileNumber(mobile);
                        if (formatted) setMobile(formatted);
                      }
                    }}
                  />
                  <span style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                    Formats automatically to E.164 (e.g. 9876543210 &rarr; +919876543210)
                  </span>
                </div>

                <div className="input-group">
                  <label className="input-label" htmlFor="altMobile">
                    <span>Alternate Phone Number <span className="input-req">*</span></span>
                  </label>
                  <input
                    id="altMobile"
                    className="input-field"
                    type="tel"
                    required
                    placeholder="Emergency / Secondary contact"
                    value={altMobile}
                    onChange={(e) => setAltMobile(e.target.value)}
                    onBlur={() => {
                      if (altMobile.trim()) {
                        const formatted = normalizeMobileNumber(altMobile);
                        if (formatted) setAltMobile(formatted);
                      }
                    }}
                  />
                </div>

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
                    <span>Country <span className="input-req">*</span></span>
                  </label>
                  <input
                    id="country"
                    className="input-field"
                    type="text"
                    required
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                  />
                </div>

                <div className="input-group form-full">
                  <label className="input-label" htmlFor="linkedinUrl">
                    <span>LinkedIn Profile / URL {isStartupOrInnovator && <span className="input-req">*</span>}</span>
                  </label>
                  <input
                    id="linkedinUrl"
                    className="input-field"
                    type="text"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    required={isStartupOrInnovator}
                    placeholder="e.g. linkedin.com/in/username or https://www.linkedin.com/in/username"
                    value={linkedinUrl}
                    onChange={(e) => setLinkedinUrl(e.target.value)}
                    onBlur={() => {
                      if (linkedinUrl.trim()) {
                        setLinkedinUrl(normalizeLinkedInUrl(linkedinUrl));
                      }
                    }}
                  />
                  <span style={{ fontSize: "11px", color: "#64748b", marginTop: "3px" }}>
                    Universal format: accepts full URLs, username handles, or in/profiles.
                  </span>
                </div>
              </div>
            </div>

            {/* Sub-card C: Summit ID Badge Photograph */}
            <div className="form-section-card">
              <div className="subcard-head">
                <span className="subcard-badge subcard-badge-emerald">📸 ID Badge Accreditation</span>
                <span className="subcard-title">Summit Pass Photo Requirement</span>
              </div>

              <div className="photo-card-flex">
                <input
                  type="file"
                  accept="image/*"
                  ref={leadFileInputRef}
                  style={{ display: "none" }}
                  onChange={handleLeadPhotoChange}
                />
                <div
                  className="id-badge-frame"
                  onClick={() => leadFileInputRef.current?.click()}
                  title="Click to upload photograph"
                >
                  <div className="id-badge-lanyard-hole" />
                  {leadPhoto ? (
                    <img src={leadPhoto} alt="Photo Preview" className="photo-avatar-img" />
                  ) : (
                    <span className="photo-avatar-placeholder">📷</span>
                  )}
                </div>

                <div className="photo-upload-meta">
                  <div className={`photo-status-tag ${!leadPhoto ? "photo-status-tag-req" : ""}`}>
                    {leadPhoto ? "✓ Photo Attached & Ready" : "⚠️ Compulsory for Event Badge"}
                  </div>
                  <h4 className="photo-upload-title">
                    {isVolunteer ? "Volunteer Official Photograph" : "Team Lead Official Photograph"} <span className="input-req">*</span>
                  </h4>
                  <p className="photo-upload-sub">
                    {isVolunteer
                      ? "Upload a clear headshot / passport size photograph (JPG, PNG, WEBP). Compulsory for volunteer security badge & venue gate pass."
                      : "Upload a front-facing headshot (JPG, PNG, WEBP). Used for printing your summit badge, attendee directory & pitch profile."}
                  </p>
                  <div className="photo-btn-row">
                    <button
                      type="button"
                      className="btn-photo-pick"
                      onClick={() => leadFileInputRef.current?.click()}
                    >
                      {leadPhoto ? "Change Photo" : "Select Photo from Device"}
                    </button>
                    {leadPhoto && (
                      <button
                        type="button"
                        className="btn-photo-remove"
                        onClick={() => setLeadPhoto("")}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* STEP 3: Team Members Details (for Startup Leader & Student Innovator) */}
            {isStartupOrInnovator && (
              <>
                <div className="section-header-box">
                  <span className="section-title">
                    <span>👥</span> Step 3 · Team Members Accreditation (Max 5 Members)
                  </span>
                  <span className="section-tag">{members.length} / 5 Added · All Details Compulsory *</span>
                </div>

                <div className="members-container">
                  {members.map((member, index) => (
                    <div key={member.id} className="member-card">
                      <div className="member-card-header">
                        <span className="member-pill">Member #{index + 1} · Core Contributor</span>
                        {members.length > 1 && (
                          <button
                            type="button"
                            className="btn-remove-member"
                            onClick={() => handleRemoveMember(member.id)}
                          >
                            ✕ Remove
                          </button>
                        )}
                      </div>

                      <div className="member-body-flex">
                        {/* Member Photo Box */}
                        <div className="member-photo-col">
                          <label
                            className="member-avatar-box"
                            htmlFor={`member-photo-${member.id}`}
                            title="Click to upload member photo"
                          >
                            {member.photoUrl ? (
                              <img
                                src={member.photoUrl}
                                alt={member.name || `Member ${index + 1}`}
                                className="member-avatar-img"
                              />
                            ) : (
                              <span style={{ fontSize: 24, color: "#64748b" }}>📷</span>
                            )}
                          </label>
                          <input
                            id={`member-photo-${member.id}`}
                            type="file"
                            accept="image/*"
                            style={{ display: "none" }}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleMemberPhotoChange(member.id, file);
                            }}
                          />
                          <span style={{ fontSize: 11, color: member.photoUrl ? "#059669" : "#64748b", fontWeight: 700 }}>
                            {member.photoUrl ? "Photo Added ✓" : "Upload Photo *"}
                          </span>
                        </div>

                        {/* Member Inputs */}
                        <div className="member-inputs-grid">
                          <div className="input-group">
                            <label className="input-label">
                              <span>Full Name <span className="input-req">*</span></span>
                            </label>
                            <input
                              type="text"
                              required
                              className="input-field"
                              placeholder="e.g. Priya Sharma"
                              value={member.name}
                              onChange={(e) => handleMemberFieldChange(member.id, "name", e.target.value)}
                            />
                          </div>

                          <div className="input-group">
                            <label className="input-label">
                              <span>Phone Number <span className="input-req">*</span></span>
                            </label>
                            <input
                              type="tel"
                              required
                              className="input-field"
                              placeholder="+91 98765 00000"
                              value={member.phone}
                              onChange={(e) => handleMemberFieldChange(member.id, "phone", e.target.value)}
                              onBlur={() => {
                                if (member.phone.trim()) {
                                  const formatted = normalizeMobileNumber(member.phone);
                                  if (formatted) handleMemberFieldChange(member.id, "phone", formatted);
                                }
                              }}
                            />
                          </div>

                          <div className="input-group">
                            <label className="input-label">
                              <span>Email Address <span className="input-req">*</span></span>
                            </label>
                            <input
                              type="email"
                              required
                              className="input-field"
                              placeholder="priya@company.com"
                              value={member.email}
                              onChange={(e) => handleMemberFieldChange(member.id, "email", e.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  {members.length < 5 && (
                    <button
                      type="button"
                      className="btn-add-member"
                      onClick={handleAddMember}
                    >
                      <span>+ Add Another Team Member</span>
                      <span>({5 - members.length} spots remaining)</span>
                    </button>
                  )}
                </div>
              </>
            )}

            {/* Trust and Encryption Banner */}
            <div className="trust-banner">
              <span className="trust-icon">🛡️</span>
              <div>
                <p className="trust-title">Secure & Official Summit Accreditation</p>
                <p className="trust-sub">
                  Your credentials and data are encrypted and saved directly to the official ISF 2026 Summit database. Badges will be generated upon arrival at GIET University.
                </p>
              </div>
            </div>

            {error && (
              <div className="error-banner" role="alert" style={{ marginBottom: "16px" }}>
                <span style={{ fontSize: 20 }}>⚠️</span>
                <span>{error}</span>
              </div>
            )}

            <button type="submit" className="submit-btn" disabled={busy}>
              {busy ? "Registering & Generating Credentials…" : `Complete Registration as ${activeCategory.title} →`}
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
