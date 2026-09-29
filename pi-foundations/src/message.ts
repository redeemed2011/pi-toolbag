/** Drop a leading YAML frontmatter block. The body is what the turn must follow. */
export function stripFrontmatter(markdown: string): string {
	if (!markdown.startsWith("---\n")) return markdown.trim();
	const end = markdown.indexOf("\n---\n", 4);
	if (end === -1) return markdown.trim();
	return markdown.slice(end + 5).trim();
}

/**
 * User message for one ritual turn. The skill body is inlined so the procedure
 * is in the turn, not waiting on the model to open SKILL.md.
 */
export function ritualTurn(body: string, topic: string): string {
	const focus = topic.trim();
	const head = focus
		? `Topic: ${focus}`
		: "No topic argument. Use the current conversation. If there is no request yet, ask question 0 and stop.";
	return [
		head,
		"",
		"You are in this ritual now. Follow it before planning, research, design, or code.",
		"The contract file is the finished state. ctx records, if any, come after the user confirms the file.",
		"",
		body.trim(),
	].join("\n");
}
