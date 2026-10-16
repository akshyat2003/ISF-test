import Link from "next/link";

/** Shown when the API withholds staff permissions until multi-factor verification (403 mfa_required). */
export function MfaPrompt({ next }: { next?: string }) {
  return (
    <p className="notice notice-warn" role="alert">
      Multi-factor verification is required for your role.{" "}
      <Link href={`/mfa${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Verify now</Link>
    </p>
  );
}
