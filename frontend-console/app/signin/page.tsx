"use client";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function Redirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const next = searchParams.get("next");
    const query = next ? `?next=${encodeURIComponent(next)}` : "";
    router.replace(`/login${query}`);
  }, [router, searchParams]);

  return <p className="muted">Redirecting to console log in...</p>;
}

export default function SignInRedirect() {
  return <Suspense><Redirect /></Suspense>;
}
