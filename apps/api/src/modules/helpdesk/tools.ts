// Server-side Help Desk tools (FR-HD-05…07, -13, -20; PRD §8.3 "scoped tools").
// Each tool:
// - checks the requester's role and edition access itself (the model cannot choose a tool or a person);
// - takes no person or record identifier from the question — only the authenticated requester's own id;
// - returns only the requester's own records or published official information visible to their audience.
// No tool reads AI ranking data, jury scores of others, other participants' contacts, or applications of others.
import type { EventInfo, Role } from "@sj/contracts";
import type { Db } from "../../db/client.js";
import type { Principal } from "../../platform/principal.js";
import { eventInfo } from "../content/service.js";
import { juryHome } from "../jury/service.js";
import { myApplications } from "../registration/service.js";
import { emergencyContacts, myTickets } from "../support/service.js";
import { myAssignment, myVolunteer } from "../volunteers/service.js";

/** Who is asking. Channel adapters (the app today) build this from an authenticated identity, never from text. */
export type HelpDeskIdentity = { userId: string; roles: ReadonlySet<Role>; editionAccess: ReadonlySet<number> };
export type ToolContext = { db: Db; who: HelpDeskIdentity; year: number; question: string; now: Date };
export type ToolOutput = { tool: string; data: unknown; items: number };

type Tool = {
  name: string;
  /** Permission and relationship check for this requester. */
  allowed: (c: ToolContext) => boolean;
  /** When the question is about this topic. event_info_search always runs. */
  topic: RegExp | null;
  run: (c: ToolContext) => Promise<{ data: unknown; items: number }>;
};

const asPrincipal = (who: HelpDeskIdentity) => ({ account: { id: who.userId } }) as unknown as Principal;
const hasAccess = (c: ToolContext) => c.who.editionAccess.has(c.year);
const has = (c: ToolContext, ...roles: Role[]) => roles.some((r) => c.who.roles.has(r));

// ---------------------------------------------------------------- official information search (FR-HD-14)
type Entry = { section: string; title: string; text: string };

const STOP = new Set(["the", "a", "an", "is", "are", "of", "to", "in", "on", "for", "and", "or", "at", "what", "where", "when", "who", "how", "my", "me",
  "i", "do", "does", "can", "will", "be", "there", "it", "this", "that", "with", "about", "please", "tell", "show", "give", "know", "want", "need", "you"]);
const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));

function flatten(e: EventInfo): Entry[] {
  const out: Entry[] = [];
  for (const d of e.schedule) {
    for (const i of d.items) {
      const b = i.body;
      out.push({ section: `Programme · ${d.label}`, title: i.title,
        text: [b.startTime ? `${b.startTime}${b.endTime ? `–${b.endTime}` : ""}` : "Time to be announced", b.venue, b.details, b.tentative ? "Tentative" : null].filter(Boolean).join(". ") });
    }
    for (const m of d.meals) {
      const b = m.body;
      out.push({ section: `Food · ${d.label}`, title: `${b.meal}: ${m.title}`,
        text: [b.startTime ? `${b.startTime}${b.endTime ? `–${b.endTime}` : ""}` : null, b.venue, b.menu.join(", "), b.notes].filter(Boolean).join(". ") });
    }
  }
  for (const v of e.venues) out.push({ section: "Venues", title: v.title, text: [v.body.address, v.body.notes, v.body.mapUrl].filter(Boolean).join(". ") });
  for (const [section, list] of [["Accommodation", e.accommodation], ["Travel and transport", e.travel], ["Safety", e.safety], ["Information", e.pages]] as const) {
    for (const x of list) out.push({ section, title: x.title, text: [x.body.text, x.body.address].filter(Boolean).join(". ") });
  }
  for (const c of e.emergency) out.push({ section: "Emergency contacts", title: c.title, text: [c.phone, c.available, c.notes].filter(Boolean).join(". ") });
  for (const d of e.documents) out.push({ section: "Documents", title: d.title, text: d.description ?? "Open it in the app's event information." });
  out.push({ section: "Event", title: e.edition.name, text: e.edition.days.map((d) => d.label).join("; ") });
  return out;
}

