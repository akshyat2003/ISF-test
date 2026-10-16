import { ApplicationForm, type PublicEdition } from "@sj/contracts";
import type { Db } from "../../db/client.js";
import { AppError } from "../../platform/errors.js";

export type EditionRow = {
  id: number;
  name: string;
  preEventOn: string | null;
  eventStartsOn: string | null;
  eventEndsOn: string | null;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  closesAtConfirmed: boolean;
  selectionLimit: number | null;
  applicationForm: ApplicationForm;
};

export async function listEditions(db: Db): Promise<EditionRow[]> {
  const rows = await db<(Omit<EditionRow, "applicationForm"> & { applicationForm: unknown })[]>`
    select id, name,
           to_char(pre_event_on, 'YYYY-MM-DD') as "preEventOn",
           to_char(event_starts_on, 'YYYY-MM-DD') as "eventStartsOn",
           to_char(event_ends_on, 'YYYY-MM-DD') as "eventEndsOn",
           registration_opens_at as "registrationOpensAt",
           registration_closes_at as "registrationClosesAt",
           closes_at_confirmed as "closesAtConfirmed",
           selection_limit as "selectionLimit",
           application_form as "applicationForm"
    from event_editions order by id`;
  // A malformed form configuration fails closed: nothing is served or accepted until it is fixed (TBD-39).
  return rows.map((r) => {
    const form = ApplicationForm.safeParse(r.applicationForm);
    // Configuration error, not user input: a plain Error becomes a 500 and the details stay in the server log.
    if (!form.success) throw new Error(`event_editions.application_form of edition ${r.id} is invalid: ${form.error.message}`);
    return { ...r, applicationForm: form.data };
  });
}

export async function getEdition(db: Db, year: number): Promise<EditionRow> {
  const e = (await listEditions(db)).find((x) => x.id === year);
  if (!e) throw new AppError(404, "edition_not_found", "Not found", `There is no ${year} edition`);
  return e;
}

/** Server-side source of truth for whether an edition accepts applications (FR-REG-03/04, AT-08). */
export function registrationOpen(e: EditionRow, now: Date): boolean {
  if (e.registrationOpensAt && now < e.registrationOpensAt) return false;
  if (e.registrationClosesAt && now > e.registrationClosesAt) return false;
  return true;
}

export function toPublic(e: EditionRow, now: Date): PublicEdition {
  return {
    year: e.id,
    name: e.name,
    preEventOn: e.preEventOn,
    eventStartsOn: e.eventStartsOn,
    eventEndsOn: e.eventEndsOn,
    registration: {
      open: registrationOpen(e, now),
      closesAt: e.registrationClosesAt?.toISOString() ?? null,
      closesAtConfirmed: e.closesAtConfirmed,
    },
    applicationForm: e.applicationForm,
  };
}
