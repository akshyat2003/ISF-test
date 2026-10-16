import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Nav } from "./nav";

export const metadata: Metadata = { title: "Startup Jathara Console", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <header className="site-header">
          <div className="container">
            <Link href="/" className="brand">Startup Jathara <span>Console</span></Link>
            <Nav />
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
