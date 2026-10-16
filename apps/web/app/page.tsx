import Link from "next/link";
import type { PublicEdition } from "@sj/contracts";
import { formatDateRange, formatIst } from "@sj/client";

export const dynamic = "force-dynamic";

async function loadEditions(): Promise<PublicEdition[] | null> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/v1/public/editions`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as PublicEdition[]) : null;
  } catch {
    return null;
  }
}

function RegistrationLine({ e }: { e: PublicEdition }) {
  if (!e.registration.open) return <p className="muted">Registration for {e.year} is closed.</p>;
  if (!e.registration.closesAt) return <p>Registration is open. The deadline will be announced.</p>;
  return (
    <p>
      Open until <strong>{formatIst(e.registration.closesAt)} IST</strong>
      {!e.registration.closesAtConfirmed && <span className="muted small"> (time to be confirmed)</span>}
    </p>
  );
}

export default async function Home() {
  const editions = await loadEditions();
  const e26 = editions?.find((e) => e.year === 2026);
  return (
    <>
      <section className="hero">
        <p className="eyebrow">GIET University · Gunupur, Odisha</p>
        <h1>Startup Jathara @ Dandakaranya</h1>
        <p className="lede">
          {e26?.eventStartsOn && e26.eventEndsOn ? formatDateRange(e26.eventStartsOn, e26.eventEndsOn) : "18–20 December 2026"}
          {" "}· pre-event day 17 December 2026. Startup pitches, roundtables, awards, networking, forest trekking
          and ecosystem discussions, organised by GIET University in association with the International Startup Foundation.
        </p>
        <div className="actions">
          <Link href="/register" className="btn btn-primary">Register your startup</Link>
          <Link href="/status" className="btn">Check application status</Link>
          <Link href="/event" className="btn">Programme and event information</Link>
        </div>
      </section>

      <h2 style={{ marginTop: 40 }}>Registration</h2>
      {editions ? (
        <div className="grid">
          {editions.map((e) => (
            <div className="card" key={e.year}>
              <h3>{e.name}</h3>
              <RegistrationLine e={e} />
            </div>
          ))}
        </div>
      ) : (
        <p className="notice notice-warn">Registration details are temporarily unavailable. Please try again shortly.</p>
      )}
      <p className="muted small" style={{ marginTop: 16 }}>
        You can apply for 2026, 2027 or both. Each year has its own application and its own result. The programme is tentative and may change.
      </p>
    </>
  );
}