export function searchEntries(entries: Entry[], question: string, limit = 5): Entry[] {
  const q = new Set(words(question));
  if (!q.size) return [];
  return entries
    .map((en) => {
      const titleWords = words(`${en.section} ${en.title}`);
      const bodyWords = words(en.text);
      let score = 0;
      for (const w of q) {
        if (titleWords.some((x) => x === w || (w.length > 3 && x.startsWith(w.slice(0, -1))))) score += 3;
        if (bodyWords.some((x) => x === w || (w.length > 3 && x.startsWith(w.slice(0, -1))))) score += 1;
      }
      return { en, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => ({ ...x.en, text: x.en.text.slice(0, 800) }));
}

// ---------------------------------------------------------------- the tool set
export const TOOLS: Tool[] = [
  {
    name: "event_info_search", topic: null, allowed: () => true,
    async run(c) {
      const info = await eventInfo(c.db, { kind: "participant", userId: c.who.userId }, c.year);
      const found = searchEntries(flatten(info), c.question);
      return { data: found, items: found.length };
    },
  },
  {
    name: "emergency_contacts", topic: /\b(emergenc|ambulance|police|medical|first aid|helpline|security|doctor|hospital|contact number)/i, allowed: () => true,
    async run(c) {
      const contacts = await emergencyContacts(c.db, c.who.userId, c.year);
      return { data: contacts, items: contacts.length };
    },
  },
  {
    name: "my_application_status", topic: /\b(application|applied|apply|status|selected|selection|result|shortlist|registration|registered|rejected)\b/i,
    allowed: (c) => has(c, "startup_team_leader"),
    async run(c) {
      const a = await myApplications(c.db, c.who.userId, c.now);
      const data = a.startup ? { startup: a.startup.name, applications: a.applications.map((x) => ({ edition: x.edition, status: x.status })) } : null;
      return { data, items: data ? data.applications.length : 0 };
    },
  },
  {
    name: "my_startup", topic: /\b(my (startup|team|company)|team members?|our (startup|team))\b/i,
    allowed: (c) => has(c, "startup_team_leader", "startup_team_member"),
    async run(c) {
      const [s] = await c.db<{ id: string; name: string; city: string | null }[]>`
        select s.id, s.name, s.city from startup_memberships m join startups s on s.id = m.startup_id where m.user_id = ${c.who.userId} limit 1`;
      if (!s) return { data: null, items: 0 };
      const team = await c.db<{ name: string; position: string }[]>`
        select u.full_name as name, m.position from startup_memberships m join user_accounts u on u.id = m.user_id
        where m.startup_id = ${s.id} order by (m.position <> 'leader'), u.full_name`;
      return { data: { startup: s.name, city: s.city, team: [...team] }, items: 1 };
    },
  },
  {
    name: "my_volunteer", topic: /\bvolunteer\b/i,
    allowed: (c) => hasAccess(c) && has(c, "startup_team_leader", "jury_member"),
    async run(c) {
      const v = await myVolunteer(c.db, asPrincipal(c.who), c.year);
      return { data: v.volunteer, items: v.volunteer ? 1 : 0 };
    },
  },
  {
    name: "my_assignment", topic: /\b(assign|assignment|assigned|my (startup|jury|target)|who (do|am) i (help|support|look after)|duty|responsibilit)/i,
    allowed: (c) => hasAccess(c) && has(c, "volunteer"),
    async run(c) {
      const a = await myAssignment(c.db, asPrincipal(c.who), c.year);
      return { data: a.assignment, items: a.assignment ? 1 : 0 };
    },
  },
  {
    name: "my_jury_schedule", topic: /\b(pitch|pitching|jury|assigned startups?|evaluat|scor|rubric|my startups)\b/i,
    allowed: (c) => hasAccess(c) && has(c, "jury_member"),
    async run(c) {
      try {
        const h = await juryHome(c.db, asPrincipal(c.who), c.year);
        // Only the juror's own assignments, schedule and the state of their own evaluations (FR-JRY-15).
        const data = {
          currentPitch: h.currentPitch ? { startup: h.currentPitch.startupName, venue: h.currentPitch.venue, assignedToYou: h.currentPitch.assigned } : null,
          startups: h.startups.map((s) => ({ startup: s.name, pitch: s.slot ? { startsAt: s.slot.startsAt, venue: s.slot.venue, state: s.slot.state } : null,
            yourEvaluation: s.evaluation ? s.evaluation.state : "not started" })),
          scoringOpen: !!h.rubric,
        };
        return { data, items: data.startups.length };
      } catch {
        return { data: null, items: 0 };
      }
    },
  },
  {
    name: "my_tickets", topic: /\b(ticket|tickets|request|complaint|support|reference|sj-\d+)\b/i, allowed: () => true,
    async run(c) {
      const t = await myTickets(c.db, c.who.userId, c.year);
      const data = t.slice(0, 5).map((x) => ({ ref: x.ref, subject: x.subject, status: x.status }));
      return { data, items: data.length };
    },
  },
];

/** Picks the tools this question needs, among those this requester may use (data minimisation). */
export function selectTools(c: ToolContext): Tool[] {
  return TOOLS.filter((t) => t.allowed(c) && (t.topic === null || t.topic.test(c.question)));
}

export async function runTools(c: ToolContext): Promise<{ outputs: ToolOutput[]; errors: string[] }> {
  const outputs: ToolOutput[] = [];
  const errors: string[] = [];
  for (const t of selectTools(c)) {
    try {
      const r = await t.run(c);
      outputs.push({ tool: t.name, data: r.data, items: r.items });
    } catch (err) {
      errors.push(`${t.name}: ${(err as Error).message}`.slice(0, 200));
    }
  }
  return { outputs, errors };
}
