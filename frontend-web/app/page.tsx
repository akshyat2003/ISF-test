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
  return (
    <>
      <section className="hero">
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 16, flexWrap: "wrap" }}>
          <Image src="/logos/udbhav.png" alt="Udbhav" width={84} height={84} style={{ borderRadius: 14, objectFit: "contain" }} />
          <div>
            <p className="eyebrow" style={{ margin: 0 }}>GIET University · Gunupur, Odisha</p>
            <h1 style={{ margin: "4px 0 0" }}>Udbhav · Startup Jathara</h1>
          </div>
        </div>
        <p className="lede">
          {e26?.eventStartsOn && e26.eventEndsOn ? formatDateRange(e26.eventStartsOn, e26.eventEndsOn) : "18–20 December 2026"}
          {" "}· pre-event day 17 December 2026. Startup pitches, roundtables, awards, networking, forest trekking
          and ecosystem discussions, organised by GIET University in association with the International Startup Foundation and Incubatex Innovation.
        </p>
        <div className="actions">
          <Link href="/register" className="btn btn-primary">Summit Registration (All Tracks) →</Link>
          <Link href="/signin" className="btn">Sign In to Dashboard</Link>
        </div>
      </section>
    </>
  );
}

