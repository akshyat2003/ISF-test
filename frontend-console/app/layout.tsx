import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Nav } from "./nav";

export const metadata: Metadata = { title: "Udbhav Console · Management & Support", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <header className="site-header">
          <div className="container">
            <Link href="/" className="brand" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <img src="/logos/udbhav.png" alt="Udbhav" style={{ height: "32px", width: "auto", objectFit: "contain", borderRadius: "6px" }} />
              <span>Udbhav <span style={{ color: "#0078d4" }}>Console</span></span>
            </Link>
            <Nav />
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
