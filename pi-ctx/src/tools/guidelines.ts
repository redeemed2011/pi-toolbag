/** Duties for the per-turn status line. The line is state; these say when to call. */
export const GET_GUIDELINE =
	"If the ctx status line is absent, do not call ctx_get. If it is present and this thread has no constraint bodies yet, call ctx_get once with no id. Do not call it again. Do not use ctx_get to search.";

export const ZOOM_GUIDELINE =
	"Use ctx_zoom only for an id already named in the thread when its body was not included.";

export const FRONTIER_GUIDELINE =
	"If the ctx status line says claim_empty=1 and you are starting work, call ctx_frontier once. Do not dump the frontier into the reply or the inject.";

export const CLAIM_GUIDELINE =
	"If ctx_frontier shows a question you are about to do, claim it with ctx_claim. If none fits, leave the claim empty. If the status line says claim_not_live=1 or claim_blocked=1, close with ctx_claim before claiming another. Do not silent-swap a live claim; close first or ask the user to run /ctx claim.";

export const BIND_GUIDELINE =
	"Use ctx_bind when the user asked to create a ctx project or you propose one. Bind always requires HITL; never bind silently. Bind sets the project pointer only; it does not ask to ratify observer notes. Mint law with ctx_record.";

export const RECORD_GUIDELINE =
	"Use ctx_record for a constraint, decision, or question that should survive the next compaction. Do not record turn notes or observations. Never overwrite. Constraints require applies_to and directive. Missing applies_to refuses; it never defaults to all. live_conflict refuses in print; TUI selects which to supersede. GATE overflow refuses in print; TUI select is refuse-first vs supersede/split. Evidence copies a file into the project blob store by hash, with size, producer, and expiry. It is not a constraint and does not count toward the gate. An expired file marks that support stale and does not retire the citing constraint. A filename in a body is not evidence. Point citation_target at the evidence id. Evidence cannot supersede or block.";
