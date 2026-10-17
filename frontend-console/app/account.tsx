import Link from "next/link";
import { signOut, useSessionEmail } from "@/lib/session";

export function Account() {
  const email = useSessionEmail();
  if (!email) return null;
  return (
    <span className="small" style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <Link
        href="/profile"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "4px 10px",
          borderRadius: 6,
          background: "#eff6ff",
          border: "1px solid #bfdbfe",
          color: "#1d4ed8",
          fontSize: 12,
          fontWeight: 700,
          textDecoration: "none",
        }}
      >
        👤 Profile
      </Link>
      <span className="muted">· {email} ·</span>
      <a href="#" onClick={(e) => { e.preventDefault(); void signOut(); }} style={{ color: "#dc2626" }}>Log out</a>
    </span>
  );
}
