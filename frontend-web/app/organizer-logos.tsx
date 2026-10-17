import Image from "next/image";

export const ORGANIZERS = [
  {
    id: "giet",
    name: "GIET University",
    subName: "Gunupur, Odisha",
    role: "Host & Academic Institution",
    src: "/logos/giet.jpg",
  },
  {
    id: "isf",
    name: "International Startup Foundation",
    subName: "ISF",
    role: "Global Startup Ecosystem Partner",
    src: "/logos/isf.jpg",
  },
  {
    id: "incubatex",
    name: "Incubatex Innovation",
    subName: "Innovation Hub",
    role: "Incubation & Technology Partner",
    src: "/logos/incubatex.jpg",
  },
] as const;

export function OrganizerLogos({
  title = "Organized & Presented By",
  layout = "cards",
}: {
  title?: string;
  layout?: "cards" | "banner" | "header";
}) {
  if (layout === "header") {
    return (
      <div className="header-logos" aria-label="Event Organizers">
        {ORGANIZERS.map((org) => (
          <div key={org.id} className="header-logo-item" title={`${org.name} - ${org.role}`}>
            <Image
              src={org.src}
              alt={org.name}
              width={34}
              height={34}
              className="header-logo-img"
            />
          </div>
        ))}
      </div>
    );
  }

  if (layout === "banner") {
    return (
      <div className="organizer-banner" aria-label="Organizing partners">
        {title && <span className="organizer-banner-title">{title}</span>}
        <div className="organizer-banner-items">
          {ORGANIZERS.map((org) => (
            <div key={org.id} className="organizer-banner-item">
              <Image
                src={org.src}
                alt={org.name}
                width={36}
                height={36}
                className="organizer-banner-img"
              />
              <div className="organizer-banner-text">
                <span className="organizer-banner-name">{org.name}</span>
                <span className="organizer-banner-role">{org.role}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <section className="organizers-section" aria-label="Event Organizers">
      {title && <div className="eyebrow" style={{ textAlign: "center", marginBottom: 18 }}>{title}</div>}
      <div className="organizers-grid">
        {ORGANIZERS.map((org) => (
          <div key={org.id} className="organizer-card">
            <div className="organizer-logo-box">
              <Image
                src={org.src}
                alt={org.name}
                width={70}
                height={70}
                className="organizer-img"
              />
            </div>
            <div className="organizer-info">
              <h4 className="organizer-name">{org.name}</h4>
              <span className="organizer-sub">{org.subName}</span>
              <p className="organizer-role muted small">{org.role}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
