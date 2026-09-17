import type { Entry } from "./types.js";

function pad(n: number): string {
	return n.toString().padStart(2, "0");
}

export function nowTimestamp(): string {
	const d = new Date();
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((b): b is { type: string; text: string } => !!b && b.type === "text" && typeof b.text === "string")
		.map((b) => b.text)
		.join("\n");
}

export function serializeSourceEntries(entries: Entry[]): string {
	const parts: string[] = [];
	for (const entry of entries) {
		const role = entry.message?.role ?? entry.type;
		const body =
			textOf(entry.message?.content) ||
			textOf(entry.content) ||
			(typeof entry.summary === "string" ? entry.summary : "") ||
			(entry.message?.command ? `$ ${entry.message.command}\n${entry.message.output ?? ""}` : "");
		parts.push(`[${role} ${entry.id}]\n${body}`.trim());
	}
	return parts.join("\n\n");
}
