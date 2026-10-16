// Keeps a large value (the Supabase session, ~3–5 KB with refresh token) in the device keychain/keystore.
// expo-secure-store values should stay under ~2 KB (iOS warns and may reject larger values), so the value is
// split into chunks, each its own keychain entry. Nothing is written to plain AsyncStorage.
export interface KeyValueBackend {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export const CHUNK_SIZE = 1800;
const MAX_CHUNKS = 64;

/** SecureStore keys may only contain letters, digits, ".", "-" and "_". */
export function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, "_");
}

export function chunkedStore(backend: KeyValueBackend) {
  const countKey = (k: string) => `${safeKey(k)}.n`;
  const partKey = (k: string, i: number) => `${safeKey(k)}.${i}`;

  async function removeItem(key: string): Promise<void> {
    const n = Number((await backend.getItemAsync(countKey(key))) ?? 0);
    await backend.deleteItemAsync(countKey(key));   // count first: a half-removed value then reads as absent
    for (let i = 0; i < Math.min(n, MAX_CHUNKS); i++) await backend.deleteItemAsync(partKey(key, i));
  }

  return {
    async getItem(key: string): Promise<string | null> {
      const raw = await backend.getItemAsync(countKey(key));
      if (raw === null) return null;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > MAX_CHUNKS) return null;
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        const p = await backend.getItemAsync(partKey(key, i));
        if (p === null) return null;   // incomplete write: treat as signed out, never as a corrupt session
        parts.push(p);
      }
      return parts.join("");
    },
    async setItem(key: string, value: string): Promise<void> {
      const n = Math.max(1, Math.ceil(value.length / CHUNK_SIZE));
      if (n > MAX_CHUNKS) throw new Error("Value too large for secure storage");
      await removeItem(key);
      for (let i = 0; i < n; i++) await backend.setItemAsync(partKey(key, i), value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
      await backend.setItemAsync(countKey(key), String(n));   // count last: commits the write
    },
    removeItem,
  };
}
