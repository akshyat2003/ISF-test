// Output check, defence in depth (FR-HD-06, PRD §8.3 guardrails): an answer may only contain contact details and
// identifiers that were in the data given to the model for this question (the requester's own records and official
// information) or 112. Anything else — a phone number, email address or identifier the model produced from elsewhere
// — blocks the answer. The model never receives other people's data; this catches hallucinated or injected values.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+?\d[\d\s().-]{6,}\d)/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

const digits = (s: string) => s.replace(/\D/g, "");

export type LeakCheck = { ok: boolean; offending: string[] };

export function checkAnswer(answer: string, context: string): LeakCheck {
  const ctxLower = context.toLowerCase();
  const ctxDigits = new Set((context.match(PHONE) ?? []).map(digits).filter((d) => d.length >= 7));
  const offending: string[] = [];
  for (const e of answer.match(EMAIL) ?? []) if (!ctxLower.includes(e.toLowerCase())) offending.push(e);
  for (const u of answer.match(UUID) ?? []) if (!ctxLower.includes(u.toLowerCase())) offending.push(u);
  for (const p of answer.match(PHONE) ?? []) {
    const d = digits(p);
    if (d.length < 7) continue;                                  // dates, times, counts
    if (/^\d{4}-\d{2}-\d{2}$/.test(p.trim()) || /^\d{4}\s*-\s*\d{4}$/.test(p.trim())) continue;   // a date, or a year range
    const known = [...ctxDigits].some((c) => c === d || (d.length >= 10 && c.endsWith(d.slice(-10))) || (c.length >= 10 && d.endsWith(c.slice(-10))));
    if (!known) offending.push(p.trim());
  }
  return { ok: offending.length === 0, offending };
}
