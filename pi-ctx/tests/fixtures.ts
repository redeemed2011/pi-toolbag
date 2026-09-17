import type { Entry, JudgmentRecord, Observation } from "../src/types.js";

const TS = "2026-09-14T10:00:00.000Z";

export function userMsg(id: string, text: string): Entry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: TS,
		message: { role: "user", content: [{ type: "text", text }] },
	};
}

export function assistantMsg(id: string, text: string): Entry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: TS,
		message: { role: "assistant", content: [{ type: "text", text }] },
	};
}

export function assistantToolCall(id: string, toolCallId = `${id}-call`): Entry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: TS,
		message: {
			role: "assistant",
			content: [{ type: "toolCall", id: toolCallId, name: "bash", arguments: { command: "ls" } }],
		},
	};
}

export function toolResult(id: string, text = "ok"): Entry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: TS,
		message: { role: "toolResult", toolName: "bash", content: [{ type: "text", text }] },
	};
}

export function bashHidden(id: string, command = "secret"): Entry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: TS,
		message: { role: "bashExecution", command, output: "x".repeat(400), excludeFromContext: true },
	};
}

export function compaction(id: string, firstKeptEntryId: string, summary = "old"): Entry {
	return { type: "compaction", id, parentId: null, timestamp: TS, summary, firstKeptEntryId };
}

export function recorded(id: string, coversUpToId: string, headlines: string[]): Entry {
	return {
		type: "custom",
		id,
		customType: "ctx.observations.recorded",
		data: {
			coversUpToId,
			observations: headlines.map((headline, i) => ({
				id: `${id}-${i}`,
				headline,
				body: headline,
				coversUpToId,
				ts: TS,
				session: "s",
			})),
		},
	};
}

export function constraint(id: string, body: string, applies_to: "all" | string[] = "all"): JudgmentRecord {
	return {
		id,
		type: "constraint",
		ts: TS,
		session: "s",
		headline: id,
		body,
		applies_to,
	};
}

export function question(id: string, body: string): JudgmentRecord {
	return { id, type: "question", ts: TS, session: "s", headline: id, body };
}

export function obs(id: string, headline: string, coversUpToId: string, about?: string): Observation {
	return { id, headline, body: headline, coversUpToId, ts: TS, session: "s", about_claim_id: about };
}
