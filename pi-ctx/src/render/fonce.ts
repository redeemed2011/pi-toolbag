import type { Config } from "../config.js";
import { findLastCompactionIndex } from "../progress.js";
import { FOOTER_TAG, type Entry, type JudgmentRecord, type SessionFold } from "../types.js";
import { INJECT_CAP } from "./estimate.js";
import { renderConstitutionOnly } from "./inject.js";

export type AgentMessage = {
	role?: string;
	customType?: string;
	content?: unknown;
	display?: boolean;
	timestamp?: number;
	[key: string]: unknown;
};

export function isFirstCallAfterCompact(sessionBranch: Entry[]): boolean {
	const last = findLastCompactionIndex(sessionBranch);
	if (last < 0) return false;
	for (let i = last + 1; i < sessionBranch.length; i++) {
		const entry = sessionBranch[i];
		const role = entry.message?.role;
		if (entry.type === "message" && role === "assistant") return false;
	}
	return true;
}

export function stripFooter(messages: AgentMessage[]): AgentMessage[] {
	return messages.filter((m) => m.customType !== FOOTER_TAG);
}

/**
 * F-once A: bound + first LLM call after compact only.
 * Append one occupancy constitution after the suffix. Session JSONL unchanged.
 * Do not break tool-call / tool-result pairing (append at end only).
 */
export function applyFonceA(
	requestMessages: AgentMessage[],
	sessionBranch: Entry[],
	session: SessionFold,
	config: Config,
	opts?: { firstKeptId?: string; projectRecords?: JudgmentRecord[] },
): AgentMessage[] {
	const msgs = stripFooter(requestMessages);
	if (!session.bound) return msgs;
	if (!isFirstCallAfterCompact(sessionBranch)) return msgs;
	const firstKeptId =
		opts?.firstKeptId ??
		[...sessionBranch].reverse().find((e) => e.type === "compaction")?.firstKeptEntryId ??
		sessionBranch[sessionBranch.length - 1]?.id ??
		"";
	const footer = renderConstitutionOnly({
		session,
		branch: sessionBranch,
		firstKeptId,
		config,
		projectRecords: opts?.projectRecords,
	});
	msgs.push({
		role: "custom",
		customType: FOOTER_TAG,
		content: footer.text,
		display: false,
		timestamp: Date.now(),
	});
	return msgs;
}

export function sendGuardTokens(usageTokens: number, sessionBranch: Entry[], session: SessionFold): number {
	if (session.bound && isFirstCallAfterCompact(sessionBranch)) return usageTokens + INJECT_CAP;
	return usageTokens;
}
