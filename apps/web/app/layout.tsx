import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { AccountLink } from "./account-link";

export const metadata: Metadata = {
  title: "Startup Jathara @ Dandakaranya",
  description: "Startup Jathara @ Dandakaranya, 18–20 December 2026, GIET University, Gunupur, Odisha.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <header className="site-header">
          <div className="container">
            <Link href="/" className="brand">Startup Jathara <span>@ Dandakaranya</span></Link>
            <nav className="nav" aria-label="Main">
              <Link href="/event">Programme</Link>
              <Link href="/register">Register a startup</Link>
              <Link href="/status">Application status</Link>
              <AccountLink />
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
        <footer className="site-footer">
          <div className="container">
            GIET University, Gunupur, Odisha · in association with the International Startup Foundation (ISF) ·{" "}
            <Link href="/privacy">Privacy notice</Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
