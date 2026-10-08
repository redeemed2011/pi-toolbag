import { frontierItems } from "../fold.js";
import type { AgentMessage } from "./fonce.js";
import { claimedBodyOrEmpty } from "./gated-edge.js";
import { CTX_STATUS_INJECT, type LiveSet, type Occupancy } from "../types.js";

/**
 * Per-turn state. Absence means do not call ctx. Not the constitution.
 * open_questions is the uncapped frontierItems count, not frontier_elided and not the frontier cap.
 * claim_blocked is the claimed question only, not the constitution's blocked count.
 */
export function statusLine(opts: { occupancy: Occupancy; claimedId: string | null; live: LiveSet }): string {
	const claimed = claimedBodyOrEmpty(opts.live, opts.claimedId);
	const open = frontierItems(opts.live, opts.claimedId).length;
	const claimedPart = opts.claimedId ? ` claimed=${claimedToken(opts.claimedId)}` : "";
	return `ctx bound=1 occupancy=${opts.occupancy} claim_empty=${claimed.claim_empty} claim_not_live=${claimed.claim_not_live} claim_blocked=${claimed.blocked} open_questions=${open}${claimedPart}`;
}

function claimedToken(id: string): string {
	return /^[A-Za-z0-9._:-]+$/.test(id) ? id : "unsafe";
}

export function applyStatusInject(messages: AgentMessage[], line: string): AgentMessage[] {
	const stripped = messages.filter((m) => m.customType !== CTX_STATUS_INJECT);
	if (!line) return stripped;
	stripped.push({
		role: "user",
		customType: CTX_STATUS_INJECT,
		content: line,
		display: false,
	});
	return stripped;
}
