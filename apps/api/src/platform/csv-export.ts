// The only way to produce CSV for download (reports, exports). Every exported cell goes through csvCell so that
// participant-supplied text can never run as a spreadsheet formula (CSV/formula injection), even if a value
// slipped past import validation or was entered through another channel.
const FORMULA_START = /^[=+\-@\t\r＝＋－＠]/;

/** One CSV cell: neutralises formula prefixes with a leading apostrophe, then applies RFC 4180 quoting. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "bigint") return String(value);   // real numbers stay numeric
  if (typeof value === "boolean") return value ? "true" : "false";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A whole CSV document (CRLF line endings, UTF-8 BOM so spreadsheet apps detect the encoding). */
export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return `﻿${[header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
