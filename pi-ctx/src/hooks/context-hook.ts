import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { foldLive, foldSession, resolveOccupancy } from "../fold.js";
import { applyPendingInject, pendingReplaceSection } from "../promoter/inject.js";
import { applyFonceA, type AgentMessage } from "../render/fonce.js";
import { applyStatusToSystem, statusLine } from "../render/status.js";
import type { Runtime } from "../runtime.js";
import { CTX_STATUS_INJECT, type Entry } from "../types.js";

function branchOf(ctx: ExtensionContext): Entry[] {
	return ctx.sessionManager.getBranch() as Entry[];
}

function requestMessages(messages: readonly unknown[]): AgentMessage[] {
	return messages as AgentMessage[];
}

function statusLineFor(runtime: Runtime, branch: Entry[]): string {
	const session = foldSession(branch, runtime.sessionId);
	if (!session.bound) return "";
	return statusLine({
		occupancy: resolveOccupancy(session, runtime.config.occupancy),
		claimedId: session.claimedId,
		live: foldLive(runtime.projectRecords ?? []),
	});
}

export function registerContextHook(pi: ExtensionAPI, runtime: Runtime): void {
	pi.on("context", (event, ctx) => {
		if (!runtime.enabled || runtime.config.passive) return;
		const branch = branchOf(ctx);
		const session = foldSession(branch, runtime.sessionId);
		const live = session.bound ? foldLive(runtime.projectRecords ?? []) : null;
		const pending = live ? pendingReplaceSection(live) : "";
		const fonce = applyFonceA(
			requestMessages(event.messages),
			branch,
			session,
			runtime.config,
			session.bound ? { projectRecords: runtime.projectRecords } : undefined,
		);
		const withPending = applyPendingInject(fonce, pending);
		return {
			messages: withPending.filter((m) => m.customType !== CTX_STATUS_INJECT),
		} as { messages: typeof event.messages };
	});
	pi.on("context_with_system", (event, ctx) => {
		if (!runtime.enabled || runtime.config.passive) return;
		const line = statusLineFor(runtime, branchOf(ctx));
		return { messages: applyStatusToSystem(event.messages, line) };
	});
}
