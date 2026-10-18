"use client";
import { useState, useRef, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/session";

type CategoryId =
  | "startup_founder"
  | "student_innovator"
  | "volunteer";

interface CategoryMeta {
  id: CategoryId;
  title: string;
  badge: string;
  icon: string;
  trackCode: string;
  desc: string;
  teamLabel: string;
  themeColor: string;
  gradient: string;
  accentBg: string;
  borderColor: string;
  tag: string;
  passType: string;
  perks: Array<{ icon: string; title: string; desc: string }>;
}

const CATEGORIES: CategoryMeta[] = [
  {
    id: "startup_founder",
    title: "Startup Leader",
    badge: "Startup Founders & Co-Founders",
    icon: "🚀",
    trackCode: "Track 01",
    desc: "Founders & startups with market-ready products, MVPs, or high-growth ventures seeking seed funding, angel roundtables & GCC connects.",
    teamLabel: "Startup / Company Name",
    themeColor: "#e87042",
    gradient: "linear-gradient(135deg, #c25022 0%, #e87042 50%, #d68c45 100%)",
    accentBg: "linear-gradient(135deg, rgba(232, 112, 66, 0.08) 0%, rgba(214, 140, 69, 0.04) 100%)",
    borderColor: "#e87042",
    tag: "₹1 Cr+ Pitch Stage · VC Speed Dating",
    passType: "FOUNDER · VIP ALL-ACCESS",
    perks: [
      {
        icon: "💼",
        title: "₹1 Cr+ Pitch & Seed Arena",
        desc: "Compete for equity-free grants and venture incubation fast-track.",
      },
      {
        icon: "🤝",
        title: "1-on-1 VC Speed Dating",
        desc: "Private pitch slots with 50+ tier-1 institutional & angel funds.",
      },
      {
        icon: "🎪",
        title: "Exhibition Demo Kiosk & VIP Pass",
        desc: "Dedicated demo table in Startup Expo + access to founder networking dinners.",
      },
    ],
  },
  {
    id: "student_innovator",
    title: "Student Innovator",
    badge: "Student Innovators & College Labs",
    icon: "🎓",
    trackCode: "Track 02",
    desc: "Undergraduates, researchers & college teams showcasing working hardware/software tech prototypes, robotics, or scientific innovations.",
    teamLabel: "Project / Team Name",
    themeColor: "#143e30",
    gradient: "linear-gradient(135deg, #0d281e 0%, #143e30 50%, #256f57 100%)",
    accentBg: "linear-gradient(135deg, rgba(20, 62, 48, 0.08) 0%, rgba(37, 111, 87, 0.04) 100%)",
    borderColor: "#1b5341",
    tag: "Prototype Arena · Student Idea Grants",
    passType: "INNOVATOR · PROTOTYPE PASS",
    perks: [
      {
        icon: "🔬",
        title: "Prototype Demo Desk",
        desc: "Showcase working hardware & software prototypes to premier juries.",
      },
      {
        icon: "💡",
        title: "Student Idea Grants",
        desc: "Eligible for prototype improvement grants, patent advice & fab lab access.",
      },
      {
        icon: "⚡",
        title: "Founder Mentorship Track",
        desc: "Masterclasses with serial tech founders, unicorn builders & industry chiefs.",
      },
    ],
  },
  {
    id: "volunteer",
    title: "Summit Volunteer",
    badge: "Campus & Youth Volunteers",
    icon: "🤝",
    trackCode: "Track 03",
    desc: "Individual student leaders & youth volunteers for summit coordination, VIP relations, venue operations & logistics management.",
    teamLabel: "Institution / Organisation Name",
    themeColor: "#be9740",
    gradient: "linear-gradient(135deg, #8c671b 0%, #be9740 50%, #d6b25e 100%)",
    accentBg: "linear-gradient(135deg, rgba(190, 151, 64, 0.08) 0%, rgba(214, 178, 94, 0.04) 100%)",
    borderColor: "#be9740",
    tag: "Official Certificate · Backstage Pass",
    passType: "VOLUNTEER · ORGANIZING TEAM",
    perks: [
      {
        icon: "🏅",
        title: "Official Leadership Certificate",
        desc: "Official commendation issued jointly by GIET University & ISF Network.",
      },
      {
        icon: "🎟️",
        title: "All-Access 3-Day Summit Pass",
        desc: "Full access to grand keynote arenas, investor panels & fireside sessions.",
      },
      {
        icon: "🎒",
        title: "Summit Delegate Kit & Meals",
        desc: "Official volunteer kit, branded t-shirt, custom lanyard badge & catered meals.",
      },
    ],
  },
];

// Exact 8 Focus Sectors from https://jathara.netlify.app
const FOCUS_SECTORS = [
  "Agritech & Food Safety",
  "AI & Quantum Technology",
  "CleanTech & Renewable Energy",
  "HealthTech & BioSciences",
  "DeepTech & Semiconductor",
  "FinTech & Digital Commerce",
  "Defense & Smart Surveillance",
  "Social Impact & Tribal Tech",
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
function compressImageFile(file: File, maxWidth = 460, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Please select a valid image file (JPG, PNG, WEBP)."));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
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
  const [domain, setDomain] = useState("AI & Quantum Technology");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [country, setCountry] = useState("India");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [redgNo, setRedgNo] = useState("");
  const [rollNo, setRollNo] = useState("");

  // Team members (1 to 5 members)
  const [members, setMembers] = useState<TeamMemberInput[]>([
    { id: "1", name: "", photoUrl: "", phone: "", email: "" },
  ]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFormError(msg: string) {
    setError(msg);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 400, behavior: "smooth" });
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
    domain?: string;
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

  // Password Strength Calculator using Jathara palette
  const passwordStrength = useMemo(() => {
    if (!password) return { level: 0, label: "Enter password (min 6 chars)", color: "#78716c" };
    let points = 0;
    if (password.length >= 6) points += 1;
    if (password.length >= 8) points += 1;
    if (/[0-9]/.test(password)) points += 1;
    if (/[^A-Za-z0-9]/.test(password)) points += 1;
    if (points <= 1) return { level: 1, label: "Weak (add numbers/symbols)", color: "#c25022" };
    if (points === 2) return { level: 2, label: "Fair (acceptable)", color: "#d6b25e" };
    if (points === 3) return { level: 3, label: "Good security", color: "#256f57" };
    return { level: 4, label: "Strong & Accredited ✓", color: "#143e30" };
  }, [password]);

  // Lead photo upload handler
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
      setError("Maximum 5 team members are allowed per delegate team.");
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
        handleFormError("Please upload the Team Lead Photograph for summit pass accreditation.");
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
        handleFormError("Please select a Focus Sector / Innovation Domain.");
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

      // Explicitly sign out so user must log in with their credentials
      void signOut();

      setRegistered({
        email: normEmail,
        fullName: fullName.trim(),
        category: activeCategory.title,
        role: data.role || (isVolunteer ? "volunteer" : "startup_team_leader"),
        teamName: teamName.trim(),
        leadPhoto,
        redgNo: isVolunteer ? redgNo.trim() : undefined,
        rollNo: isVolunteer ? rollNo.trim() : undefined,
        domain: isStartupOrInnovator ? domain.trim() : undefined,
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
      <div className="confirmed-view-wrap">
        <style jsx>{`
          .confirmed-view-wrap {
            max-width: 820px;
            margin: 30px auto 60px;
            padding: 0 16px;
          }
          .success-badge-card {
            background: #ffffff;
            border-radius: 28px;
            padding: 40px 32px;
            text-align: center;
            border: 1px solid #e8dfd3;
            box-shadow: 0 20px 50px -10px rgba(20, 62, 48, 0.12);
            position: relative;
            overflow: hidden;
          }
          .success-badge-card::before {
            content: "";
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 6px;
            background: linear-gradient(90deg, #e87042, #d6b25e, #143e30);
          }
          .check-icon-circle {
            width: 72px;
            height: 72px;
            background: linear-gradient(135deg, #143e30 0%, #256f57 100%);
            color: #ffffff;
            font-size: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            margin: 0 auto 18px;
            box-shadow: 0 10px 24px -6px rgba(20, 62, 48, 0.35);
          }
          .avatar-preview-img {
            width: 96px;
            height: 104px;
            border-radius: 18px;
            object-fit: cover;
            border: 3px solid #ffffff;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
            margin: 0 auto 16px;
            display: block;
          }
          .confirmed-title {
            font-family: var(--font-serif);
            font-size: clamp(24px, 4vw, 32px);
            font-weight: 800;
            color: #1c1917;
            margin: 0 0 8px;
          }
          .confirmed-sub {
            font-size: 15px;
            color: #57534e;
            margin: 0 auto 24px;
            line-height: 1.55;
            max-width: 600px;
          }
          .status-ribbon {
            background: #faf7f2;
            border: 1px solid #e8dfd3;
            border-radius: 14px;
            padding: 12px 18px;
            margin-bottom: 24px;
            display: inline-flex;
            align-items: center;
            gap: 10px;
            font-size: 13.5px;
            color: #143e30;
            font-weight: 700;
          }
          .info-table-box {
            background: #fcfbf8;
            border: 1px solid #e8dfd3;
            border-radius: 20px;
            padding: 22px;
            margin-bottom: 26px;
            text-align: left;
          }
          .info-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 0;
            border-bottom: 1px solid #ede7db;
            font-size: 14px;
          }
          .info-row:last-child {
            border-bottom: none;
          }
          .info-label {
            color: #78716c;
            font-weight: 600;
          }
          .info-val {
            color: #1c1917;
            font-weight: 700;
          }
          .members-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
            font-size: 13px;
          }
          .members-table th {
            background: #ede7db;
            padding: 8px 10px;
            text-align: left;
            color: #44403c;
            font-weight: 700;
            border-radius: 6px;
          }
          .members-table td {
            padding: 9px 10px;
            border-top: 1px solid #e8dfd3;
          }
          .btn-login-cta {
            background: linear-gradient(135deg, #e87042 0%, #c25022 100%);
            color: #ffffff;
            border: none;
            padding: 15px 28px;
            border-radius: 14px;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            box-shadow: 0 10px 24px -5px rgba(232, 112, 66, 0.4);
            transition: all 0.2s ease;
          }
          .btn-login-cta:hover {
            transform: translateY(-2px);
            box-shadow: 0 14px 30px -4px rgba(232, 112, 66, 0.5);
          }
        `}</style>

        <div className="success-badge-card">
          <div className="check-icon-circle">✓</div>
          {registered.leadPhoto && (
            <img
              src={registered.leadPhoto}
              alt={isVolunteer ? "Volunteer" : "Team Lead"}
              className="avatar-preview-img"
            />
          )}
          <h1 className="confirmed-title">Summit Accreditation Confirmed!</h1>
          <p className="confirmed-sub">
            Your {registered.category} credentials have been verified and saved to the official <strong>ISF Startup Jathara 2026</strong> summit registry.
          </p>

          <div className="status-ribbon">
            <span>🎟️</span>
            <span>Accredited Pass: <strong>{activeCategory.passType}</strong> · 18–20 Dec 2026</span>
          </div>

          <div className="info-table-box">
            {registered.teamName && (
              <div className="info-row">
                <span className="info-label">
                  {isVolunteer ? "Organisation Name:" : isStudentInnovator ? "Project / Team Name:" : "Startup / Company Name:"}
                </span>
                <span className="info-val">{registered.teamName}</span>
              </div>
            )}
            <div className="info-row">
              <span className="info-label">{isVolunteer ? "Volunteer Name:" : "Lead Founder / Innovator:"}</span>
              <span className="info-val">{registered.fullName}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Official Email:</span>
              <span className="info-val">{registered.email}</span>
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
            {registered.domain && (
              <div className="info-row">
                <span className="info-label">Focus Sector:</span>
                <span className="info-val">{registered.domain}</span>
              </div>
            )}
            <div className="info-row">
              <span className="info-label">Accreditation Track:</span>
              <span className="info-val" style={{ color: activeCategory.themeColor }}>{registered.category}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Summit Pass Status:</span>
              <span className="info-val" style={{ color: "#143e30" }}>Active · RFID / Badge Ready</span>
            </div>

            {registered.members.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <span className="info-label" style={{ fontWeight: 700, color: "#1c1917", display: "block", marginBottom: 6 }}>
                  Accredited Team Members ({registered.members.length} / 5):
                </span>
                <table className="members-table">
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
                        <td style={{ color: "#e87042" }}>{m.email}</td>
                        <td>{m.phone}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={{ background: "#faf7f2", border: "1.5px solid #e8dfd3", borderRadius: 16, padding: "16px 20px", marginBottom: 24, textAlign: "left" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 20 }}>🔐</span>
              <strong style={{ color: "#1c1917", fontSize: 14.5 }}>Next Step: Sign In with Registered Credentials</strong>
            </div>
            <p style={{ margin: 0, fontSize: 13.5, color: "#57534e", lineHeight: 1.5 }}>
              Your credentials are saved. To access your summit pass and dashboard, please sign in using your registered email (<strong>{registered.email}</strong>) and password.
            </p>
          </div>

          <Link href={`/signin?email=${encodeURIComponent(registered.email)}`} className="btn-login-cta">
            <span>Proceed to Sign In with Your Credentials</span>
            <span>→</span>
          </Link>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- Interactive Main Registration Form
  return (
    <div className="jathara-portal-page">
      <style jsx>{`
        .jathara-portal-page {
          width: 100%;
        }

        /* Hero Banner Section (matches jathara.netlify.app hero) */
        .summit-hero-banner {
          position: relative;
          color: #fcfbf8;
          padding: 44px 20px 48px;
          overflow: hidden;
          background: #0c0d12;
          border-bottom: 1px solid #232733;
          text-align: center;
        }
        .hero-backdrop-img {
          position: absolute;
          inset: 0;
          z-index: 0;
          opacity: 0.35;
          object-fit: cover;
          object-position: center 38%;
          width: 100%;
          height: 100%;
          pointer-events: none;
        }
        .hero-glow-orb {
          position: absolute;
          top: -100px;
          left: 50%;
          transform: translateX(-50%);
          width: 650px;
          height: 350px;
          background: rgba(249, 115, 22, 0.12);
          border-radius: 50%;
          filter: blur(140px);
          pointer-events: none;
          z-index: 1;
        }
        .hero-content {
          position: relative;
          z-index: 10;
          max-width: 940px;
          margin: 0 auto;
        }
        .hero-eyebrow-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.18);
          backdrop-filter: blur(8px);
          padding: 5px 16px;
          border-radius: 999px;
          font-family: var(--font-mono);
          font-size: 11.5px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #f7c89f;
          margin-bottom: 14px;
        }
        .hero-h1 {
          font-family: var(--font-serif);
          font-size: clamp(28px, 5.2vw, 50px);
          font-weight: 900;
          color: #ffffff;
          letter-spacing: -0.025em;
          line-height: 1.1;
          margin: 0 0 10px;
          text-shadow: 0 2px 14px rgba(0, 0, 0, 0.8);
        }
        .hero-gradient-text {
          background: linear-gradient(to right, #ffedd5 0%, #f7c89f 50%, #e87042 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .hero-tagline {
          font-family: var(--font-serif);
          font-size: clamp(16px, 2.5vw, 22px);
          font-weight: 600;
          color: #ffedd5;
          margin: 0 0 12px;
        }
        .hero-lead {
          font-size: 14px;
          color: #d6d0c7;
          max-width: 680px;
          margin: 0 auto 24px;
          line-height: 1.6;
        }

        /* 4 Summit Stats Row (Netlify exact) */
        .summit-stats-bar {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
          padding-top: 20px;
          border-top: 1px solid rgba(255, 255, 255, 0.15);
          max-width: 820px;
          margin: 0 auto 20px;
        }
        .stat-item {
          padding: 6px;
          text-align: center;
        }
        .stat-num {
          font-family: var(--font-serif);
          font-weight: 900;
          font-size: clamp(20px, 3vw, 28px);
          color: #ffffff;
          display: block;
          line-height: 1;
        }
        .stat-label {
          font-size: 11.5px;
          color: #a8a29e;
          font-weight: 500;
          margin-top: 4px;
          display: block;
        }

        /* Aegis Partners Banner (Netlify exact) */
        .aegis-section {
          padding-top: 18px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          max-width: 840px;
          margin: 0 auto;
        }
        .aegis-label {
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #a8a29e;
          margin-bottom: 12px;
          display: block;
        }
        .aegis-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
        }
        .aegis-card {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          border-radius: 14px;
          background: rgba(20, 22, 32, 0.85);
          border: 1px solid rgba(255, 255, 255, 0.1);
          text-align: left;
          text-decoration: none;
        }
        .aegis-img-box {
          width: 38px;
          height: 38px;
          border-radius: 10px;
          background: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 4px;
          flex-shrink: 0;
        }
        .aegis-img {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
        }
        .aegis-role {
          font-size: 9.5px;
          font-weight: 800;
          color: #e87042;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          display: block;
        }
        .aegis-name {
          font-size: 12.5px;
          font-weight: 700;
          color: #ffffff;
          display: block;
          line-height: 1.2;
        }
        .aegis-sub {
          font-size: 10.5px;
          color: #94a3b8;
          display: block;
        }

        /* Main Registration Container */
        .portal-form-container {
          max-width: 1140px;
          margin: -24px auto 60px;
          padding: 0 16px;
          position: relative;
          z-index: 20;
        }

        .portal-card-main {
          background: #ffffff;
          border-radius: 28px;
          padding: 36px 32px;
          border: 1px solid #e4dcce;
          box-shadow: 0 20px 48px -12px rgba(20, 62, 48, 0.1), 0 1px 3px rgba(0, 0, 0, 0.04);
        }

        /* Progress Completion Bar */
        .progress-box {
          background: #faf7f2;
          border: 1px solid #e8dfd3;
          border-radius: 16px;
          padding: 14px 20px;
          display: flex;
          align-items: center;
          gap: 18px;
          margin-bottom: 28px;
        }
        .progress-meta-col {
          flex: 1;
        }
        .progress-title-flex {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          font-weight: 800;
          color: #143e30;
          letter-spacing: 0.04em;
          margin-bottom: 6px;
          font-family: var(--font-mono);
        }
        .progress-bg-track {
          width: 100%;
          height: 8px;
          background: #ede7db;
          border-radius: 999px;
          overflow: hidden;
        }
        .progress-bar-fill {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #e87042 0%, #d6b25e 50%, #143e30 100%);
          transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .progress-chip {
          font-size: 11.5px;
          font-weight: 800;
          color: #e87042;
          background: #faeee8;
          border: 1px solid #f5dfce;
          padding: 5px 12px;
          border-radius: 10px;
          font-family: var(--font-mono);
          white-space: nowrap;
        }

        /* Section Headings */
        .step-heading-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin: 32px 0 18px;
          padding-bottom: 12px;
          border-bottom: 1px solid #ede7db;
        }
        .step-heading-bar:first-of-type {
          margin-top: 0;
        }
        .step-heading-title {
          font-family: var(--font-serif);
          font-size: 18px;
          font-weight: 800;
          color: #103327;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .step-tag-pill {
          font-size: 11.5px;
          font-weight: 700;
          color: #143e30;
          background: #f7f4ec;
          border: 1px solid #e2d8c7;
          padding: 4px 10px;
          border-radius: 8px;
          font-family: var(--font-mono);
        }

        /* STEP 1: Track Cards (Exact Netlify Sector Card style) */
        .tracks-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 18px;
          margin-bottom: 24px;
        }
        .track-card {
          background: #ffffff;
          border-radius: 24px;
          padding: 24px 20px;
          border: 1.5px solid #e4dcce;
          cursor: pointer;
          transition: all 0.28s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          text-align: left;
          position: relative;
          overflow: hidden;
          box-shadow: 0 4px 18px -4px rgba(20, 62, 48, 0.05);
        }
        .track-card::before {
          content: "";
          position: absolute;
          inset-x: 0;
          top: 0;
          height: 3px;
          background: transparent;
          transition: background 0.3s ease;
        }
        .track-card:hover {
          transform: translateY(-3px);
          border-color: #be9740;
          box-shadow: 0 16px 36px -8px rgba(20, 62, 48, 0.12);
        }
        .track-card.active {
          border-color: var(--active-border);
          background: var(--active-bg);
          box-shadow: 0 16px 40px -10px var(--active-glow);
          transform: translateY(-2px);
        }
        .track-card.active::before {
          background: linear-gradient(90deg, transparent, var(--active-border), transparent);
        }
        .track-top-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }
        .track-icon-box {
          width: 48px;
          height: 48px;
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          color: #ffffff;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
        }
        .track-code-pill {
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 700;
          padding: 4px 10px;
          border-radius: 999px;
          background: #f7f4ec;
          color: #143e30;
          border: 1px solid #e2d8c7;
        }
        .track-card.active .track-code-pill {
          background: var(--active-border);
          color: #ffffff;
          border-color: var(--active-border);
        }
        .track-title {
          font-family: var(--font-serif);
          font-size: 18px;
          font-weight: 800;
          color: #103327;
          margin: 0 0 6px;
          line-height: 1.25;
        }
        .track-badge-sub {
          font-size: 11.5px;
          font-weight: 700;
          color: #e87042;
          margin: 0 0 10px;
        }
        .track-desc {
          font-size: 12.5px;
          color: #55635e;
          line-height: 1.5;
          margin: 0 0 16px;
        }
        .track-tag-badge {
          font-size: 11px;
          font-weight: 700;
          padding: 5px 10px;
          border-radius: 8px;
          background: #faf7f2;
          border: 1px solid #ede7db;
          color: #1c1917;
          display: inline-block;
          margin-top: auto;
        }
        .track-card.active .track-tag-badge {
          border-color: var(--active-border);
          color: var(--active-border);
          background: #ffffff;
        }

        /* Track Dynamic Perks Matrix (3 Netlify style boxes) */
        .perks-strip-matrix {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 14px;
          margin-bottom: 30px;
          padding: 16px;
          border-radius: 20px;
          background: #faf7f2;
          border: 1.5px dashed #dfd6c4;
        }
        .perk-card-box {
          background: #ffffff;
          border-radius: 14px;
          padding: 14px 16px;
          border: 1px solid #e8dfd3;
          display: flex;
          gap: 12px;
          align-items: flex-start;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03);
        }
        .perk-icon-circle {
          width: 38px;
          height: 38px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          flex-shrink: 0;
          background: #faeee8;
        }
        .perk-text-wrap h4 {
          margin: 0 0 3px;
          font-family: var(--font-serif);
          font-size: 13.5px;
          font-weight: 700;
          color: #1c1917;
        }
        .perk-text-wrap p {
          margin: 0;
          font-size: 11.5px;
          color: #57534e;
          line-height: 1.45;
        }

        /* Two-Column Layout: Form Fields + Live Summit Badge Mockup */
        .form-and-badge-grid {
          display: grid;
          grid-template-columns: 1fr 310px;
          gap: 28px;
          align-items: start;
        }

        /* Form Subcards */
        .form-panel-card {
          background: #ffffff;
          border: 1px solid #e8dfd3;
          border-radius: 20px;
          padding: 24px;
          margin-bottom: 22px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02);
        }
        .panel-heading {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 18px;
        }
        .panel-badge {
          font-size: 11.5px;
          font-weight: 700;
          padding: 4px 10px;
          border-radius: 999px;
          display: inline-block;
          font-family: var(--font-mono);
          background: #f7f4ec;
          color: #143e30;
          border: 1px solid #e2d8c7;
        }
        .panel-title {
          font-family: var(--font-serif);
          font-size: 14.5px;
          font-weight: 700;
          color: #1c1917;
        }

        /* Inputs & Form Groups */
        .form-grid-fields {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 16px;
        }
        .field-full-width {
          grid-column: 1 / -1;
        }
        .form-group-item {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .form-label-row {
          font-size: 12.5px;
          font-weight: 700;
          color: #292524;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .field-req-mark {
          color: #c25022;
          font-weight: bold;
        }
        .input-icon-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }
        .field-icon-prefix {
          position: absolute;
          left: 12px;
          font-size: 16px;
          pointer-events: none;
          color: #78716c;
        }
        .input-text-ctrl {
          width: 100%;
          padding: 10px 14px 10px 38px;
          border-radius: 12px;
          border: 1.5px solid #dfd6c4;
          font-size: 13.5px;
          color: #1c1917;
          outline: none;
          background: #ffffff;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
          box-sizing: border-box;
          font-family: var(--font-sans);
        }
        .input-text-ctrl:focus {
          border-color: #e87042;
          box-shadow: 0 0 0 3px rgba(232, 112, 66, 0.15);
        }
        .btn-pwd-peek {
          position: absolute;
          right: 12px;
          background: none;
          border: none;
          color: #57534e;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
        }

        /* Password Strength Meter */
        .strength-meter-row {
          margin-top: 4px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .strength-bars-track {
          display: flex;
          gap: 4px;
          flex: 1;
        }
        .strength-bar-unit {
          height: 4px;
          border-radius: 2px;
          flex: 1;
          background: #ede7db;
          transition: background 0.3s;
        }
        .strength-feedback-text {
          font-size: 11px;
          font-weight: 700;
        }

        /* Live Summit Pass Badge Mockup (Right Column) */
        .live-badge-container {
          background: linear-gradient(150deg, #ffffff 0%, #faf7f2 100%);
          border: 2px solid #dfd6c4;
          border-radius: 24px;
          padding: 22px 18px;
          box-shadow: 0 14px 34px -8px rgba(20, 62, 48, 0.1);
          text-align: center;
          position: sticky;
          top: 80px;
        }
        .badge-slot-hanger {
          width: 50px;
          height: 9px;
          background: #78716c;
          border-radius: 5px;
          margin: 0 auto 12px;
        }
        .badge-summit-header {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 900;
          font-family: var(--font-serif);
          color: #103327;
          letter-spacing: 0.05em;
          margin-bottom: 14px;
        }
        .badge-photo-target {
          width: 96px;
          height: 104px;
          border-radius: 16px;
          background: #f7f4ec;
          border: 2px dashed #be9740;
          margin: 0 auto 14px;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .badge-photo-target:hover {
          border-color: #e87042;
          transform: scale(1.02);
        }
        .badge-photo-render {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .badge-attendee-name {
          font-family: var(--font-serif);
          font-size: 16px;
          font-weight: 800;
          color: #1c1917;
          margin: 0 0 2px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .badge-company-name {
          font-size: 12px;
          color: #57534e;
          margin: 0 0 10px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .badge-category-strip {
          font-size: 10.5px;
          font-weight: 800;
          padding: 6px 12px;
          border-radius: 8px;
          color: #ffffff;
          background: var(--badge-accent);
          margin-bottom: 12px;
          letter-spacing: 0.04em;
          font-family: var(--font-mono);
        }
        .badge-photo-btn {
          background: #f7f4ec;
          color: #1c1917;
          border: 1px solid #dfd6c4;
          padding: 7px 14px;
          border-radius: 10px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          width: 100%;
          margin-bottom: 12px;
          transition: all 0.2s;
        }
        .badge-photo-btn:hover {
          background: #ede7db;
        }
        .badge-barcode-pattern {
          font-family: monospace;
          font-size: 13px;
          color: #a8a29e;
          letter-spacing: 3px;
          border-top: 1px dashed #dfd6c4;
          padding-top: 8px;
        }
        .badge-footer-date {
          font-size: 10px;
          color: #78716c;
          font-weight: 700;
          display: block;
          margin-top: 4px;
          letter-spacing: 0.05em;
        }

        /* STEP 3: Multi-Member Cards (Startups & Students) */
        .team-members-list {
          display: flex;
          flex-direction: column;
          gap: 14px;
          margin-bottom: 24px;
        }
        .member-form-card {
          background: #ffffff;
          border: 1.5px solid #e8dfd3;
          border-radius: 18px;
          padding: 20px;
          transition: all 0.2s ease;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02);
        }
        .member-form-card:hover {
          border-color: #dfd6c4;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.04);
        }
        .member-card-title-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 14px;
        }
        .member-number-badge {
          background: #faf7f2;
          color: #103327;
          font-size: 11.5px;
          font-weight: 700;
          padding: 3px 10px;
          border-radius: 6px;
          border: 1px solid #e8dfd3;
          font-family: var(--font-mono);
        }
        .btn-delete-member {
          background: #faeee8;
          border: 1px solid #f5dfce;
          color: #c25022;
          font-size: 11.5px;
          font-weight: 600;
          padding: 3px 10px;
          border-radius: 6px;
          cursor: pointer;
        }
        .member-row-layout {
          display: flex;
          gap: 18px;
          align-items: flex-start;
        }
        .member-photo-pick {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          width: 80px;
          flex-shrink: 0;
        }
        .member-avatar-square {
          width: 72px;
          height: 72px;
          border-radius: 14px;
          background: #faf7f2;
          border: 1.5px dashed #be9740;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          cursor: pointer;
          transition: border-color 0.2s;
        }
        .member-avatar-square:hover {
          border-color: #e87042;
        }
        .member-inputs-flex {
          flex: 1;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 12px;
        }
        .btn-add-team-slot {
          background: #ffffff;
          border: 2px dashed #e87042;
          color: #e87042;
          padding: 13px 20px;
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
        .btn-add-team-slot:hover:not(:disabled) {
          background: #faeee8;
          transform: translateY(-1px);
        }
        .btn-add-team-slot:disabled {
          border-color: #dfd6c4;
          color: #a8a29e;
          cursor: not-allowed;
        }

        /* Trust & Security Banner */
        .trust-seal-box {
          background: #f2f7f4;
          border: 1px solid #c8d1cd;
          border-radius: 16px;
          padding: 14px 18px;
          display: flex;
          align-items: center;
          gap: 14px;
          margin: 18px 0 24px;
        }
        .trust-seal-icon {
          font-size: 22px;
          flex-shrink: 0;
        }
        .trust-seal-head {
          font-family: var(--font-serif);
          font-size: 13.5px;
          font-weight: 700;
          color: #103327;
          margin: 0;
        }
        .trust-seal-text {
          font-size: 11.5px;
          color: #256f57;
          margin: 2px 0 0;
          line-height: 1.45;
        }

        /* Error Notification */
        .error-alert-box {
          background: #faeee8;
          border: 1px solid #f5dfce;
          color: #c25022;
          border-radius: 14px;
          padding: 13px 18px;
          font-size: 13.5px;
          font-weight: 600;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        /* Grand Submit CTA */
        .btn-submit-summit {
          width: 100%;
          background: linear-gradient(135deg, #e87042 0%, #d95d2c 50%, #c25022 100%);
          color: #ffffff;
          border: none;
          padding: 17px 30px;
          border-radius: 16px;
          font-size: 16px;
          font-weight: 800;
          cursor: pointer;
          transition: all 0.25s ease;
          box-shadow: 0 10px 25px -5px rgba(232, 112, 66, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }
        .btn-submit-summit:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 14px 32px -4px rgba(232, 112, 66, 0.5);
        }
        .btn-submit-summit:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }
        .portal-bottom-signin {
          margin-top: 22px;
          text-align: center;
          font-size: 13.5px;
          color: #78716c;
        }
        .portal-bottom-signin a {
          color: #e87042;
          font-weight: 700;
          text-decoration: none;
        }
        .portal-bottom-signin a:hover {
          text-decoration: underline;
        }

        @media (max-width: 900px) {
          .form-and-badge-grid {
            grid-template-columns: 1fr;
          }
          .live-badge-container {
            position: static;
            max-width: 320px;
            margin: 0 auto 24px;
          }
          .tracks-grid, .summit-stats-bar, .perks-strip-matrix, .aegis-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      {/* Hero Header Section (matches jathara.netlify.app) */}
      <section className="summit-hero-banner" aria-label="Summit Introduction and Official Accreditation">
        <img
          src="/images/hero-junicorn-summit.jpeg"
          alt="ISF Summit Delegation"
          className="hero-backdrop-img"
        />
        <div className="hero-glow-orb" aria-hidden="true" />

        <div className="hero-content">
          <div className="hero-eyebrow-pill">
            <span>📍</span>
            <span>GIET University · Gunupur, Odisha · 18–20 December 2026</span>
          </div>

          <h1 className="hero-h1">
            ISF STARTUP JATHARA <span className="hero-gradient-text">2026</span>
          </h1>

          <p className="hero-tagline">Where Grassroots Bharat Meets Venture Capital.</p>

          <p className="hero-lead">
            Official Summit Accreditation & Registration Portal for startup leaders, student innovators & volunteers. Pitch in ₹1 Cr+ grant arenas, meet 50+ tier-1 VCs & GCC leaders, and secure your official summit pass.
          </p>

          {/* 4 Summit Stats Row (Netlify exact) */}
          <div className="summit-stats-bar">
            <div className="stat-item">
              <span className="stat-num">2,000+</span>
              <span className="stat-label">Delegates & Attendees</span>
            </div>
            <div className="stat-item">
              <span className="stat-num" style={{ color: "#f7c89f" }}>100+</span>
              <span className="stat-label">Startups Pitching</span>
            </div>
            <div className="stat-item">
              <span className="stat-num" style={{ color: "#e87042" }}>50+</span>
              <span className="stat-label">VCs, Angels & Mentors</span>
            </div>
            <div className="stat-item">
              <span className="stat-num" style={{ color: "#d6b25e" }}>₹1 Cr+</span>
              <span className="stat-label">Seed Grants & Pitch Pool</span>
            </div>
          </div>

          {/* Convened Under the Aegis Of (Organizers Showcase) */}
          <div className="aegis-section">
            <span className="aegis-label">Convened Under the Aegis Of</span>
            <div className="aegis-grid">
              <a
                href="https://www.isfnetwork.org"
                target="_blank"
                rel="noopener noreferrer"
                className="aegis-card"
                aria-label="ISF Network - Organizer"
              >
                <div className="aegis-img-box">
                  <Image
                    src="/logos/isf-logo.webp"
                    alt="ISF"
                    width={32}
                    height={32}
                    className="aegis-img"
                  />
                </div>
                <div>
                  <span className="aegis-role">Organizer</span>
                  <span className="aegis-name">ISF Network</span>
                  <span className="aegis-sub">International Startup Foundation</span>
                </div>
              </a>

              <a
                href="https://www.giet.edu"
                target="_blank"
                rel="noopener noreferrer"
                className="aegis-card"
                aria-label="GIET University - Host Institution"
              >
                <div className="aegis-img-box">
                  <Image
                    src="/logos/giet-logo.png"
                    alt="GIET University"
                    width={32}
                    height={32}
                    className="aegis-img"
                  />
                </div>
                <div>
                  <span className="aegis-role">Host Campus</span>
                  <span className="aegis-name">GIET University</span>
                  <span className="aegis-sub">Gunupur, Odisha</span>
                </div>
              </a>

              <a
                href="https://www.incubationx.com"
                target="_blank"
                rel="noopener noreferrer"
                className="aegis-card"
                aria-label="IncubateX - Innovation Partner"
              >
                <div className="aegis-img-box">
                  <Image
                    src="/logos/incubatex-logo.png"
                    alt="IncubateX"
                    width={32}
                    height={32}
                    className="aegis-img"
                  />
                </div>
                <div>
                  <span className="aegis-role">Innovation Partner</span>
                  <span className="aegis-name">IncubateX</span>
                  <span className="aegis-sub">Incubation Foundation</span>
                </div>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Main Registration Portal Form Card */}
      <div className="portal-form-container">
        <div className="portal-card-main">
          {/* Real-time Completion Progress Bar */}
          <div className="progress-box">
            <div className="progress-meta-col">
              <div className="progress-title-flex">
                <span>ACCREDITATION PROGRESS</span>
                <span>{progressPercent}% COMPLETE</span>
              </div>
              <div className="progress-bg-track">
                <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
            <span className="progress-chip">
              {progressPercent >= 100 ? "Ready to Submit ✓" : `${100 - progressPercent}% Remaining`}
            </span>
          </div>

          {error && (
            <div className="error-alert-box" role="alert">
              <span style={{ fontSize: 20 }}>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* STEP 1: Accreditation Track Selection */}
            <div className="step-heading-bar">
              <span className="step-heading-title">
                <span>🎯</span> Step 1 · Choose Your Accreditation Track
              </span>
              <span className="step-tag-pill">Role Selection</span>
            </div>

            <div className="tracks-grid">
              {CATEGORIES.map((cat) => {
                const isSelected = category === cat.id;
                return (
                  <div
                    key={cat.id}
                    className={`track-card ${isSelected ? "active" : ""}`}
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
                      <div className="track-top-row">
                        <div className="track-icon-box" style={{ background: cat.themeColor }}>
                          {cat.icon}
                        </div>
                        <span className="track-code-pill">
                          {isSelected ? `${cat.trackCode} ✓` : cat.trackCode}
                        </span>
                      </div>
                      <h3 className="track-title">{cat.title}</h3>
                      <p className="track-badge-sub">{cat.badge}</p>
                      <p className="track-desc">{cat.desc}</p>
                    </div>
                    <span className="track-tag-badge">{cat.tag}</span>
                  </div>
                );
              })}
            </div>

            {/* Dynamic Perks Matrix based on activeCategory */}
            <div className="perks-strip-matrix">
              {activeCategory.perks.map((p, idx) => (
                <div key={idx} className="perk-card-box">
                  <div className="perk-icon-circle">{p.icon}</div>
                  <div className="perk-text-wrap">
                    <h4>{p.title}</h4>
                    <p>{p.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* STEP 2: Profile Credentials + Real-Time Badge Mockup */}
            <div className="step-heading-bar">
              <span className="step-heading-title">
                <span>📝</span> Step 2 · {isVolunteer ? "Volunteer Profile & Student ID" : isStudentInnovator ? "Project & Team Lead Credentials" : "Lead Founder & Venture Credentials"}
              </span>
              <span className="step-tag-pill">Identity & Pass</span>
            </div>

            <div className="form-and-badge-grid">
              {/* Left Column: Form Subcards */}
              <div className="form-inputs-column">
                {/* Subcard 1: Organization & Identity */}
                <div className="form-panel-card">
                  <div className="panel-heading">
                    <span className="panel-badge">🏢 Organization & Identity</span>
                    <span className="panel-title">Institutional details</span>
                  </div>

                  <div className="form-grid-fields">
                    <div className="form-group-item">
                      <label className="form-label-row" htmlFor="teamName">
                        <span>{isVolunteer ? "Organisation Name" : activeCategory.teamLabel} <span className="field-req-mark">*</span></span>
                      </label>
                      <div className="input-icon-wrapper">
                        <span className="field-icon-prefix">🏢</span>
                        <input
                          id="teamName"
                          className="input-text-ctrl"
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

                    <div className="form-group-item">
                      <label className="form-label-row" htmlFor="fullName">
                        <span>{isVolunteer ? "Volunteer Full Name" : "Team Lead Full Name"} <span className="field-req-mark">*</span></span>
                      </label>
                      <div className="input-icon-wrapper">
                        <span className="field-icon-prefix">👤</span>
                        <input
                          id="fullName"
                          className="input-text-ctrl"
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
                        <div className="form-group-item">
                          <label className="form-label-row" htmlFor="redgNo">
                            <span>Registration No (Redg No) <span className="field-req-mark">*</span></span>
                          </label>
                          <div className="input-icon-wrapper">
                            <span className="field-icon-prefix">🆔</span>
                            <input
                              id="redgNo"
                              className="input-text-ctrl"
                              type="text"
                              required
                              placeholder="e.g. 2101298012"
                              value={redgNo}
                              onChange={(e) => setRedgNo(e.target.value)}
                            />
                          </div>
                        </div>

                        <div className="form-group-item">
                          <label className="form-label-row" htmlFor="rollNo">
                            <span>Roll Number / Student ID <span className="field-req-mark">*</span></span>
                          </label>
                          <div className="input-icon-wrapper">
                            <span className="field-icon-prefix">🎓</span>
                            <input
                              id="rollNo"
                              className="input-text-ctrl"
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
                      <div className="form-group-item">
                        <label className="form-label-row" htmlFor="domain">
                          <span>Focus Sector <span className="field-req-mark">*</span></span>
                        </label>
                        <div className="input-icon-wrapper">
                          <span className="field-icon-prefix">🏷️</span>
                          <select
                            id="domain"
                            className="input-text-ctrl"
                            value={domain}
                            onChange={(e) => setDomain(e.target.value)}
                            required
                          >
                            {FOCUS_SECTORS.map((d) => (
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

                {/* Subcard 2: Contact & Authentication Credentials */}
                <div className="form-panel-card">
                  <div className="panel-heading">
                    <span className="panel-badge">🔐 Contact & Authentication</span>
                    <span className="panel-title">Account credentials & communications</span>
                  </div>

                  <div className="form-grid-fields">
                    <div className="form-group-item">
                      <label className="form-label-row" htmlFor="email">
                        <span>Official Email Address <span className="field-req-mark">*</span></span>
                      </label>
                      <div className="input-icon-wrapper">
                        <span className="field-icon-prefix">✉️</span>
                        <input
                          id="email"
                          className="input-text-ctrl"
                          type="email"
                          required
                          placeholder={isVolunteer ? "volunteer@college.edu" : isStudentInnovator ? "innovator@college.edu" : "founder@company.com"}
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="form-group-item">
                      <label className="form-label-row" htmlFor="password">
                        <span>Create Account Password <span className="field-req-mark">*</span></span>
                      </label>
                      <div className="input-icon-wrapper">
                        <span className="field-icon-prefix">🔒</span>
                        <input
                          id="password"
                          className="input-text-ctrl"
                          type={showPassword ? "text" : "password"}
                          required
                          placeholder="Min 6 chars"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn-pwd-peek"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? "Hide" : "Show"}
                        </button>
                      </div>

                      {/* Interactive Password Strength Meter with Jathara colors */}
                      {password && (
                        <div className="strength-meter-row">
                          <div className="strength-bars-track">
                            {[1, 2, 3, 4].map((i) => (
                              <div
                                key={i}
                                className="strength-bar-unit"
                                style={{
                                  background: i <= passwordStrength.level ? passwordStrength.color : "#ede7db",
                                }}
                              />
                            ))}
                          </div>
                          <span className="strength-feedback-text" style={{ color: passwordStrength.color }}>
                            {passwordStrength.label}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="form-group-item">
                      <label className="form-label-row" htmlFor="mobile">
                        <span>Primary Mobile (WhatsApp) <span className="field-req-mark">*</span></span>
                      </label>
                      <div className="input-icon-wrapper">
                        <span className="field-icon-prefix">📱</span>
                        <input
                          id="mobile"
                          className="input-text-ctrl"
                          type="tel"
                          required
                          placeholder="+91 98765 43210 or 10-digit number"
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
                      <span style={{ fontSize: "11px", color: "#78716c", marginTop: "2px" }}>
                        Auto-formats to E.164 (+91 98765 43210)
                      </span>
                    </div>

                    <div className="form-group-item">
                      <label className="form-label-row" htmlFor="altMobile">
                        <span>Alternate Phone Number <span className="field-req-mark">*</span></span>
                      </label>
                      <div className="input-icon-wrapper">
                        <span className="field-icon-prefix">📞</span>
                        <input
                          id="altMobile"
                          className="input-text-ctrl"
                          type="tel"
                          required
                          placeholder="Secondary / Emergency contact"
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

                    <div className="form-group-item">
                      <label className="form-label-row" htmlFor="city">
                        <span>City <span className="field-req-mark">*</span></span>
                      </label>
                      <div className="input-icon-wrapper">
                        <span className="field-icon-prefix">📍</span>
                        <input
                          id="city"
                          className="input-text-ctrl"
                          type="text"
                          required
                          placeholder="e.g. Bhubaneswar / Gunupur"
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="form-group-item">
                      <label className="form-label-row" htmlFor="state">
                        <span>State <span className="field-req-mark">*</span></span>
                      </label>
                      <div className="input-icon-wrapper">
                        <span className="field-icon-prefix">🗺️</span>
                        <input
                          id="state"
                          className="input-text-ctrl"
                          type="text"
                          required
                          placeholder="e.g. Odisha"
                          value={state}
                          onChange={(e) => setState(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="form-group-item">
                      <label className="form-label-row" htmlFor="country">
                        <span>Country <span className="field-req-mark">*</span></span>
                      </label>
                      <div className="input-icon-wrapper">
                        <span className="field-icon-prefix">🌍</span>
                        <input
                          id="country"
                          className="input-text-ctrl"
                          type="text"
                          required
                          value={country}
                          onChange={(e) => setCountry(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="form-group-item field-full-width">
                      <label className="form-label-row" htmlFor="linkedinUrl">
                        <span>LinkedIn Profile / URL {isStartupOrInnovator && <span className="field-req-mark">*</span>}</span>
                      </label>
                      <div className="input-icon-wrapper">
                        <span className="field-icon-prefix">🔗</span>
                        <input
                          id="linkedinUrl"
                          className="input-text-ctrl"
                          type="text"
                          inputMode="url"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          required={isStartupOrInnovator}
                          placeholder="e.g. linkedin.com/in/username or full URL"
                          value={linkedinUrl}
                          onChange={(e) => setLinkedinUrl(e.target.value)}
                          onBlur={() => {
                            if (linkedinUrl.trim()) {
                              setLinkedinUrl(normalizeLinkedInUrl(linkedinUrl));
                            }
                          }}
                        />
                      </div>
                      <span style={{ fontSize: "11px", color: "#78716c", marginTop: "2px" }}>
                        Accepts LinkedIn username, handle, or full URL
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Physical Summit Badge Mockup (Real-Time Preview) */}
              <div className="badge-preview-column">
                <div
                  className="live-badge-container"
                  style={{ "--badge-accent": activeCategory.themeColor } as React.CSSProperties}
                >
                  <div className="badge-slot-hanger" />
                  <div className="badge-summit-header">
                    <img src="/logos/isf-logo.webp" alt="ISF Logo" style={{ width: 18, height: 18, objectFit: "contain" }} />
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
                    className="badge-photo-target"
                    onClick={() => leadFileInputRef.current?.click()}
                    title="Click to upload photograph for summit pass"
                  >
                    {leadPhoto ? (
                      <img src={leadPhoto} alt="Attendee" className="badge-photo-render" />
                    ) : (
                      <div style={{ textAlign: "center", padding: 8 }}>
                        <span style={{ fontSize: 26 }}>📷</span>
                        <span style={{ fontSize: 10, display: "block", color: "#78716c", marginTop: 4, fontWeight: 700 }}>
                          Upload Pass Photo *
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="badge-attendee-name">
                    {fullName.trim() || "Attendee Full Name"}
                  </div>
                  <div className="badge-company-name">
                    {teamName.trim() || "Startup / Institution"}
                  </div>
                  <div className="badge-category-strip">
                    {activeCategory.passType}
                  </div>

                  <button
                    type="button"
                    className="badge-photo-btn"
                    onClick={() => leadFileInputRef.current?.click()}
                  >
                    {leadPhoto ? "Change Photograph" : "Upload Badge Photo *"}
                  </button>

                  <div className="badge-barcode-pattern">
                    ||| | |||| | |||||| || | |||
                  </div>
                  <span className="badge-footer-date">
                    18–20 DEC 2026 · GIET UNIVERSITY
                  </span>
                </div>
              </div>
            </div>

            {/* STEP 3: Team Members Details (for Startup Leader & Student Innovator) */}
            {isStartupOrInnovator && (
              <>
                <div className="step-heading-bar" style={{ marginTop: 28 }}>
                  <span className="step-heading-title">
                    <span>👥</span> Step 3 · Team Members Accreditation (Max 5 Members)
                  </span>
                  <span className="step-tag-pill">{members.length} / 5 Added · Mandatory *</span>
                </div>

                <div className="team-members-list">
                  {members.map((member, index) => (
                    <div key={member.id} className="member-form-card">
                      <div className="member-card-title-bar">
                        <span className="member-number-badge">Member #{index + 1} · Core Contributor</span>
                        {members.length > 1 && (
                          <button
                            type="button"
                            className="btn-delete-member"
                            onClick={() => handleRemoveMember(member.id)}
                          >
                            ✕ Remove
                          </button>
                        )}
                      </div>

                      <div className="member-row-layout">
                        {/* Member Photo Box */}
                        <div className="member-photo-pick">
                          <label
                            className="member-avatar-square"
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
                              <span style={{ fontSize: 22, color: "#a8a29e" }}>📷</span>
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
                          <span style={{ fontSize: 10.5, color: member.photoUrl ? "#143e30" : "#78716c", fontWeight: 700 }}>
                            {member.photoUrl ? "Photo ✓" : "Upload *"}
                          </span>
                        </div>

                        {/* Member Inputs */}
                        <div className="member-inputs-flex">
                          <div className="form-group-item">
                            <label className="form-label-row">
                              <span>Full Name <span className="field-req-mark">*</span></span>
                            </label>
                            <input
                              type="text"
                              required
                              className="input-text-ctrl"
                              style={{ paddingLeft: 12 }}
                              placeholder="e.g. Priya Sharma"
                              value={member.name}
                              onChange={(e) => handleMemberFieldChange(member.id, "name", e.target.value)}
                            />
                          </div>

                          <div className="form-group-item">
                            <label className="form-label-row">
                              <span>Phone Number <span className="field-req-mark">*</span></span>
                            </label>
                            <input
                              type="tel"
                              required
                              className="input-text-ctrl"
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

                          <div className="form-group-item">
                            <label className="form-label-row">
                              <span>Email Address <span className="field-req-mark">*</span></span>
                            </label>
                            <input
                              type="email"
                              required
                              className="input-text-ctrl"
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
                      className="btn-add-team-slot"
                      onClick={handleAddMember}
                    >
                      <span>+ Add Another Team Member</span>
                      <span>({5 - members.length} spots remaining)</span>
                    </button>
                  )}
                </div>
              </>
            )}

            {/* Trust & Security Guarantee */}
            <div className="trust-seal-box">
              <span className="trust-seal-icon">🛡️</span>
              <div>
                <p className="trust-seal-head">Official Summit Accreditation Guarantee</p>
                <p className="trust-seal-text">
                  Your credentials and attendee profiles are encrypted and committed directly to the official ISF 2026 Summit database. Badges will be generated and distributed upon check-in at GIET University.
                </p>
              </div>
            </div>

            {error && (
              <div className="error-alert-box" role="alert" style={{ marginBottom: "16px" }}>
                <span style={{ fontSize: 20 }}>⚠️</span>
                <span>{error}</span>
              </div>
            )}

            <button type="submit" className="btn-submit-summit" disabled={busy}>
              {busy ? "Registering & Generating Credentials…" : `Complete Registration as ${activeCategory.title} →`}
            </button>
          </form>

          <div className="portal-bottom-signin">
            Already registered?{" "}
            <Link href="/signin">Sign in to your account here</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
