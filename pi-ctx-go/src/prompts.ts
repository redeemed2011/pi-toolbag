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
  "The open questions are settled. Claim the destination is met.",
  "Name the products. If a product is a file, name its path. A slash command is not a path.",
  "Do not record a destination.",
].join("\n");
