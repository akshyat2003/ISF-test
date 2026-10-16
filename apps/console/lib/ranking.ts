// Plain-language labels for ranking flags (FR-RNK-09, FR-RNK-13) and the registration duplicate flag.
export const FLAG_LABELS: Record<string, string> = {
  possible_prompt_injection: "Text tries to steer the AI (scored normally; check it)",
  missing_data: "Missing answers: review manually",
  ai_output_invalid: "AI output failed validation: review manually",
  ai_unavailable: "AI service unavailable: review manually",
  possible_duplicate_name: "Possible duplicate name",
};
