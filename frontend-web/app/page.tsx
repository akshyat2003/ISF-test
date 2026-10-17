import Link from "next/link";
import Image from "next/image";
import type { PublicEdition } from "@sj/contracts";
import { formatDateRange } from "@sj/client";

export const dynamic = "force-dynamic";

async function loadEditions(): Promise<PublicEdition[] | null> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/v1/public/editions`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as PublicEdition[]) : null;
  } catch {
    return null;
  }
}

export default async function Home() {
  const editions = await loadEditions();
  const e26 = editions?.find((e) => e.year === 2026);
  const eventDates = e26?.eventStartsOn && e26.eventEndsOn ? formatDateRange(e26.eventStartsOn, e26.eventEndsOn) : "18–20 December 2026";

  return (
    <section className="hero">
      <div className="hero-emblem">
        <Image src="/logos/udbhav.png" alt="Udbhav" width={80} height={80} style={{ borderRadius: 12, objectFit: "contain" }} priority />
      </div>

      <span className="eyebrow-badge">GIET University · Gunupur, Odisha</span>

      <h1>Udbhav · Startup Jathara</h1>

      <div className="pills-row">
        <span className="pill-item">📅 {eventDates} (Pre-event 17 Dec)</span>
        <span className="pill-item">📍 GIET University, Gunupur</span>
        <span className="pill-item">🤝 ISF & Incubatex Innovation</span>
      </div>

      <p className="lede">
        The premier Dandakaranya Innovation Summit bringing together startup leaders, student innovators, and volunteers for pitch stages, roundtables, and ecosystem growth.
      </p>

      <div className="actions">
        <Link href="/register" className="btn btn-primary btn-large">
          Summit Registration →
        </Link>
        <Link href="/signin" className="btn btn-large">
          Sign In to Dashboard
        </Link>
      </div>

      <div className="tracks-ribbon">
        <p className="tracks-ribbon-title">Open Registration Tracks</p>
        <div className="tracks-badges">
          <span className="track-chip">🚀 Startup Leaders</span>
          <span className="track-chip">💡 Student Innovators</span>
          <span className="track-chip">🤝 Volunteers</span>
        </div>
      </div>
    </section>
  );
}

