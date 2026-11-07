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

export function judgeErrorPrompt(destination: string, error: string): string {
  return [
    "The judge did not answer.",
    `Judge: ${error}`,
    "Destination:",
    destination,
    "Do the destination's work. Do not claim it is met yet.",
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

export const REMAINDER_PROMPT = [
  "The destination is met. The project is not done.",
  "Read this project's first-questions.md.",
  "Record each still-owed outcome as a CTX question.",
  "Do not record a decision that is already true.",
  "Do not start an outcome that is already deferred.",
  "Do not claim the project is complete on this turn.",
].join("\n");

export const PROJECT_CLAIM_PROMPT = [
  "Name the result of the project.",
  "Name this project's first-questions.md path.",
  "A slash command is not a path.",
  "A KEPT decision is not unfinished by itself.",
  "An outcome with no product and no explicit deferral is still owed.",
  "Do not record a destination.",
].join("\n");

export function projectRejectionPrompt(destination: string, summary: string): string {
  return [
    "The judge said the project is not done.",
    `Judge: ${summary}`,
    "Destination:",
    destination,
    "Do the missing project work. Do not claim the project is done yet.",
  ].join("\n");
}

export function projectErrorPrompt(destination: string, error: string): string {
  return [
    "The judge did not answer.",
    `Judge: ${error}`,
    "Destination:",
    destination,
    "Do the missing project work. Do not claim the project is done yet.",
  ].join("\n");
}
