"use client";
import { useEffect, useState } from "react";
import type { MeResponse } from "@sj/contracts";
import { api, useSessionEmail } from "./session";

/** The signed-in person's account, roles and permissions; drives which console sections are shown.
 *  Hiding is for convenience only: the API enforces every permission. */
export function useMe(): { me: MeResponse | null; email: string | null | undefined; error: string | null } {
  const email = useSessionEmail();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setMe(null);
    setError(null);
    if (email) api.me().then(setMe, (e: Error) => setError(e.message));
  }, [email]);
  return { me, email, error };
}

export const can = (me: MeResponse | null, perm: string) => !!me?.permissions.includes(perm);
