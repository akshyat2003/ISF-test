import { describe, expect, it } from "vitest";
import { CHUNK_SIZE, chunkedStore, safeKey, type KeyValueBackend } from "./chunked-store";

function memory(): KeyValueBackend & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async getItemAsync(k) { return data.get(k) ?? null; },
    async setItemAsync(k, v) {
      if (!/^[A-Za-z0-9._-]+$/.test(k)) throw new Error(`invalid key ${k}`);
      if (v.length > 2048) throw new Error("value over 2048 bytes");   // the iOS keychain constraint we must respect
      data.set(k, v);
    },
    async deleteItemAsync(k) { data.delete(k); },
  };
}

describe("chunked secure store", () => {
  it("round-trips a large session through chunks that each fit the keychain limit", async () => {
    const b = memory();
    const s = chunkedStore(b);
    const session = JSON.stringify({ access_token: "a".repeat(2500), refresh_token: "r".repeat(900), user: { id: "u" } });
    await s.setItem("sb-abc-auth-token", session);
    expect(await s.getItem("sb-abc-auth-token")).toBe(session);
    expect(b.data.get("sb-abc-auth-token.n")).toBe(String(Math.ceil(session.length / CHUNK_SIZE)));
    for (const v of b.data.values()) expect(v.length).toBeLessThanOrEqual(CHUNK_SIZE);
  });

  it("removes every chunk, and a shorter value replaces a longer one cleanly", async () => {
    const b = memory();
    const s = chunkedStore(b);
    await s.setItem("k", "x".repeat(CHUNK_SIZE * 3 + 5));
    await s.setItem("k", "short");
    expect(await s.getItem("k")).toBe("short");
    expect([...b.data.keys()].sort()).toEqual(["k.0", "k.n"]);
    await s.removeItem("k");
    expect(b.data.size).toBe(0);
    expect(await s.getItem("k")).toBeNull();
  });

  it("treats a partially written value as absent, never as a session", async () => {
    const b = memory();
    const s = chunkedStore(b);
    await s.setItem("k", "y".repeat(CHUNK_SIZE * 2));
    b.data.delete("k.1");
    expect(await s.getItem("k")).toBeNull();
    b.data.set("k.n", "not-a-number");
    expect(await s.getItem("k")).toBeNull();
  });

  it("makes keys safe for SecureStore", () => {
    expect(safeKey("sb-xyz-auth-token")).toBe("sb-xyz-auth-token");
    expect(safeKey("a b/c:d@e")).toBe("a_b_c_d_e");
  });
});
