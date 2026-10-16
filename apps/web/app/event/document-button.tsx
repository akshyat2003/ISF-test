"use client";
// Opens a public document through a short-lived link issued by the API (SEC-08); links expire after 60 seconds.
import { useState } from "react";
import { api } from "@/lib/session";

export function DocumentButton({ year, id, title }: { year: number; id: string; title: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button className="btn" type="button" onClick={async () => {
        setError(null);
        try { window.open(api.absoluteUrl((await api.publicDocumentLink(year, id)).url), "_blank", "noopener"); }
        catch (e) { setError((e as Error).message); }
      }}>Open {title}</button>
      {error && <p className="field-error">{error}</p>}
    </>
  );
}
