// Input handling for AI ranking (FR-RNK-09, FR-RNK-10, AT-40).
// Application text is untrusted: it is redacted of contact details, checked for embedded instructions, and passed to
// the model only as data. Nothing in it can change the evaluation instructions or the criteria.
import { createHash } from "node:crypto";
import type { FormQuestion } from "@sj/contracts";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Indian mobiles (optionally +91 / 91 / 0 prefixed, optionally split 5+5) and international numbers written with "+".
const PHONE_IN = /(?<!\d)(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g;
const PHONE_INTL = /\+\d[\d\s().-]{6,17}\d/g;
const URL = /\b(?:https?:\/\/|www\.)\S+/gi;

/** Removes email addresses, phone numbers and links from free text (FR-RNK-10: no contact data in AI input). */
export function redactContacts(text: string): string {
  return text
    .replace(EMAIL, "[email removed]")
    .replace(URL, "[link removed]")
    .replace(PHONE_INTL, "[phone removed]")
    .replace(PHONE_IN, "[phone removed]");
}

// Phrases that try to steer an evaluator. Matching flags the application for a human look; it never changes scoring.
const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b[^.]{0,40}\b(instruction|instructions|prompt|rules|guidance|criteria)\b/i,
  /\b(system|developer)\s*(prompt|message|instruction)/i,
  /\byou are (now )?(an?|the) (ai|assistant|evaluator|judge|model|language model)\b/i,
  /\bas an ai\b/i,
  /\b(give|assign|award|rate|score|mark)\b[^.]{0,40}\b(highest|maximum|max|top|perfect|full)\b[^.]{0,20}\b(score|scores|marks|rating|rank)\b/i,
  /\b(give|assign|award|rate|score)\b[^.]{0,30}\b(5\s*\/\s*5|10\s*\/\s*10|100\s*%|five out of five)/i,
  /\brank (us|this|our)[^.]{0,30}\b(first|1st|top|highest)\b/i,
  /<\/?\s*(system|instructions?|prompt|assistant)\s*>/i,
  /\b(respond|reply|output|answer) (only )?with\b/i,
];

export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

export type RankingSource = {
  description: string | null;
  city: string | null;
  state: string | null;
  formAnswers: Record<string, unknown>;
  questions: FormQuestion[];
};

/** What the model sees for one application. No name, leader, email, mobile or website (FR-RNK-10). */
export type RankingInput = {
  description: string;
  location: string | null;
  answers: { question: string; answer: string }[];
};

export type PreparedInput = { input: RankingInput; sha256: string; missing: string[]; injection: boolean };

export function prepareInput(src: RankingSource): PreparedInput {
  const missing: string[] = [];
  const description = (src.description ?? "").trim();
  if (description.length < 20) missing.push("description");
  const answers: RankingInput["answers"] = [];
  for (const q of src.questions) {
    const raw = src.formAnswers[q.key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value.length < Math.max(q.minLength, 1)) missing.push(q.key);
    else answers.push({ question: q.label, answer: redactContacts(value) });
  }
  const location = [src.city, src.state].filter((x) => x && x.trim()).join(", ") || null;
  const input: RankingInput = { description: redactContacts(description), location, answers };
  const allText = [description, ...Object.values(src.formAnswers).filter((v): v is string => typeof v === "string")].join("\n");
  return {
    input,
    sha256: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
    missing,
    injection: looksLikeInjection(allText),
  };
}
