// Emergency control logic (FR-HD-10/11, TBD-07, TBD-55). Pure: no React Native imports, so it is unit-tested.
// Rules the screen relies on:
// - 112 is always shown first and can be called at once: nothing (network, sign-in, the alert) is awaited before it.
// - Other numbers are only those the Admin published as emergency contacts (cached from the last successful load);
//   the app never invents a venue, medical or security number.
// - Alerting the event team is retried with the same request id, so a retry never opens a second ticket.
import type { EmergencyContact } from "@sj/contracts";

export const NATIONAL_EMERGENCY: EmergencyContact = { title: "National emergency number (police, fire, ambulance)", phone: "112" };

/** 112 first, then the published contacts once each (same number shown once). */
export function withNational(contacts: readonly EmergencyContact[]): EmergencyContact[] {
  const seen = new Set(["112"]);
  const out: EmergencyContact[] = [NATIONAL_EMERGENCY];
  for (const c of contacts) {
    const key = c.phone.replace(/[^+0-9]/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** The dialler URL for a number: digits and a leading + only. */
export const telUrl = (phone: string) => `tel:${phone.replace(/[^+0-9]/g, "")}`;

/** A random v4 UUID for idempotent reporting. Uses the platform's CSPRNG when there is one. */
export function newRequestId(rand: (n: number) => Uint8Array = defaultRandom): string {
  const b = rand(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function defaultRandom(n: number): Uint8Array {
  const b = new Uint8Array(n);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) return c.getRandomValues(b);
  for (let i = 0; i < n; i += 1) b[i] = Math.floor(Math.random() * 256);
  return b;
}

/** Serialise contacts for the offline cache, small enough for the device keystore (about 2 KB per entry). */
export function encodeCache(contacts: readonly EmergencyContact[], limit = 1800): string {
  const list = contacts.filter((c) => c.phone.replace(/[^+0-9]/g, "") !== "112").map((c) => ({ title: c.title.slice(0, 80), phone: c.phone.slice(0, 24), available: c.available?.slice(0, 60) ?? null }));
  while (list.length && JSON.stringify(list).length > limit) list.pop();
  return JSON.stringify(list);
}
export function decodeCache(raw: string | null): EmergencyContact[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((c): c is EmergencyContact => !!c && typeof c.title === "string" && typeof c.phone === "string" && /[0-9]/.test(c.phone));
  } catch {
    return [];
  }
}

/**
 * Calls `send` until it succeeds, waiting `delays[i]` ms between attempts. The caller passes the same request id on
 * every attempt. Returns the last error after the final attempt. Errors for which `retryable` is false stop at once.
 */
export async function withRetries<T>(send: () => Promise<T>, opts: { delays?: number[]; retryable?: (e: unknown) => boolean; sleep?: (ms: number) => Promise<void> } = {}):
  Promise<{ ok: true; value: T; attempts: number } | { ok: false; error: unknown; attempts: number }> {
  const delays = opts.delays ?? [1000, 3000, 8000];
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let attempts = 0;
  for (;;) {
    attempts += 1;
    try {
      return { ok: true, value: await send(), attempts };
    } catch (error) {
      if (attempts > delays.length || (opts.retryable && !opts.retryable(error))) return { ok: false, error, attempts };
      await sleep(delays[attempts - 1]!);
    }
  }
}
