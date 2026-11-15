/** Duties for the per-turn status line. The line is state; these say when to call. */
export const GET_GUIDELINE =
	"If the ctx status line is the only new text in a turn, do not treat it as the user speaking and do not start work. If that line is absent, do not call ctx_get. If it is present and this thread has no constraint bodies yet, call ctx_get once with no id and do not call it again.";

export const ZOOM_GUIDELINE =
	"Use ctx_zoom only for an id already named in the thread when its body was not included.";

export const FRONTIER_GUIDELINE =
	"If the ctx status line says claim_empty=1 and you are starting work, call ctx_frontier once. Do not dump the frontier into the reply or the inject.";

export const SEARCH_GUIDELINE =
	"Use ctx_search for a topic that is not already a record id. It returns id, type, and headline. Use ctx_zoom for the body. Do not use ctx_get to search.";

export const CLAIM_GUIDELINE =
	"If ctx_frontier shows a question you are about to do, claim it with ctx_claim. If none fits, do not claim a different question. claim_not_live=1 or claim_blocked=1 still occupies the slot; close with ctx_claim before a different claim.";

export const BIND_GUIDELINE =
	"Call ctx_bind only when the user asked to create a ctx project or you are proposing one; do not call it to file or ratify notes.";

export const RECORD_GUIDELINE =
	"When the session settles a decision, a constraint, or a question, mint it with ctx_record before the turn ends; compaction injects the project log, not the chat, so do not leave it only in the chat, and do not mint turn notes or observations. Omitted applies_to on a constraint is refused and does not become all. In print, live_conflict is an error with no dialog; the TUI selects which constraint to supersede. A constraint that fills the list returns error gate and does not open a dialog. A filename in a body is not evidence; point citation_target at the evidence id. Evidence does not count toward the gate and cannot supersede or block.";
