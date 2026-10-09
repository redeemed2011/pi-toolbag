import type { Entry } from "../types.js";

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(b): b is { type: string; text: string } =>
				!!b && typeof b === "object" && (b as { type?: string }).type === "text" && typeof (b as { text?: unknown }).text === "string",
		)
		.map((b) => b.text)
		.join("\n");
}

export function extractUserQuotes(branch: Entry[]): string[] {
	const out: string[] = [];
	for (const entry of branch) {
		if (entry.type !== "message") continue;
		if (entry.message?.role !== "user") continue;
		const text = textOf(entry.message.content).replace(/\s+/g, " ").trim();
		if (text) out.push(text);
	}
	return out;
}

export function normalizeWs(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Verbatim: quote is a contiguous substring of some user-role line (whitespace-normalized). */
export function quoteInCorpus(quote: string, corpus: string[]): boolean {
	const q = normalizeWs(quote);
	if (!q) return false;
	return corpus.some((line) => normalizeWs(line).includes(q));
}

/** User-facing assistant text only. Thinking blocks, tool calls, and other roles are not included. */
export function extractAssistantQuotes(branch: Entry[]): string[] {
	const out: string[] = [];
	for (const entry of branch) {
		if (entry.type !== "message") continue;
		if (entry.message?.role !== "assistant") continue;
		const text = textOf(entry.message.content).replace(/\s+/g, " ").trim();
		if (text) out.push(text);
	}
	return out;
}
