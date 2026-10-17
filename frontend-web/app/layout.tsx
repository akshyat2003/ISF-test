import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import "./globals.css";
import { AccountLink } from "./account-link";
import { OrganizerLogos } from "./organizer-logos";

export const metadata: Metadata = {
  title: "ISF · Startup Jathara @ Dandakaranya",
  description: "ISF – Startup Jathara @ Dandakaranya, 18–20 December 2026, GIET University, Gunupur, Odisha.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <header className="site-header">
          <div className="container">
            <div className="header-brand-wrap">
              <Link href="/" className="brand" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Image src="/logos/udbhav.png" alt="ISF" width={38} height={38} style={{ borderRadius: 8, objectFit: "contain" }} />
                <span>ISF <span>@ Startup Jathara</span></span>
              </Link>
            </div>
            <nav className="nav" aria-label="Main">
              <Link href="/register" className="nav-link-register">Register</Link>
              <AccountLink />
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
        <footer className="site-footer">
          <div className="container footer-content">
            <OrganizerLogos layout="cards" title="Presented & Organised by" />
            <div className="footer-links">
              GIET University, Gunupur, Odisha · International Startup Foundation (ISF) · Incubatex Innovation ·{" "}
              <Link href="/privacy">Privacy notice</Link>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
