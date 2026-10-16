// Pure helpers for the jury scoring form (FR-JRY-06…09). The server validates and computes the total again; these only
// help the juror see what is missing and what the total will be before submitting.
import { checkJuryScores, juryTotal, type EvaluationSave, type JuryParameter } from "@sj/contracts";

export type ScoreDraft = Record<string, number>;

/** Parameters still without a score, in rubric order. */
export function unscored(parameters: JuryParameter[], draft: ScoreDraft): JuryParameter[] {
  return parameters.filter((p) => draft[p.key] === undefined);
}

/** The total the server will compute (0–100), or null while any parameter is unscored or out of range. */
export function previewTotal(parameters: JuryParameter[], draft: ScoreDraft): number | null {
  return checkJuryScores(parameters, draft, { complete: true }).length ? null : juryTotal(parameters, draft);
}

/** Only scores for parameters of this rubric; comments only when the rubric allows them and something was written. */
export function toPayload(parameters: JuryParameter[], draft: ScoreDraft, comments: string, commentsAllowed: boolean): EvaluationSave {
  const scores = Object.fromEntries(parameters.filter((p) => draft[p.key] !== undefined).map((p) => [p.key, draft[p.key]!]));
  const text = comments.trim();
  return commentsAllowed && text ? { scores, comments: text } : { scores };
}

/** The whole-number choices offered for a parameter. */
export const choices = (p: JuryParameter) => Array.from({ length: p.max - p.min + 1 }, (_, i) => p.min + i);
