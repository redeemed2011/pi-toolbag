import { estimateTokens as estimateMessageTokens } from "@earendil-works/pi-coding-agent";
import { injectTokens } from "./render/estimate.js";
import type { Entry } from "./types.js";

function excluded(entry: Entry): boolean {
	if (entry.excludeFromContext === true) return true;
	if (entry.message?.excludeFromContext === true) return true;
	return false;
}

function messageOf(entry: Entry): { role?: string } | undefined {
	if (entry.message && typeof entry.message === "object") return entry.message;
	return undefined;
}

/**
 * Source entries that participate in the conversation clock.
 * Custom ledger rows (`type: "custom"`) do not.
 */
export function isSourceEntry(entry: Entry): boolean {
	if (entry.type === "message" || entry.type === "custom_message" || entry.type === "branch_summary") {
		return true;
	}
	const role = messageOf(entry)?.role;
	return role === "bashExecution" || entry.type === "bashExecution";
}

/** Pi findCutPoint: never cut at tool results. */
export function isValidCutPoint(entry: Entry): boolean {
	if (entry.type === "custom_message" || entry.type === "branch_summary" || entry.type === "compaction") {
		return true;
	}
	const role = messageOf(entry)?.role ?? (entry.type === "bashExecution" ? "bashExecution" : undefined);
	if (!role) return false;
	if (role === "toolResult") return false;
	return (
		role === "user" ||
		role === "assistant" ||
		role === "bashExecution" ||
		role === "custom" ||
		role === "branchSummary" ||
		role === "compactionSummary"
	);
}

export function estimateEntryTokens(entry: Entry): number {
	if (excluded(entry)) return 0;
	if (!isSourceEntry(entry)) return 0;
	if (entry.type === "message" && entry.message) {
		return estimateMessageTokens(entry.message as Parameters<typeof estimateMessageTokens>[0]);
	}
	if (entry.type === "custom_message" && entry.content != null) {
		const content = entry.content;
		if (typeof content === "string") return injectTokens(content);
		if (Array.isArray(content)) {
			let chars = 0;
			for (const block of content as Array<{ type?: string; text?: string }>) {
				if (block?.type === "text" && typeof block.text === "string") chars += block.text.length;
			}
			return Math.ceil(chars / 4);
		}
	}
	if (entry.type === "branch_summary" && typeof entry.summary === "string") {
		return injectTokens(entry.summary);
	}
	if (entry.type === "bashExecution" || messageOf(entry)?.role === "bashExecution") {
		const cmd = entry.message?.command ?? "";
		const out = entry.message?.output ?? "";
		return injectTokens(`${cmd}${out}`);
	}
	return 0;
}
