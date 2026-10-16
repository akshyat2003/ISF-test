// CSV export escaping: defence in depth against formula injection for every future export.
import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/modules/imports/csv.js";
import { csvCell, toCsv } from "../src/platform/csv-export.js";

describe("csvCell", () => {
  it.each([
    ["=HYPERLINK(\"http://evil\",\"x\")", "\"'=HYPERLINK(\"\"http://evil\"\",\"\"x\"\")\""],
    ["+91 98765 43210", "'+91 98765 43210"],
    ["-2+3+cmd|' /C calc'!A0", "'-2+3+cmd|' /C calc'!A0"],
    ["@SUM(A1:A9)", "'@SUM(A1:A9)"],
    ["\t=1+1", "'\t=1+1"],
    ["＝1+1", "'＝1+1"],
  ])("neutralises formula prefix in %j", (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it("quotes commas, quotes and newlines, and leaves plain text and real numbers alone", () => {
    expect(csvCell("Sal Leaf, Koraput")).toBe('"Sal Leaf, Koraput"');
    expect(csvCell('Say "hi"')).toBe('"Say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("Plain text")).toBe("Plain text");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(null)).toBe("");
    expect(csvCell(new Date("2026-10-15T00:00:00Z"))).toBe("2026-10-15T00:00:00.000Z");
  });

  it("round-trips through a CSV reader with values intact apart from the neutralising apostrophe", () => {
    const doc = toCsv(["name", "note"], [["=cmd", "a,b"], ["Asha", 'say "x"']]);
    expect(doc.startsWith("﻿")).toBe(true);
    expect(parseCsv(doc)).toEqual([["name", "note"], ["'=cmd", "a,b"], ["Asha", 'say "x"']]);
  });
});
