// Public programme and event information (FR-EVT-01…13). The same published data the app shows: an update made once
// in the console appears here and in the app without a release. Only items marked "Public" appear on this page.
import type { EventInfo } from "@sj/contracts";
import { formatIst } from "@sj/client";
import { DocumentButton } from "./document-button";

export const dynamic = "force-dynamic";
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function load(year: number): Promise<EventInfo | null> {
  try {
    const res = await fetch(`${API}/v1/public/editions/${year}/event`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as EventInfo) : null;
  } catch {
    return null;
  }
}

const time = (b: { startTime?: string | null; endTime?: string | null }) =>
  b.startTime ? `${b.startTime}${b.endTime ? `–${b.endTime}` : ""}` : "Time to be announced";
const MEAL = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snacks: "Snacks", other: "Food" } as const;

export default async function EventPage() {
  const e = await load(2026);
  if (!e) return <p className="notice notice-warn" style={{ marginTop: 24 }}>Event information is temporarily unavailable. Please try again shortly.</p>;
  const texts = [
    { title: "Accommodation", items: e.accommodation }, { title: "Travel and transport", items: e.travel },
    { title: "Safety guidelines", items: e.safety }, { title: "More information", items: e.pages },
  ].filter((s) => s.items.length);
  return (
    <>
      <section className="hero">
        <p className="eyebrow">Programme · {e.edition.name}</p>
        <h1>Event information</h1>
        <p className="muted">
          The programme is tentative and may change. {e.lastUpdated ? `Last updated ${formatIst(e.lastUpdated)} IST.` : "Details will be published here soon."}
        </p>
      </section>

      <h2 style={{ marginTop: 24 }}>Programme</h2>
      <div className="list">
        {e.schedule.map((d) => (
          <section className="card" key={d.date} aria-label={d.label}>
            <h3>{d.label}</h3>
            {d.items.length === 0 && d.meals.length === 0 && <p className="muted small">Details to be announced.</p>}
            {d.items.map((i) => (
              <div key={i.id} className="event-row">
                <span className="event-time">{time(i.body)}</span>
                <span>
                  <strong>{i.title}</strong>{i.body.tentative && <span className="badge" style={{ marginLeft: 8 }}>Tentative</span>}
                  {i.body.venue && <span className="muted"> · {i.body.venue}</span>}
                  {i.body.details && <span className="muted small event-text"><br />{i.body.details}</span>}
                </span>
              </div>
            ))}
            {d.meals.map((m) => (
              <div key={m.id} className="event-row">
                <span className="event-time">{time(m.body)}</span>
                <span>
                  <strong>{MEAL[m.body.meal]}: {m.title}</strong>{m.body.venue && <span className="muted"> · {m.body.venue}</span>}
                  {m.body.menu.length > 0 && <span className="muted small"><br />{m.body.menu.join(" · ")}</span>}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>

      {e.venues.length > 0 && (
        <>
          <h2 style={{ marginTop: 32 }}>Venues</h2>
          <div className="grid">
            {e.venues.map((v) => (
              <div className="card" key={v.id}>
                <h3>{v.title}</h3>
                {v.body.address && <p>{v.body.address}</p>}
                {v.body.notes && <p className="muted small event-text">{v.body.notes}</p>}
                {v.body.mapUrl && <a href={v.body.mapUrl} target="_blank" rel="noopener noreferrer">Open map</a>}
              </div>
            ))}
          </div>
        </>
      )}

      {texts.map((s) => (
        <section key={s.title}>
          <h2 style={{ marginTop: 32 }}>{s.title}</h2>
          {s.items.map((i) => (
            <div className="card" key={i.id} style={{ marginBottom: 12 }}>
              <h3>{i.title}</h3>
              <p className="event-text">{i.body.text}</p>
              {i.body.address && <p className="muted small">{i.body.address}</p>}
            </div>
          ))}
        </section>
      ))}

      <h2 style={{ marginTop: 32 }}>Emergency contacts</h2>
      <div className="card">
        {e.emergency.map((c, i) => (
          <p key={c.id ?? "112"} style={i === 0 ? { fontSize: "1.1rem" } : undefined}>
            <strong>{c.title}:</strong> <a href={`tel:${c.phone.replace(/[^+0-9]/g, "")}`}>{c.phone}</a>
            {c.available && <span className="muted small"> · {c.available}</span>}
          </p>
        ))}
      </div>

      {e.documents.length > 0 && (
        <>
          <h2 style={{ marginTop: 32 }}>Documents</h2>
          <div className="list">
            {e.documents.map((d) => (
              <div className="card row" key={d.id}>
                <span><strong>{d.title}</strong>{d.description && <span className="muted small"><br />{d.description}</span>}</span>
                <DocumentButton year={e.edition.year} id={d.id} title={d.title} />
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
