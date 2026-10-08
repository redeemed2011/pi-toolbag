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

const STATUS_START = "\n\n<ctx-status>\n";
const STATUS_END = "\n</ctx-status>";

function withoutStatusBlock(text: string): string {
	const at = text.indexOf(STATUS_START);
	return at < 0 ? text : text.slice(0, at);
}

/**
 * Carry the per-turn line on the leading system message.
 * A user or custom message would reach the model as a user utterance.
 * Providers drop every system message except the first, so the line has to live there.
 */
export function applyStatusToSystem(messages: AgentMessage[], line: string): AgentMessage[] {
	const stripped = messages.filter((m) => m.customType !== CTX_STATUS_INJECT);
	const head = stripped[0];
	if (!head || head.role !== "system" || typeof head.content !== "string") return stripped;
	const base = withoutStatusBlock(head.content);
	if (!line) {
		if (base === head.content) return stripped;
		return [{ ...head, content: base }, ...stripped.slice(1)];
	}
	return [{ ...head, content: `${base}${STATUS_START}${line}${STATUS_END}` }, ...stripped.slice(1)];
}
