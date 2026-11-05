export const DRAFT_PROMPT = [
  "Reply with only the CTX destination, at most two lines.",
  "Do not record it. The operator approves it through the extension.",
].join("\n");

export const QUESTION_PROMPT = [
  "Work the open CTX questions in frontier order, oldest first.",
  "Settle a question only by recording a later CTX record that supersedes it.",
  "Closing the claim does not settle it. Do not supersede a question marked for the operator.",
  "Do not stop this loop.",
].join("\n");

export const CLAIM_PROMPT = [
  "Name the result of the destination.",
  "If that result is a file, name its path. A slash command is not a path.",
  "A file that only describes the destination is not the result.",
  "Do not record a destination.",
].join("\n");

export function workPrompt(destination: string): string {
  return [
    "The open questions are settled. Do the destination's work.",
    "The destination is not met until its result exists.",
    "Destination:",
    destination,
    "Do not claim it is met. A file that only describes the destination is not the result.",
  ].join("\n");
}

export function rejectionPrompt(destination: string, summary: string): string {
  return [
    "The judge said the destination is not met.",
    `Judge: ${summary}`,
    "Destination:",
    destination,
    "Do the missing work. Do not claim it is met yet. A file that only describes the destination is not the result.",
  ].join("\n");
}
