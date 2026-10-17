import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import "./globals.css";
import { Nav } from "./nav";

export const metadata: Metadata = { title: "Udbhav Console · Management & Support", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <header className="site-header">
          <div className="container">
            <Link href="/" className="brand" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Image src="/logos/udbhav.png" alt="Udbhav" width={34} height={34} style={{ borderRadius: 6, objectFit: "contain" }} />
              <span>Udbhav <span>Console</span></span>
            </Link>
            <Nav />
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
