import { describe, expect, it } from "vitest";
import { decodeCache, encodeCache, NATIONAL_EMERGENCY, newRequestId, telUrl, withNational, withRetries } from "./emergency";

describe("emergency contacts", () => {
  it("112 is always first, even with nothing published or cached", () => {
    expect(withNational([])).toEqual([NATIONAL_EMERGENCY]);
    const list = withNational([{ title: "Venue medical desk", phone: "+91 98765 43210" }, { title: "Dup 112", phone: "1 1 2" }, { title: "Again", phone: "+919876543210" }]);
    expect(list.map((c) => c.phone)).toEqual(["112", "+91 98765 43210"]);
  });

  it("dials digits only", () => {
    expect(telUrl("+91 (98765) 43210")).toBe("tel:+919876543210");
    expect(telUrl("112")).toBe("tel:112");
  });

  it("the offline cache round-trips, stays small, never stores 112 and ignores junk", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ title: `Contact ${i} with a long descriptive title for the desk`, phone: `+91 90000 ${String(i).padStart(5, "0")}` }));
    const raw = encodeCache([NATIONAL_EMERGENCY, ...many]);
    expect(raw.length).toBeLessThanOrEqual(1800);
    const back = decodeCache(raw);
    expect(back.length).toBeGreaterThan(5);
    expect(back.map((c) => c.phone)).not.toContain("112");
    expect(decodeCache("not json")).toEqual([]);
    expect(decodeCache('[{"title":"x"},{"title":"y","phone":"abc"},{"title":"ok","phone":"100"}]')).toEqual([{ title: "ok", phone: "100" }]);
    expect(decodeCache(null)).toEqual([]);
  });

  it("request ids are v4 UUIDs the API accepts, and differ", () => {
    const a = newRequestId(), b = newRequestId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
    expect(newRequestId(() => new Uint8Array(16))).toBe("00000000-0000-4000-8000-000000000000");
  });
});

describe("alerting the event team with retries", () => {
  const noWait = async () => {};
  it("retries until it succeeds", async () => {
    let n = 0;
    const r = await withRetries(async () => { n += 1; if (n < 3) throw new Error("offline"); return "ok"; }, { sleep: noWait });
    expect(r).toEqual({ ok: true, value: "ok", attempts: 3 });
  });
  it("gives up after the last delay and returns the error", async () => {
    const r = await withRetries(async () => { throw new Error("offline"); }, { delays: [1, 1], sleep: noWait });
    expect(r).toMatchObject({ ok: false, attempts: 3 });
  });
  it("stops at once on an error that a retry cannot fix", async () => {
    const r = await withRetries(async () => { throw Object.assign(new Error("signed out"), { status: 401 }); },
      { sleep: noWait, retryable: (e) => (e as { status?: number }).status !== 401 });
    expect(r.attempts).toBe(1);
  });
});
