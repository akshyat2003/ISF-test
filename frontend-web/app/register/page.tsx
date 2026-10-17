"use client";
import { useState, useRef, useMemo } from "react";
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
  gradient: string;
  accentBg: string;
  borderColor: string;
  tag: string;
  passType: string;
}

const CATEGORIES: CategoryMeta[] = [
  {
    id: "startup_founder",
    title: "Startup Leader",
    badge: "Startup Founders & Co-Founders",
    icon: "🚀",
    desc: "Founders & startups with market-ready products, MVPs, or high-growth ventures",
    teamLabel: "Startup / Company Name",
    themeColor: "#2563eb",
    gradient: "linear-gradient(135deg, #1e40af 0%, #2563eb 60%, #06b6d4 100%)",
    accentBg: "linear-gradient(135deg, rgba(37, 99, 235, 0.08) 0%, rgba(6, 182, 212, 0.04) 100%)",
    borderColor: "#3b82f6",
    tag: "₹1 Cr+ Pitch Stage · VC Speed Dating",
    passType: "FOUNDER · VIP ALL-ACCESS",
  },
  {
    id: "student_innovator",
    title: "Student Innovator",
    badge: "Student Innovators & College Labs",
    icon: "🎓",
    desc: "Undergraduates, researchers & college teams showcasing working tech prototypes",
    teamLabel: "Project / Team Name",
    themeColor: "#7c3aed",
    gradient: "linear-gradient(135deg, #5b21b6 0%, #7c3aed 60%, #c026d3 100%)",
    accentBg: "linear-gradient(135deg, rgba(124, 58, 237, 0.08) 0%, rgba(192, 38, 211, 0.04) 100%)",
    borderColor: "#8b5cf6",
    tag: "Prototype Arena · Student Grants",
    passType: "INNOVATOR · PROTOTYPE PASS",
  },
  {
    id: "volunteer",
    title: "Summit Volunteer",
    badge: "Campus & Youth Volunteers",
    icon: "🤝",
    desc: "Individual student volunteers for summit coordination, VIP relations & venue operations",
    teamLabel: "Institution / Organisation Name",
    themeColor: "#059669",
    gradient: "linear-gradient(135deg, #065f46 0%, #059669 60%, #0d9488 100%)",
    accentBg: "linear-gradient(135deg, rgba(5, 150, 105, 0.08) 0%, rgba(13, 148, 136, 0.04) 100%)",
    borderColor: "#10b981",
    tag: "Official Certificate · Backstage Pass",
    passType: "VOLUNTEER · ORGANIZING TEAM",
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

// Client-side image compressor
function compressImageFile(file: File, maxWidth = 420, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Please select a valid image file (JPG, PNG, WEBP)."));
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
      img.onerror = () => reject(new Error("Failed to process image."));
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

  // Team members
  const [members, setMembers] = useState<TeamMemberInput[]>([
    { id: "1", name: "", photoUrl: "", phone: "", email: "" },
  ]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFormError(msg: string) {
    setError(msg);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 120, behavior: "smooth" });
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

  // Real-time completion progress calculation
  const progressPercent = useMemo(() => {
    let score = 10;
    if (category) score += 10;
    if (teamName.trim()) score += 15;
    if (fullName.trim()) score += 15;
    if (email.trim() && email.includes("@")) score += 15;
    if (password.length >= 6) score += 10;
    if (mobile.trim()) score += 10;
    if (leadPhoto) score += 15;
    if (isVolunteer) {
      if (redgNo.trim() && rollNo.trim()) score += 10;
    } else {
      if (members.length > 0 && members[0].name.trim()) score += 10;
    }
    return Math.min(score, 100);
  }, [category, teamName, fullName, email, password, mobile, leadPhoto, isVolunteer, redgNo, rollNo, members]);

  // Password Strength Calculator
  const passwordStrength = useMemo(() => {
    if (!password) return { level: 0, label: "Enter password", color: "#94a3b8" };
    let points = 0;
    if (password.length >= 6) points += 1;
    if (password.length >= 8) points += 1;
    if (/[0-9]/.test(password)) points += 1;
    if (/[^A-Za-z0-9]/.test(password)) points += 1;
    if (points <= 1) return { level: 1, label: "Weak (add numbers/symbols)", color: "#ef4444" };
    if (points === 2) return { level: 2, label: "Fair (okay)", color: "#f59e0b" };
    if (points === 3) return { level: 3, label: "Good", color: "#2563eb" };
    return { level: 4, label: "Strong & Secure ✓", color: "#059669" };
  }, [password]);

  // Photo upload handler
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
      handleFormError("Please enter an account password of at least 6 characters.");
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
        handleFormError("Please upload your Volunteer Photograph for the summit badge.");
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
        handleFormError("Please enter a valid Primary Phone Number (e.g. 10-digit mobile number or +91 98765 43210).");
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
        window.scrollTo({ top: 60, behavior: "smooth" });
      }
    } catch (err: any) {
      console.error("[REGISTRATION FATAL]", err);
      handleFormError(err.message || "An unexpected network or server error occurred.");
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------- Confirmed State View
  if (registered) {
    return (
      <div className="registration-wrapper">
        <style jsx>{`
          .registration-wrapper {
            max-width: 760px;
            margin: 0 auto;
            padding: 24px 0 60px;
          }
          .success-card {
            background: #ffffff;
            border-radius: 28px;
            padding: 44px 36px;
            text-align: center;
            box-shadow: 0 20px 50px -10px rgba(15, 23, 42, 0.1), 0 0 0 1px #e2e8f0;
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
            width: 72px;
            height: 72px;
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: #ffffff;
            font-size: 34px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            margin: 0 auto 18px;
            box-shadow: 0 12px 28px -6px rgba(16, 185, 129, 0.4);
          }
          .lead-avatar-preview {
            width: 90px;
            height: 90px;
            border-radius: 20px;
            object-fit: cover;
            border: 3px solid #ffffff;
            box-shadow: 0 8px 24px rgba(15, 23, 42, 0.15);
            margin: 0 auto 16px;
            display: block;
          }
          .success-title {
            font-size: 30px;
            font-weight: 800;
            color: #0f172a;
            margin: 0 0 8px;
          }
          .success-sub {
            font-size: 15px;
            color: #64748b;
            margin: 0 0 24px;
            line-height: 1.5;
          }
          .email-banner {
            background: #eff6ff;
            border: 1px solid #bfdbfe;
            color: #1e40af;
            border-radius: 14px;
            padding: 12px 18px;
            font-size: 13.5px;
            margin-bottom: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
          }
          .info-box {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 18px;
            padding: 22px;
            margin-bottom: 28px;
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
          }
          .members-summary-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
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
            padding: 8px 10px;
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
            padding: 15px 24px;
            border-radius: 14px;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
            text-decoration: none;
            display: block;
            box-shadow: 0 10px 24px -5px rgba(37, 99, 235, 0.4);
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
          <h1 className="success-title">Summit Registration Confirmed!</h1>
          <p className="success-sub">
            Your {registered.category} credentials have been verified and saved to the official <strong>ISF @ Startup Jathara 2026</strong> summit registry.
          </p>

          <div className="email-banner">
            <span>✉️</span>
            <span>A confirmation notification has been sent to <strong>{registered.email}</strong>.</span>
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
              <span className="info-label">{isVolunteer ? "Volunteer Name:" : "Team Lead Name:"}</span>
              <span className="info-val">{registered.fullName}</span>
            </div>
            {registered.redgNo && (
              <div className="info-row">
                <span className="info-label">Registration No:</span>
                <span className="info-val">{registered.redgNo}</span>
              </div>
            )}
            {registered.rollNo && (
              <div className="info-row">
                <span className="info-label">Roll Number:</span>
                <span className="info-val">{registered.rollNo}</span>
              </div>
            )}
            {isStartupOrInnovator && domain && (
              <div className="info-row">
                <span className="info-label">Innovation Domain:</span>
                <span className="info-val">{domain}</span>
              </div>
            )}
            <div className="info-row">
              <span className="info-label">Registered Track:</span>
              <span className="info-val" style={{ color: activeCategory.themeColor }}>{registered.category}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Summit Pass Status:</span>
              <span className="info-val" style={{ color: "#059669" }}>Active · Accreditation Confirmed</span>
            </div>

            {registered.members.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <span className="info-label" style={{ fontWeight: 700, color: "#1e293b", display: "block", marginBottom: 6 }}>
                  Accredited Team Members ({registered.members.length} / 5):
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
                              style={{ width: 30, height: 30, borderRadius: 6, objectFit: "cover" }}
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
              View Application & Summit Dashboard →
            </Link>
            <Link href="/signin" className="btn-secondary">
              Sign In to Your Account
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- Interactive Main Registration Form
  return (
    <div className="registration-wrapper">
      <style jsx>{`
        .registration-wrapper {
          width: 100%;
          max-width: 960px;
          margin: 0 auto;
          padding: 8px 0 60px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }

        /* Hero Header */
        .portal-hero {
          text-align: center;
          margin-bottom: 24px;
        }
        .portal-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          padding: 6px 16px;
          border-radius: 9999px;
          font-size: 12.5px;
          font-weight: 700;
          color: #1e3a8a;
          margin-bottom: 12px;
          box-shadow: 0 4px 12px rgba(30, 58, 138, 0.05);
        }
        .portal-title {
          font-size: clamp(26px, 4vw, 36px);
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 10px;
          letter-spacing: -0.025em;
          line-height: 1.2;
        }
        .title-gradient {
          background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 50%, #7c3aed 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .portal-sub {
          font-size: 14.5px;
          color: #64748b;
          max-width: 660px;
          margin: 0 auto 20px;
          line-height: 1.55;
        }

        /* 3 Quick Colourful Highlight Cards */
        .summit-stats-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          margin-bottom: 22px;
        }
        .stat-card {
          background: #ffffff;
          border-radius: 14px;
          padding: 12px 14px;
          border: 1px solid #e2e8f0;
          box-shadow: 0 4px 12px -2px rgba(15, 23, 42, 0.04);
          display: flex;
          align-items: center;
          gap: 12px;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .stat-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 18px -4px rgba(15, 23, 42, 0.08);
        }
        .stat-blue {
          border-top: 3px solid #2563eb;
          background: linear-gradient(180deg, rgba(37, 99, 235, 0.04) 0%, #ffffff 40%);
        }
        .stat-purple {
          border-top: 3px solid #7c3aed;
          background: linear-gradient(180deg, rgba(124, 58, 237, 0.04) 0%, #ffffff 40%);
        }
        .stat-emerald {
          border-top: 3px solid #059669;
          background: linear-gradient(180deg, rgba(5, 150, 105, 0.04) 0%, #ffffff 40%);
        }
        .stat-emoji {
          font-size: 22px;
          flex-shrink: 0;
        }
        .stat-head {
          font-size: 13px;
          font-weight: 700;
          color: #0f172a;
          margin: 0;
        }
        .stat-subtext {
          font-size: 11px;
          color: #64748b;
          margin: 2px 0 0;
        }

        /* Main Portal Card */
        .portal-card {
          background: #ffffff;
          border-radius: 24px;
          padding: 34px 32px;
          border: 1px solid #e2e8f0;
          box-shadow: 0 20px 45px -10px rgba(15, 23, 42, 0.07);
        }

        /* Live Progress Tracker */
        .progress-bar-wrap {
          margin-bottom: 26px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          padding: 12px 18px;
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .progress-meta {
          flex: 1;
        }
        .progress-title-row {
          display: flex;
          justify-content: space-between;
          font-size: 12.5px;
          font-weight: 700;
          color: #1e3a8a;
          margin-bottom: 6px;
        }
        .progress-track {
          width: 100%;
          height: 8px;
          background: #e2e8f0;
          border-radius: 999px;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #2563eb, #7c3aed, #059669);
          transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .progress-tag {
          font-size: 12px;
          font-weight: 800;
          color: #2563eb;
          background: #eff6ff;
          padding: 4px 10px;
          border-radius: 8px;
          border: 1px solid #bfdbfe;
        }

        /* Section Headings */
        .section-header-box {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin: 28px 0 16px;
          padding-bottom: 10px;
          border-bottom: 1.5px solid #f1f5f9;
        }
        .section-header-box:first-of-type {
          margin-top: 0;
        }
        .section-title {
          font-size: 15px;
          font-weight: 800;
          color: #0f172a;
          display: flex;
          align-items: center;
          gap: 8px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .section-tag {
          font-size: 11.5px;
          font-weight: 600;
          color: #64748b;
          background: #f8fafc;
          padding: 3px 9px;
          border-radius: 6px;
          border: 1px solid #e2e8f0;
        }

        /* STEP 1: Categories Cards */
        .categories-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 14px;
          margin-bottom: 20px;
        }
        .category-card {
          background: #ffffff;
          border: 2px solid #e2e8f0;
          border-radius: 18px;
          padding: 18px 16px;
          cursor: pointer;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          text-align: left;
          position: relative;
        }
        .category-card:hover {
          border-color: #94a3b8;
          transform: translateY(-2px);
          box-shadow: 0 10px 24px -6px rgba(15, 23, 42, 0.08);
        }
        .category-card.active {
          border-color: var(--active-border);
          background: var(--active-bg);
          box-shadow: 0 12px 28px -6px var(--active-glow);
          transform: translateY(-2px);
        }
        .cat-card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }
        .cat-icon-bubble {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          box-shadow: 0 2px 8px rgba(15, 23, 42, 0.05);
        }
        .cat-check-badge {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          border: 2px solid #cbd5e1;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 800;
          color: transparent;
          transition: all 0.2s;
        }
        .category-card.active .cat-check-badge {
          background: var(--active-border);
          border-color: var(--active-border);
          color: #ffffff;
        }
        .cat-card-title {
          font-size: 16px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 6px;
        }
        .cat-card-desc {
          font-size: 12px;
          color: #64748b;
          line-height: 1.45;
          margin: 0 0 12px;
        }
        .cat-card-pill {
          font-size: 11px;
          font-weight: 700;
          padding: 4px 10px;
          border-radius: 8px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          color: #475569;
          display: inline-block;
          margin-top: auto;
        }
        .category-card.active .cat-card-pill {
          border-color: var(--active-border);
          color: var(--active-border);
          font-weight: 800;
        }

        /* Dynamic Perks Showcase (3 colourful boxes) */
        .perks-strip {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          margin-bottom: 28px;
          padding: 14px;
          border-radius: 16px;
          background: #f8fafc;
          border: 1.5px dashed #cbd5e1;
        }
        .perk-box {
          background: #ffffff;
          border-radius: 12px;
          padding: 12px 14px;
          border: 1px solid #e2e8f0;
          display: flex;
          gap: 10px;
          align-items: flex-start;
          box-shadow: 0 2px 6px rgba(15, 23, 42, 0.03);
        }
        .perk-icon-circle {
          width: 34px;
          height: 34px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          flex-shrink: 0;
        }
        .perk-info h4 {
          margin: 0 0 2px;
          font-size: 12.5px;
          font-weight: 700;
          color: #0f172a;
        }
        .perk-info p {
          margin: 0;
          font-size: 11px;
          color: #64748b;
          line-height: 1.4;
        }

        /* Two Column Layout for Profile & Live Badge Mockup */
        .profile-and-badge-grid {
          display: grid;
          grid-template-columns: 1fr 280px;
          gap: 22px;
          align-items: start;
        }

        /* Live Badge Mockup Card */
        .live-badge-card {
          background: linear-gradient(145deg, #ffffff 0%, #f8fafc 100%);
          border: 2px solid #cbd5e1;
          border-radius: 20px;
          padding: 18px 16px;
          box-shadow: 0 10px 25px rgba(15, 23, 42, 0.08);
          text-align: center;
          position: sticky;
          top: 80px;
        }
        .badge-hanger {
          width: 44px;
          height: 8px;
          background: #94a3b8;
          border-radius: 4px;
          margin: 0 auto 12px;
        }
        .badge-brand-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 800;
          color: #1e3a8a;
          letter-spacing: 0.05em;
          margin-bottom: 12px;
        }
        .badge-photo-slot {
          width: 90px;
          height: 96px;
          border-radius: 14px;
          background: #f1f5f9;
          border: 2px dashed #94a3b8;
          margin: 0 auto 12px;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
        }
        .badge-photo-slot:hover {
          border-color: #2563eb;
          transform: scale(1.02);
        }
        .badge-avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .badge-user-name {
          font-size: 15px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 2px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .badge-team-name {
          font-size: 11.5px;
          color: #64748b;
          margin: 0 0 10px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .badge-pass-tag {
          font-size: 10.5px;
          font-weight: 800;
          padding: 5px 10px;
          border-radius: 6px;
          color: #ffffff;
          background: var(--badge-bg);
          margin-bottom: 12px;
          letter-spacing: 0.03em;
        }
        .badge-barcode-line {
          font-family: monospace;
          font-size: 12px;
          color: #94a3b8;
          letter-spacing: 3px;
          border-top: 1px dashed #cbd5e1;
          padding-top: 8px;
        }

        /* Form Sub-cards */
        .form-section-card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 18px;
          padding: 22px;
          margin-bottom: 20px;
          box-shadow: 0 2px 10px rgba(15, 23, 42, 0.02);
        }
        .subcard-head {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 16px;
        }
        .subcard-badge {
          font-size: 12px;
          font-weight: 700;
          padding: 4px 10px;
          border-radius: 9999px;
          display: inline-block;
        }
        .badge-blue {
          background: #eff6ff;
          color: #1e40af;
          border: 1px solid #bfdbfe;
        }
        .badge-purple {
          background: #f5f3ff;
          color: #5b21b6;
          border: 1px solid #ddd6fe;
        }
        .badge-emerald {
          background: #ecfdf5;
          color: #065f46;
          border: 1px solid #a7f3d0;
        }
        .subcard-title {
          font-size: 13.5px;
          font-weight: 700;
          color: #334155;
        }

        /* Inputs with Icons */
        .form-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 14px;
        }
        .form-full {
          grid-column: 1 / -1;
        }
        .input-group {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .input-label {
          font-size: 12.5px;
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
        .input-with-icon {
          position: relative;
          display: flex;
          align-items: center;
        }
        .field-icon {
          position: absolute;
          left: 12px;
          font-size: 15px;
          color: #94a3b8;
          pointer-events: none;
        }
        .input-field {
          width: 100%;
          padding: 10px 12px 10px 38px;
          border-radius: 10px;
          border: 1.5px solid #cbd5e1;
          font-size: 13.5px;
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
        .password-toggle {
          position: absolute;
          right: 12px;
          background: none;
          border: none;
          color: #64748b;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
        }

        /* Password Strength Meter */
        .password-meter-wrap {
          margin-top: 4px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .meter-bars {
          display: flex;
          gap: 4px;
          flex: 1;
        }
        .meter-bar {
          height: 4px;
          border-radius: 2px;
          flex: 1;
          background: #e2e8f0;
          transition: background 0.3s;
        }
        .meter-label {
          font-size: 11px;
          font-weight: 700;
        }

        /* Team Members Cards (Step 3) */
        .members-container {
          display: flex;
          flex-direction: column;
          gap: 14px;
          margin-bottom: 22px;
        }
        .member-card {
          background: #ffffff;
          border: 1.5px solid #e2e8f0;
          border-radius: 16px;
          padding: 18px;
          transition: all 0.2s ease;
          box-shadow: 0 2px 8px rgba(15, 23, 42, 0.02);
        }
        .member-card:hover {
          border-color: #cbd5e1;
          box-shadow: 0 6px 16px rgba(15, 23, 42, 0.05);
        }
        .member-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 14px;
        }
        .member-pill {
          background: #f5f3ff;
          color: #6d28d9;
          font-size: 11.5px;
          font-weight: 700;
          padding: 3px 10px;
          border-radius: 6px;
          border: 1px solid #ddd6fe;
        }
        .btn-remove-member {
          background: #fee2e2;
          border: 1px solid #fecaca;
          color: #b91c1c;
          font-size: 11.5px;
          font-weight: 600;
          padding: 3px 8px;
          border-radius: 6px;
          cursor: pointer;
        }
        .member-body-flex {
          display: flex;
          gap: 16px;
          align-items: flex-start;
        }
        .member-photo-col {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          width: 80px;
          flex-shrink: 0;
        }
        .member-avatar-box {
          width: 70px;
          height: 70px;
          border-radius: 12px;
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
        .member-inputs-grid {
          flex: 1;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 12px;
        }
        .btn-add-member {
          background: #ffffff;
          border: 2px dashed #7c3aed;
          color: #7c3aed;
          padding: 12px 20px;
          border-radius: 12px;
          font-size: 13.5px;
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

        /* Trust Banner */
        .trust-banner {
          background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%);
          border: 1px solid #bbf7d0;
          border-radius: 14px;
          padding: 12px 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 16px 0 20px;
        }
        .trust-icon {
          font-size: 18px;
          flex-shrink: 0;
        }
        .trust-title {
          font-size: 12.5px;
          font-weight: 700;
          color: #14532d;
          margin: 0;
        }
        .trust-sub {
          font-size: 11px;
          color: #15803d;
          margin: 2px 0 0;
        }

        /* Error Banner */
        .error-banner {
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #dc2626;
          border-radius: 12px;
          padding: 12px 16px;
          font-size: 13.5px;
          font-weight: 600;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        /* Submit Button */
        .submit-btn {
          width: 100%;
          background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 50%, #1d4ed8 100%);
          color: #ffffff;
          border: none;
          padding: 16px 28px;
          border-radius: 14px;
          font-size: 16px;
          font-weight: 800;
          cursor: pointer;
          transition: all 0.25s ease;
          box-shadow: 0 10px 25px -5px rgba(37, 99, 235, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }
        .submit-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 14px 30px -4px rgba(37, 99, 235, 0.5);
        }
        .submit-btn:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }
        .footer-links {
          margin-top: 22px;
          text-align: center;
          font-size: 13.5px;
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

        @media (max-width: 820px) {
          .profile-and-badge-grid {
            grid-template-columns: 1fr;
          }
          .live-badge-card {
            position: static;
            max-width: 300px;
            margin: 0 auto 20px;
          }
          .categories-grid, .summit-stats-grid, .perks-strip {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      {/* Hero Header */}
      <div className="portal-hero">
        <div className="portal-eyebrow">
          <img src="/logos/udbhav.png" alt="ISF Logo" style={{ width: 18, height: 18, objectFit: "contain" }} />
          <span>ISF · Startup Jathara 2026 · Dandakaranya</span>
        </div>
        <h1 className="portal-title">
          Summit Registration <span className="title-gradient">Portal</span>
        </h1>
        <p className="portal-sub">
          Official accreditation portal for innovators, founders & volunteers (18–20 December 2026, GIET University Campus, Odisha).
        </p>

        {/* 3 Quick Colourful Highlight Cards */}
        <div className="summit-stats-grid">
          <div className="stat-card stat-blue">
            <span className="stat-emoji">📍</span>
            <div>
              <p className="stat-head">GIET University Campus</p>
              <p className="stat-subtext">Gunupur, Rayagada, Odisha</p>
            </div>
          </div>
          <div className="stat-card stat-purple">
            <span className="stat-emoji">📅</span>
            <div>
              <p className="stat-head">18–20 December 2026</p>
              <p className="stat-subtext">3 Days · Keynotes & Pitching</p>
            </div>
          </div>
          <div className="stat-card stat-emerald">
            <span className="stat-emoji">🏆</span>
            <div>
              <p className="stat-head">₹1 Crore+ Pitch Grants</p>
              <p className="stat-subtext">Seed Grants & Prototype Fund</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Registration Portal Card */}
      <div className="portal-card">
        {/* Real-time Progress Bar */}
        <div className="progress-bar-wrap">
          <div className="progress-meta">
            <div className="progress-title-row">
              <span>REGISTRATION COMPLETION</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
          <span className="progress-tag">
            {progressPercent >= 100 ? "Ready to Submit ✓" : `${100 - progressPercent}% Remaining`}
          </span>
        </div>

        {error && (
          <div className="error-banner" role="alert">
            <span style={{ fontSize: 18 }}>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* STEP 1: Track Selection */}
          <div className="section-header-box">
            <span className="section-title">
              <span>🎯</span> Step 1 · Choose Your Track
            </span>
            <span className="section-tag">Role Selection</span>
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
                    <p>Compete for equity-free grants and venture incubation fast-track.</p>
                  </div>
                </div>
                <div className="perk-box">
                  <div className="perk-icon-circle" style={{ background: "#f5f3ff", color: "#7c3aed" }}>🤝</div>
                  <div className="perk-info">
                    <h4>1-on-1 VC Speed Dating</h4>
                    <p>Private pitch slots with 40+ leading institutional angel funds.</p>
                  </div>
                </div>
                <div className="perk-box">
                  <div className="perk-icon-circle" style={{ background: "#ecfdf5", color: "#059669" }}>🎪</div>
                  <div className="perk-info">
                    <h4>Exhibition Booth & VIP Pass</h4>
                    <p>Dedicated demo table in Startup Expo + access to founder galas.</p>
                  </div>
                </div>
              </>
            )}

            {isStudentInnovator && (
              <>
                <div className="perk-box">
                  <div className="perk-icon-circle" style={{ background: "#f5f3ff", color: "#7c3aed" }}>🔬</div>
                  <div className="perk-info">
                    <h4>Prototype Demo Desk</h4>
                    <p>Showcase working hardware/software prototypes to top juries.</p>
                  </div>
                </div>
                <div className="perk-box">
                  <div className="perk-icon-circle" style={{ background: "#eff6ff", color: "#2563eb" }}>💡</div>
                  <div className="perk-info">
                    <h4>Student Idea Grants</h4>
                    <p>Eligible for prototype improvement grants and fab lab access.</p>
                  </div>
                </div>
                <div className="perk-box">
                  <div className="perk-icon-circle" style={{ background: "#fffbeb", color: "#d97706" }}>⚡</div>
                  <div className="perk-info">
                    <h4>Founder Mentorship Track</h4>
                    <p>Sprint masterclasses with serial tech founders and venture builders.</p>
                  </div>
                </div>
              </>
            )}

            {isVolunteer && (
              <>
                <div className="perk-box">
                  <div className="perk-icon-circle" style={{ background: "#ecfdf5", color: "#059669" }}>🏅</div>
                  <div className="perk-info">
                    <h4>Leadership Certificate</h4>
                    <p>Official commendation issued jointly by GIET University & ISF.</p>
                  </div>
                </div>
                <div className="perk-box">
                  <div className="perk-icon-circle" style={{ background: "#eff6ff", color: "#2563eb" }}>🎟️</div>
                  <div className="perk-info">
                    <h4>All-Access Pass (3 Days)</h4>
                    <p>Access to keynote speaker sessions, fireside chats & events.</p>
                  </div>
                </div>
                <div className="perk-box">
                  <div className="perk-icon-circle" style={{ background: "#fffbeb", color: "#d97706" }}>🎒</div>
                  <div className="perk-info">
                    <h4>Summit Kit & Meals</h4>
                    <p>Volunteer kit, branded t-shirt, custom lanyard pass & meals.</p>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* STEP 2: Profile Details + Live Badge Mockup */}
          <div className="section-header-box">
            <span className="section-title">
              <span>📝</span> Step 2 · {isVolunteer ? "Volunteer Profile Details" : isStudentInnovator ? "Project & Team Lead Credentials" : "Lead Founder & Venture Credentials"}
            </span>
            <span className="section-tag">Required Credentials</span>
          </div>

          <div className="profile-and-badge-grid">
            {/* Left Inputs Column */}
            <div className="form-left-col">
              {/* Sub-card: Organization & Identity */}
              <div className="form-section-card">
                <div className="subcard-head">
                  <span className="subcard-badge badge-blue">🏢 Organization & Identity</span>
                  <span className="subcard-title">Institutional details</span>
                </div>

                <div className="form-grid">
                  <div className="input-group">
                    <label className="input-label" htmlFor="teamName">
                      <span>{isVolunteer ? "Organisation Name" : activeCategory.teamLabel} <span className="input-req">*</span></span>
                    </label>
                    <div className="input-with-icon">
                      <span className="field-icon">🏢</span>
                      <input
                        id="teamName"
                        className="input-field"
                        type="text"
                        required
                        placeholder={
                          isVolunteer
                            ? "e.g. GIET University"
                            : isStartupLeader
                            ? "e.g. AgriSmart Robotics Pvt Ltd"
                            : "e.g. GIET AI Innovation Lab"
                        }
                        value={teamName}
                        onChange={(e) => setTeamName(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="input-group">
                    <label className="input-label" htmlFor="fullName">
                      <span>{isVolunteer ? "Volunteer Full Name" : "Team Lead Full Name"} <span className="input-req">*</span></span>
                    </label>
                    <div className="input-with-icon">
                      <span className="field-icon">👤</span>
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
                  </div>

                  {isVolunteer && (
                    <>
                      <div className="input-group">
                        <label className="input-label" htmlFor="redgNo">
                          <span>Registration No (Redg No) <span className="input-req">*</span></span>
                        </label>
                        <div className="input-with-icon">
                          <span className="field-icon">🆔</span>
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
                      </div>

                      <div className="input-group">
                        <label className="input-label" htmlFor="rollNo">
                          <span>Roll Number / Student ID <span className="input-req">*</span></span>
                        </label>
                        <div className="input-with-icon">
                          <span className="field-icon">🎓</span>
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
                      </div>
                    </>
                  )}

                  {!isVolunteer && (
                    <div className="input-group">
                      <label className="input-label" htmlFor="domain">
                        <span>Domain / Sector <span className="input-req">*</span></span>
                      </label>
                      <div className="input-with-icon">
                        <span className="field-icon">🏷️</span>
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
                    </div>
                  )}
                </div>
              </div>

              {/* Sub-card: Contact & Security Credentials */}
              <div className="form-section-card">
                <div className="subcard-head">
                  <span className="subcard-badge badge-purple">🔐 Contact & Authentication</span>
                  <span className="subcard-title">Account login credentials</span>
                </div>

                <div className="form-grid">
                  <div className="input-group">
                    <label className="input-label" htmlFor="email">
                      <span>Official Email Address <span className="input-req">*</span></span>
                    </label>
                    <div className="input-with-icon">
                      <span className="field-icon">✉️</span>
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
                  </div>

                  <div className="input-group">
                    <label className="input-label" htmlFor="password">
                      <span>Create Account Password <span className="input-req">*</span></span>
                    </label>
                    <div className="input-with-icon">
                      <span className="field-icon">🔒</span>
                      <input
                        id="password"
                        className="input-field"
                        type={showPassword ? "text" : "password"}
                        required
                        placeholder="Min 6 chars"
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

                    {/* Interactive Password Strength Meter */}
                    {password && (
                      <div className="password-meter-wrap">
                        <div className="meter-bars">
                          {[1, 2, 3, 4].map((i) => (
                            <div
                              key={i}
                              className="meter-bar"
                              style={{
                                background: i <= passwordStrength.level ? passwordStrength.color : "#e2e8f0",
                              }}
                            />
                          ))}
                        </div>
                        <span className="meter-label" style={{ color: passwordStrength.color }}>
                          {passwordStrength.label}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="input-group">
                    <label className="input-label" htmlFor="mobile">
                      <span>Primary Phone (WhatsApp) <span className="input-req">*</span></span>
                    </label>
                    <div className="input-with-icon">
                      <span className="field-icon">📱</span>
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
                    </div>
                    <span style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                      Formats automatically to E.164 (+91 98765 43210)
                    </span>
                  </div>

                  <div className="input-group">
                    <label className="input-label" htmlFor="altMobile">
                      <span>Alternate Phone Number <span className="input-req">*</span></span>
                    </label>
                    <div className="input-with-icon">
                      <span className="field-icon">📞</span>
                      <input
                        id="altMobile"
                        className="input-field"
                        type="tel"
                        required
                        placeholder="Secondary / Emergency"
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
                  </div>

                  <div className="input-group">
                    <label className="input-label" htmlFor="city">
                      <span>City <span className="input-req">*</span></span>
                    </label>
                    <div className="input-with-icon">
                      <span className="field-icon">📍</span>
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
                  </div>

                  <div className="input-group">
                    <label className="input-label" htmlFor="state">
                      <span>State <span className="input-req">*</span></span>
                    </label>
                    <div className="input-with-icon">
                      <span className="field-icon">🗺️</span>
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
                  </div>

                  <div className="input-group">
                    <label className="input-label" htmlFor="country">
                      <span>Country <span className="input-req">*</span></span>
                    </label>
                    <div className="input-with-icon">
                      <span className="field-icon">🌍</span>
                      <input
                        id="country"
                        className="input-field"
                        type="text"
                        required
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="input-group form-full">
                    <label className="input-label" htmlFor="linkedinUrl">
                      <span>LinkedIn Profile / URL {isStartupOrInnovator && <span className="input-req">*</span>}</span>
                    </label>
                    <div className="input-with-icon">
                      <span className="field-icon">🔗</span>
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
                    </div>
                    <span style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                      Accepts LinkedIn handle, in/username, or full profile URL
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Live Conference Badge Mockup */}
            <div className="badge-preview-column">
              <div
                className="live-badge-card"
                style={{ "--badge-bg": activeCategory.themeColor } as React.CSSProperties}
              >
                <div className="badge-hanger" />
                <div className="badge-brand-row">
                  <img src="/logos/udbhav.png" alt="ISF Logo" style={{ width: 16, height: 16, objectFit: "contain" }} />
                  <span>STARTUP JATHARA 2026</span>
                </div>

                <input
                  type="file"
                  accept="image/*"
                  ref={leadFileInputRef}
                  style={{ display: "none" }}
                  onChange={handleLeadPhotoChange}
                />

                <div
                  className="badge-photo-slot"
                  onClick={() => leadFileInputRef.current?.click()}
                  title="Click to upload photograph for summit badge"
                >
                  {leadPhoto ? (
                    <img src={leadPhoto} alt="Attendee" className="badge-avatar-img" />
                  ) : (
                    <div style={{ textAlign: "center", padding: 8 }}>
                      <span style={{ fontSize: 24 }}>📷</span>
                      <span style={{ fontSize: 10, display: "block", color: "#64748b", marginTop: 4, fontWeight: 700 }}>
                        Click to Upload Photo *
                      </span>
                    </div>
                  )}
                </div>

                <div className="badge-user-name">
                  {fullName.trim() || "Attendee Full Name"}
                </div>
                <div className="badge-team-name">
                  {teamName.trim() || "Startup / Institution"}
                </div>
                <div className="badge-pass-tag">
                  {activeCategory.passType}
                </div>

                <button
                  type="button"
                  style={{
                    background: leadPhoto ? "#f1f5f9" : activeCategory.themeColor,
                    color: leadPhoto ? "#334155" : "#ffffff",
                    border: "1px solid #cbd5e1",
                    padding: "6px 12px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    width: "100%",
                    marginBottom: 10,
                  }}
                  onClick={() => leadFileInputRef.current?.click()}
                >
                  {leadPhoto ? "Change Photograph" : "Upload Badge Photo *"}
                </button>

                <div className="badge-barcode-line">
                  ||| | |||| | |||||| || | |||
                </div>
                <span style={{ fontSize: 10, color: "#94a3b8", display: "block", marginTop: 4 }}>
                  18–20 DEC 2026 · GIET UNIVERSITY
                </span>
              </div>
            </div>
          </div>

          {/* STEP 3: Team Members Details (for Startup Leader & Student Innovator) */}
          {isStartupOrInnovator && (
            <>
              <div className="section-header-box" style={{ marginTop: 28 }}>
                <span className="section-title">
                  <span>👥</span> Step 3 · Team Members Accreditation (Max 5 Members)
                </span>
                <span className="section-tag">{members.length} / 5 Added · Compulsory *</span>
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
                              style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            />
                          ) : (
                            <span style={{ fontSize: 22, color: "#94a3b8" }}>📷</span>
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
                        <span style={{ fontSize: 10.5, color: member.photoUrl ? "#059669" : "#64748b", fontWeight: 700 }}>
                          {member.photoUrl ? "Photo ✓" : "Upload *"}
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
                            style={{ paddingLeft: 12 }}
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
                            style={{ paddingLeft: 12 }}
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
                            style={{ paddingLeft: 12 }}
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

          {/* Security & Official Accreditation Guarantee */}
          <div className="trust-banner">
            <span className="trust-icon">🛡️</span>
            <div>
              <p className="trust-title">Secure Summit Accreditation Guarantee</p>
              <p className="trust-sub">
                Your credentials and attendee profiles are encrypted and committed directly to the official ISF 2026 Summit database. Badges will be generated upon security check-in at GIET University.
              </p>
            </div>
          </div>

          {error && (
            <div className="error-banner" role="alert" style={{ marginBottom: "16px" }}>
              <span style={{ fontSize: 18 }}>⚠️</span>
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
  );
}
