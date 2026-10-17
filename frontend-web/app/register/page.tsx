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
}

const CATEGORIES: CategoryMeta[] = [
  {
    id: "startup_founder",
    title: "Startup Leader",
    badge: "Startup Leaders",
    icon: "🚀",
    desc: "Founders, co-founders & startup leaders building early-stage or growth ventures",
    teamLabel: "Startup / Company Name",
  },
  {
    id: "student_innovator",
    title: "Student Innovator",
    badge: "Student Innovators",
    icon: "🎓",
    desc: "Undergraduates, researchers & college teams with working prototypes",
    teamLabel: "Startup / Team Name",
  },
  {
    id: "volunteer",
    title: "Volunteers",
    badge: "Volunteers",
    icon: "🤝",
    desc: "Individual student & campus volunteers for summit coordination & venue operations",
    teamLabel: "Organisation Name",
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
      reject(new Error("Please select an image file (PNG, JPG, WEBP)."));
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

// Universal LinkedIn / URL normalizer (handles full URLs, www, handles, usernames)
export function normalizeLinkedInUrl(input: string): string {
  let val = (input || "").trim();
  if (!val) return "";

  // If already starts with http:// or https://
  if (/^https?:\/\//i.test(val)) {
    return val;
  }

  // If protocol-relative //
  if (val.startsWith("//")) {
    return `https:${val}`;
  }

  // If starts with www. or linkedin.com or regional subdomain (e.g. in.linkedin.com)
  if (/^([a-z0-9-]+\.)?linkedin\.com/i.test(val)) {
    return `https://${val}`;
  }

  // If starts with in/
  if (/^in\/[a-zA-Z0-9_\-%\.]+/i.test(val)) {
    return `https://www.linkedin.com/${val}`;
  }

  // If general web domain
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(val)) {
    return `https://${val}`;
  }

  // If username / handle (e.g. amartya-sarangee-3351a8241 or @username)
  const cleanUsername = val.replace(/^@/, "");
  return `https://www.linkedin.com/in/${cleanUsername}`;
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

  // Team members (1 to 5 members, compulsory for startup leader)
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

  // Team lead photo upload handler
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

  // Member photo upload handler
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
      handleFormError("Please enter the team lead / full name.");
      return;
    }
    if (!password || password.length < 6) {
      handleFormError("Please enter a password of at least 6 characters.");
      return;
    }

    // Startup Leader & Student Innovator Strict Compulsory Validations
    if (isStartupOrInnovator) {
      if (!teamName.trim()) {
        handleFormError("Please enter your Startup / Team Name.");
        return;
      }
      if (!leadPhoto) {
        handleFormError("Please upload the Team Lead Photo.");
        return;
      }
      if (!mobile.trim()) {
        handleFormError("Please enter your Primary Phone Number.");
        return;
      }
      if (!altMobile.trim()) {
        handleFormError("Please enter your Alternate Phone Number.");
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
      if (members.length > 5) {
        handleFormError("Maximum 5 team members are allowed.");
        return;
      }
      // Check every member's details
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
        if (!m.email.trim() || !m.email.includes("@")) {
          handleFormError(`Please enter a valid email address for Member #${i + 1} (${m.name}).`);
          return;
        }
      }
    } else if (isVolunteer) {
      // Volunteer Compulsory Validations
      if (!fullName.trim()) {
        handleFormError("Please enter your Volunteer Full Name.");
        return;
      }
      if (!leadPhoto) {
        handleFormError("Please upload your Volunteer Photograph.");
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
    } else {
      // General validation for other categories
      if (!mobile.trim()) {
        handleFormError("Please provide a primary phone number.");
        return;
      }
    }

    setBusy(true);

    try {
      const finalLinkedin = normalizeLinkedInUrl(linkedinUrl);
      const res = await fetch("/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          teamName: teamName.trim(),
          organisationName: isVolunteer ? teamName.trim() : null,
          fullName: fullName.trim(),
          photoUrl: leadPhoto || null,
          email: normEmail,
          password: password.trim(),
          mobile: mobile.trim(),
          altMobile: altMobile.trim(),
          redgNo: isVolunteer ? redgNo.trim() : null,
          rollNo: isVolunteer ? rollNo.trim() : null,
          domain: isStartupOrInnovator ? domain : null,
          city: city.trim(),
          state: state.trim(),
          country: country.trim(),
          linkedinUrl: finalLinkedin || null,
          members: isStartupOrInnovator ? members : [],
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
        role: data.role || (isVolunteer ? "volunteer" : "startup_team_leader"),
        teamName: teamName.trim(),
        leadPhoto: leadPhoto,
        redgNo: isVolunteer ? redgNo.trim() : undefined,
        rollNo: isVolunteer ? rollNo.trim() : undefined,
        linkedinUrl: finalLinkedin || undefined,
        members: isStartupOrInnovator ? members : [],
      });
    } catch (err) {
      handleFormError((err as Error).message || "An unexpected error occurred. Please try again.");
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
            max-width: 640px;
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
            margin: 0 auto 16px;
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
          .lead-avatar-preview {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            object-fit: cover;
            border: 3px solid #3b82f6;
            margin: 0 auto 16px;
            display: block;
          }
          .info-box {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            padding: 20px;
            text-align: left;
            margin-bottom: 24px;
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
          .members-summary-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
            margin-top: 14px;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            overflow: hidden;
          }
          .members-summary-table th {
            background: #f1f5f9;
            padding: 8px 10px;
            text-align: left;
            color: #475569;
            font-weight: 600;
          }
          .members-summary-table td {
            padding: 8px 10px;
            border-top: 1px solid #e2e8f0;
          }
          .email-banner {
            background: #eff6ff;
            border: 1px solid #bfdbfe;
            color: #1e40af;
            border-radius: 12px;
            padding: 12px 16px;
            font-size: 13px;
            margin-bottom: 24px;
            display: flex;
            align-items: center;
            gap: 8px;
            text-align: left;
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
          {registered.leadPhoto && (
            <img src={registered.leadPhoto} alt={isVolunteer ? "Volunteer" : "Team Lead"} className="lead-avatar-preview" />
          )}
          <h1 className="success-title">Registration Confirmed!</h1>
          <p className="success-sub">
            Welcome to <strong>ISF @ Startup Jathara 2026</strong>. Your {registered.category} profile and credentials have been registered into the database.
          </p>

          <div className="email-banner">
            <span>✉️</span>
            <span>A confirmation email has been dispatched to <strong>{registered.email}</strong> with full registration details.</span>
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
              <span className="info-label">Track:</span>
              <span className="info-val">{registered.category}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Account Status:</span>
              <span className="info-val" style={{ color: "#059669" }}>Active · Logged In</span>
            </div>

            {registered.members.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <span className="info-label" style={{ fontWeight: 600, color: "#1e293b" }}>
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
                            <img src={m.photoUrl} alt={m.name} style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} />
                          ) : "—"}
                        </td>
                        <td><strong>{m.name}</strong></td>
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
          font-size: 34px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 10px;
          letter-spacing: -0.02em;
        }
        .reg-subtitle {
          font-size: 15px;
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
          margin: 28px 0 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid #f1f5f9;
          padding-bottom: 10px;
        }
        .section-label:first-of-type {
          margin-top: 0;
        }
        .section-tag {
          font-size: 12px;
          font-weight: 600;
          color: #64748b;
          text-transform: none;
        }
        .categories-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 14px;
          margin-bottom: 28px;
        }
        .category-pill {
          background: #f8fafc;
          border: 1.5px solid #e2e8f0;
          border-radius: 14px;
          padding: 16px;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: flex-start;
          gap: 14px;
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
          font-size: 26px;
          flex-shrink: 0;
          margin-top: 2px;
        }
        .cat-title {
          font-size: 15px;
          font-weight: 700;
          color: #0f172a;
          margin: 0 0 4px;
          line-height: 1.3;
        }
        .cat-desc {
          font-size: 12px;
          color: #64748b;
          line-height: 1.4;
          margin: 0;
        }

        /* Lead Photo Upload Box */
        .photo-uploader {
          display: flex;
          align-items: center;
          gap: 20px;
          background: #f8fafc;
          border: 1.5px dashed #cbd5e1;
          border-radius: 16px;
          padding: 16px 20px;
          margin-bottom: 24px;
          transition: border-color 0.2s ease;
        }
        .photo-uploader:hover {
          border-color: #2563eb;
          background: #f0f7ff;
        }
        .photo-avatar-box {
          width: 84px;
          height: 84px;
          border-radius: 16px;
          background: #e2e8f0;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          flex-shrink: 0;
          border: 2px solid #cbd5e1;
        }
        .photo-avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .photo-avatar-placeholder {
          font-size: 32px;
          color: #64748b;
        }
        .photo-upload-meta {
          flex: 1;
        }
        .photo-upload-title {
          font-size: 14px;
          font-weight: 700;
          color: #0f172a;
          margin: 0 0 4px;
        }
        .photo-upload-sub {
          font-size: 12px;
          color: #64748b;
          margin: 0 0 10px;
        }
        .photo-btn-row {
          display: flex;
          gap: 10px;
        }
        .btn-photo-pick {
          background: #2563eb;
          color: #ffffff;
          border: none;
          padding: 6px 14px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-photo-remove {
          background: #fee2e2;
          color: #b91c1c;
          border: 1px solid #fecaca;
          padding: 6px 12px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }

        .form-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 18px;
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
          font-weight: bold;
        }
        .input-field {
          width: 100%;
          padding: 11px 14px;
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

        /* Members Section */
        .members-container {
          display: flex;
          flex-direction: column;
          gap: 16px;
          margin-bottom: 28px;
        }
        .member-card {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 20px;
          transition: all 0.2s ease;
        }
        .member-card:hover {
          border-color: #cbd5e1;
        }
        .member-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }
        .member-pill {
          background: #eff6ff;
          color: #1e40af;
          font-size: 12px;
          font-weight: 700;
          padding: 4px 10px;
          border-radius: 6px;
          border: 1px solid #bfdbfe;
        }
        .btn-remove-member {
          background: #fee2e2;
          border: 1px solid #fecaca;
          color: #b91c1c;
          font-size: 12px;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: 6px;
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
          border-radius: 12px;
          background: #e2e8f0;
          border: 1.5px dashed #94a3b8;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          cursor: pointer;
          transition: border-color 0.2s;
        }
        .member-avatar-box:hover {
          border-color: #2563eb;
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
          border: 1.5px dashed #2563eb;
          color: #2563eb;
          padding: 12px 20px;
          border-radius: 12px;
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
          background: #eff6ff;
        }
        .btn-add-member:disabled {
          border-color: #cbd5e1;
          color: #94a3b8;
          cursor: not-allowed;
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

        @media (max-width: 640px) {
          .reg-card {
            padding: 24px 18px;
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
        }
      `}</style>

      <div className="reg-container">
        {/* Header */}
        <div className="reg-header">
          <div className="brand-badge">
            <img src="/logos/udbhav.png" alt="ISF" style={{ width: 22, height: 22, objectFit: "contain" }} />
            <span>ISF · Startup Jathara 2026 · Dandakaranya</span>
          </div>
          <h1 className="reg-title">Summit Registration</h1>
          <p className="reg-subtitle">
            Register your startup credentials and team member details for the Dandakaranya Innovation Summit (18–20 December 2026 at GIET University).
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
              <span>Step 1 · Choose Your Track</span>
              <span className="section-tag">Role selection</span>
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

            {/* Step 2 · Profile & Registration Details */}
            <div className="section-label">
              <span>Step 2 · {isVolunteer ? "Volunteer Details" : isStudentInnovator ? "Team Lead & Innovation Details" : "Team Lead & Startup Details"}</span>
              <span className="section-tag">All fields compulsory *</span>
            </div>

            {/* Form Inputs Grid */}
            <div className="form-grid">
              <div className="input-group">
                <label className="input-label" htmlFor="teamName">
                  <span>{isVolunteer ? "Organisation Name" : activeCategory.teamLabel} <span className="input-req">*</span></span>
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

              {/* Volunteer Registration Number & Roll Number */}
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

              <div className="input-group">
                <label className="input-label" htmlFor="email">
                  <span>{isVolunteer ? "Email Address" : isStudentInnovator ? "Email Address" : "Official Email Address"} <span className="input-req">*</span></span>
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
                  <span>Alternate Phone Number <span className="input-req">*</span></span>
                </label>
                <input
                  id="altMobile"
                  className="input-field"
                  type="tel"
                  required
                  placeholder="Secondary / Emergency contact"
                  value={altMobile}
                  onChange={(e) => setAltMobile(e.target.value)}
                />
              </div>

              {!isVolunteer && (
                <div className="input-group">
                  <label className="input-label" htmlFor="domain">
                    <span>Domain / Sector <span className="input-req">*</span></span>
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
                <span style={{ fontSize: "11px", color: "#64748b", marginTop: "4px", display: "block" }}>
                  Accepts LinkedIn URL, www.linkedin.com/in/..., or your profile username (we'll format it automatically)
                </span>
              </div>

              {/* Photograph Upload Card */}
              <div className="form-full" style={{ marginTop: "4px" }}>
                <div className="photo-uploader">
                  <input
                    type="file"
                    accept="image/*"
                    ref={leadFileInputRef}
                    style={{ display: "none" }}
                    onChange={handleLeadPhotoChange}
                  />
                  <div
                    className="photo-avatar-box"
                    onClick={() => leadFileInputRef.current?.click()}
                    style={{ cursor: "pointer" }}
                  >
                    {leadPhoto ? (
                      <img src={leadPhoto} alt="Photo Preview" className="photo-avatar-img" />
                    ) : (
                      <span className="photo-avatar-placeholder">📷</span>
                    )}
                  </div>
                  <div className="photo-upload-meta">
                    <div className="photo-upload-title">
                      {isVolunteer ? "Volunteer Photograph" : "Team Lead Photograph"} <span className="input-req">*</span>
                    </div>
                    <div className="photo-upload-sub">
                      {isVolunteer
                        ? "Upload a clear headshot / passport size photograph (JPG, PNG, WEBP). Compulsory for volunteer ID badge & event security access."
                        : "Upload a clear headshot photo (JPG, PNG, WEBP). Compulsory for summit badge & profile."}
                    </div>
                    <div className="photo-btn-row">
                      <button
                        type="button"
                        className="btn-photo-pick"
                        onClick={() => leadFileInputRef.current?.click()}
                      >
                        {leadPhoto ? "Change Photo" : "Upload Photo"}
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
            </div>

            {/* 3. Team Members Details (compulsory for startup leader & student innovator, max 5) */}
            {isStartupOrInnovator && (
              <>
                <div className="section-label">
                  <span>Step 3 · Team Members Details (Max 5 Members)</span>
                  <span className="section-tag">{members.length} / 5 Added · All compulsory *</span>
                </div>

                <div className="members-container">
                  {members.map((member, index) => (
                    <div key={member.id} className="member-card">
                      <div className="member-card-header">
                        <span className="member-pill">Member #{index + 1}</span>
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
                          <span style={{ fontSize: 11, color: member.photoUrl ? "#059669" : "#64748b", fontWeight: 600 }}>
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

            {error && (
              <div className="error-banner" role="alert" style={{ marginBottom: "16px" }}>
                <span>⚠️</span>
                <span>{error}</span>
              </div>
            )}

            <button type="submit" className="submit-btn" disabled={busy}>
              {busy ? "Registering & Saving Details…" : `Complete Registration as ${activeCategory.title} →`}
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
