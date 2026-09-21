import type { AgentMessage } from "../render/fonce.js";
import { CTX_PENDING_INJECT, type LiveSet } from "../types.js";

export function pendingReplaceSection(live: LiveSet): string {
	const open = live.pendingReplaces.filter((p) => live.live.has(p.id));
	if (open.length === 0) return "";
	const lines = [`## Pending replace (decide now)`, `n=${open.length}`];
	for (const p of open) {
		const liveId = p.parent ?? "";
		const liveRec = liveId ? live.byId.get(liveId) : undefined;
		const liveHead = liveRec?.headline ?? liveId;
		lines.push(`- ${p.id}: live ${liveId} "${liveHead}" <- "${p.body.slice(0, 280)}"`);
	}
	return lines.join("\n");
}

export function applyPendingInject(messages: AgentMessage[], section: string): AgentMessage[] {
	const stripped = messages.filter((m) => m.customType !== CTX_PENDING_INJECT);
	if (!section) return stripped;
	stripped.push({
		role: "user",
		customType: CTX_PENDING_INJECT,
		content: section,
		display: false,
	});
	return stripped;
}
