import { describe, expect, it } from "vitest";
import type { JuryParameter } from "@sj/contracts";
import { choices, previewTotal, toPayload, unscored } from "./scoring";

const P: JuryParameter[] = [
  { key: "innovation", label: "Innovation", description: "d", weight: 1, min: 1, max: 10 },
  { key: "impact", label: "Impact", description: "d", weight: 3, min: 1, max: 5 },
];

describe("jury scoring form helpers", () => {
  it("lists unscored parameters in rubric order", () => {
    expect(unscored(P, {}).map((p) => p.key)).toEqual(["innovation", "impact"]);
    expect(unscored(P, { impact: 2 }).map((p) => p.key)).toEqual(["innovation"]);
  });

  it("previews the weighted, normalised total only when complete and valid", () => {
    expect(previewTotal(P, { innovation: 10 })).toBeNull();
    expect(previewTotal(P, { innovation: 10, impact: 6 })).toBeNull();
    expect(previewTotal(P, { innovation: 10, impact: 5 })).toBe(100);
    expect(previewTotal(P, { innovation: 1, impact: 1 })).toBe(0);
    // (1 × 9/9 + 3 × 2/4) / 4 × 100 = 62.5
    expect(previewTotal(P, { innovation: 10, impact: 3 })).toBe(62.5);
  });

  it("sends only rubric scores, and comments only when allowed and non-empty", () => {
    expect(toPayload(P, { innovation: 4, stale: 3 } as never, "  Good  ", true)).toEqual({ scores: { innovation: 4 }, comments: "Good" });
    expect(toPayload(P, { innovation: 4 }, "Good", false)).toEqual({ scores: { innovation: 4 } });
    expect(toPayload(P, {}, "   ", true)).toEqual({ scores: {} });
  });

  it("offers every whole number in the range", () => {
    expect(choices(P[1]!)).toEqual([1, 2, 3, 4, 5]);
  });
});
