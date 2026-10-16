// Reproducible, unbiased random order for volunteer assignment (FR-VOL-04, -11).
// The seed comes from a cryptographically secure source and is stored with the run; the stream is HMAC-SHA256(seed,
// label:counter), so anyone holding the seed and the recorded (sorted) inputs can reproduce the run exactly.
import { createHmac, randomBytes } from "node:crypto";

export const newSeed = () => randomBytes(32).toString("hex");

function stream(seed: string, label: string) {
  let counter = 0;
  let buf = Buffer.alloc(0);
  return () => {
    if (buf.length < 4) buf = Buffer.concat([buf, createHmac("sha256", seed).update(`${label}:${counter++}`).digest()]);
    const v = buf.readUInt32BE(0);
    buf = buf.subarray(4);
    return v;
  };
}

/** Fisher–Yates with rejection sampling (no modulo bias). Deterministic for a given seed, label and input order. */
export function seededShuffle<T>(items: readonly T[], seed: string, label: string): T[] {
  const out = [...items];
  const next = stream(seed, label);
  const below = (n: number) => {
    const limit = Math.floor(0x1_0000_0000 / n) * n;
    let v: number;
    do v = next(); while (v >= limit);
    return v % n;
  };
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = below(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export type Target = { type: "startup" | "jury"; id: string };

/**
 * Pairs volunteers with targets one-to-one (RQ §9). Both lists are shuffled with the seed; the first min(|V|, |T|)
 * are paired. Nobody is paired with themselves (a person who is both a volunteer and a jury target): such a pair swaps
 * its target with another pair where that is valid, otherwise both are left unpaired and listed. Never doubles up.
 */
export function pairUp(volunteers: readonly string[], targets: readonly Target[], seed: string) {
  const v = seededShuffle(volunteers, seed, "volunteers");
  const t = seededShuffle(targets, seed, "targets");
  const n = Math.min(v.length, t.length);
  const pairs: { volunteer: string; target: Target }[] = [];
  for (let i = 0; i < n; i += 1) pairs.push({ volunteer: v[i]!, target: t[i]! });
  const self = (p: { volunteer: string; target: Target }) => p.target.type === "jury" && p.target.id === p.volunteer;
  const dropped: { volunteer: string; target: Target }[] = [];
  const spare = t.slice(n);
  for (let i = 0; i < pairs.length; i += 1) {
    if (!self(pairs[i]!)) continue;
    const k = pairs.findIndex((q, j) => j !== i && !self({ volunteer: pairs[i]!.volunteer, target: q.target }) && !self({ volunteer: q.volunteer, target: pairs[i]!.target }));
    if (k >= 0) {
      const tmp = pairs[i]!.target;
      pairs[i] = { volunteer: pairs[i]!.volunteer, target: pairs[k]!.target };
      pairs[k] = { volunteer: pairs[k]!.volunteer, target: tmp };
    } else {
      // No valid swap among the pairs: take an unpaired target instead, if any; else leave both unpaired.
      const s = spare.findIndex((x) => !(x.type === "jury" && x.id === pairs[i]!.volunteer));
      if (s >= 0) {
        const tmp = pairs[i]!.target;
        pairs[i] = { volunteer: pairs[i]!.volunteer, target: spare[s]! };
        spare[s] = tmp;
      } else dropped.push(pairs[i]!);
    }
  }
  const kept = pairs.filter((p) => !dropped.includes(p));
  return {
    pairs: kept,
    unassignedTargets: [...spare, ...dropped.map((d) => d.target)],
    surplusVolunteers: [...v.slice(n), ...dropped.map((d) => d.volunteer)],
  };
}
