export const DRAFT_PROMPT = [
  "Reply with only the CTX destination, at most two lines.",
  "Do not record it. The operator approves it through the extension.",
].join("\n");

export const QUESTION_PROMPT = [
  "The oldest open CTX question is claimed for this session.",
  "Work that question.",
  "Settle it only by recording a later CTX record that supersedes it.",
  "Closing the claim does not settle it. Do not supersede a question marked for the operator.",
  "Do not stop because the question was unclaimed.",
  "Do not stop this loop.",
].join("\n");

export const CLAIM_PROMPT = [
  "Name the result of the destination.",
  "If that result is a file, name its full path. A path relative to this session is not enough.",
  "A slash command is not a path.",
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

export const RECONCILE_PROMPT = [
  "Compare this session with the live CTX project.",
  "A decision that says an outcome is not built, and has no question for it, must be recorded as a question.",
  "Record a decision this session already made if CTX does not have it.",
  "Record a question this session still owes if CTX does not have it.",
  "Do not record a decision that is already true.",
  "Do not record an outcome this session deferred.",
  "Do not approve a destination.",
  "Do not claim the work is done.",
  "If you cannot record one item, start with Impasse: and name that item.",
].join("\n");

export const PROJECT_CLAIM_PROMPT = [
  "Name the result of the project.",
  "Name each product file by its full path. A path relative to this session is not enough.",
  "A slash command is not a path.",
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
