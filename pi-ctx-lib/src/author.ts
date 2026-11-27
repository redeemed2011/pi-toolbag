export const OPERATOR = "operator";

let includeAuthorDefault = false;

export function configureAuthorDisplay(enabled: boolean): void {
	includeAuthorDefault = enabled;
}

export function authorDisplayEnabled(override?: boolean): boolean {
	return override ?? includeAuthorDefault;
}

export function agentAuthor(name: string, key: string): string {
	return `agent ${name.replace(/\s+/g, " ").trim().slice(0, 80)} (${key})`;
}

export function authorOf(item: { author?: string; session?: string }): string {
	const stamped = item.author?.trim();
	if (stamped) return stamped;
	const session = item.session ?? "";
	if (session.startsWith("operator-")) return OPERATOR;
	if (/^\d+$/.test(session)) return "an agent, not named";
	return "outside Brazos";
}

export function byAgent(item: { author?: string; session?: string }): boolean {
	const author = authorOf(item);
	return author.startsWith("agent ") || author === "an agent, not named";
}
