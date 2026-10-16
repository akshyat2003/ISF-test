// Deterministic checks that run on every Help Desk message BEFORE any model is involved (FR-HD-15, TBD-55).
// They need no AI provider, so an emergency is handled the same way when the provider is down. English only for
// 2026 (TBD-26). They err on the side of treating a message as an emergency.

const norm = (t: string) => t.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();

// Clear signs that someone needs help now. Any of these makes the message an emergency.
const STRONG: RegExp[] = [
  /\binjur(ed|y|ies)\b/, /\bbleed(ing|s)?\b/, /\bunconscious\b/, /\bfaint(ed|ing)?\b/, /\bpassed out\b/, /\bcollaps(e|ed|es|ing)\b/,
  /\bheart attack\b/, /\bchest pain\b/, /\b(can't|cannot|can not|unable to) breathe\b/, /\bnot breathing\b/, /\bchoking\b/, /\bseizure\b/,
  /\bstroke\b/, /\baccident\b/, /\bsnake ?bite\b/, /\bbitten\b/, /\bdrown(ing|ed)?\b/, /\bpoison(ed|ing)?\b/, /\boverdose\b/,
  /\bassault(ed)?\b/, /\battack(ed|ing)?\b/, /\bharass(ed|ment|ing)?\b/, /\bmolest(ed|ing)?\b/, /\bstalk(ed|ing)\b/, /\bthreaten(ed|ing)?\b/,
  /\b(knife|gun|weapon)\b/, /\bfire\b(?! (exit|exits|extinguisher|extinguishers|drill|safety|assembly|point))/, /\bon fire\b/,
  /\bmissing (person|child|kid|friend|teammate|member)\b/, /\blost (child|kid)\b/, /\bsuicid/, /\bkill (myself|me)\b/, /\bhurt (myself|me)\b/,
  /\bsos\b/, /\bhelp me\b/, /\bneed help (now|immediately|urgently|fast)\b/, /\burgent(ly)? help\b/, /\bin danger\b/, /\bunsafe\b/,
];
// Words that mention emergencies but may be a question about the service ("what is the emergency number?").
const WEAK: RegExp[] = [/\bemergenc(y|ies)\b/, /\bambulance\b/, /\bpolice\b/, /\bmedical (help|emergency|attention)\b/, /\bdanger\b/];
// A question asking for the emergency contacts themselves.
const ASKS_FOR_CONTACTS = /^(what|what's|whats|where|which|who|how|is there|are there|tell me|show me|list|give me|can you (tell|give|share)|i want to know)\b.*\b(number|numbers|contact|contacts|phone|helpline|desk|room|centre|center|point)\b/;

export type EmergencyClass = "emergency" | "informational" | null;

export function classifyEmergency(text: string): EmergencyClass {
  const t = norm(text);
  if (STRONG.some((re) => re.test(t))) return "emergency";
  const weak = WEAK.some((re) => re.test(t));
  if (weak) return ASKS_FOR_CONTACTS.test(t) ? "informational" : "emergency";
  if (/\b(first aid|helpline|security desk|control room)\b/.test(t) && ASKS_FOR_CONTACTS.test(t)) return "informational";
  return null;
}

/** The person asks for a human (FR-HD-09). */
export function wantsHuman(text: string): boolean {
  const t = norm(text);
  return /\b(talk|speak|chat|connect|transfer)\b.{0,25}\b(human|person|someone|agent|staff|support|organi[sz]er|team)\b/.test(t)
    || /\b(real|live) (person|human|agent)\b/.test(t)
    || /\b(raise|open|create|file|log)\b.{0,15}\b(ticket|complaint|support request)\b/.test(t)
    || /^(human|agent|support|person|operator)[.!?]*$/.test(t);
}

// Attempts to change how the assistant works or to pull data about other people in bulk. They are refused without
// calling the model. (The tools could not return such data anyway; this keeps the attempt visible in the log.)
const INJECTION: RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(instruction|instructions|prompt|rules|guidelines|policy|policies|restrictions)\b/,
  /\b(system|developer|hidden|initial)\s*(prompt|message|instruction)s?\b/,
  /\b(developer|god|admin|debug|jailbreak)\s*mode\b/, /\bjailbreak\b/, /\bdan\b.{0,10}\bmode\b/,
  /\b(you are|you're) now\b/, /\bpretend (to be|you are)\b/,
  /\bact as\b.{0,15}\b(admin|administrator|developer|system|management|organi[sz]er|support staff|database)\b/,
  /\b(list|show|give|reveal|dump|export|send|share|print)\b.{0,30}\b(all|every|everyone's|everybody's|other|others'?)\b.{0,30}\b(participants?|users?|people|startups?|teams?|jurors?|jury members?|volunteers?|delegates?|members?|accounts?)\b/,
  /\b(all|every|other)\b.{0,20}\b(phone numbers|mobile numbers|emails?|email addresses|contacts|passwords?|scores|rankings?|applications)\b/,
  /\b(database|sql|select \*|api key|access token|credentials)\b/,
  /<\/?\s*(system|assistant|tool|instructions?)\s*>/,
];

export function looksLikeInjection(text: string): boolean {
  const t = norm(text);
  return INJECTION.some((re) => re.test(t));
}
