import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { foldLive, foldSession, resolveOccupancy } from "../fold.js";
import { applyPendingInject, pendingReplaceSection } from "../promoter/inject.js";
import { applyFonceA } from "../render/fonce.js";
import { applyStatusToSystem, statusLine } from "../render/status.js";
import type { Runtime } from "../runtime.js";
import { CTX_STATUS_INJECT, type Entry } from "../types.js";

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
	pi.on(
		"context",
		((
			event: { messages: unknown[] },
			ctx: { sessionManager: { getBranch: () => Entry[] } },
		) => {
			if (!runtime.enabled || runtime.config.passive) return;
			const branch = ctx.sessionManager.getBranch();
			const session = foldSession(branch, runtime.sessionId);
			const live = session.bound ? foldLive(runtime.projectRecords ?? []) : null;
			const pending = live ? pendingReplaceSection(live) : "";
			const fonce = applyFonceA(event.messages as never, branch, session, runtime.config, session.bound
				? { projectRecords: runtime.projectRecords }
				: undefined);
			const withPending = applyPendingInject(fonce, pending);
			return {
				messages: withPending.filter((m) => (m as { customType?: string }).customType !== CTX_STATUS_INJECT),
			};
		}) as never,
	);
	pi.on(
		"context_with_system",
		((
			event: { messages: unknown[] },
			ctx: { sessionManager: { getBranch: () => Entry[] } },
		) => {
			if (!runtime.enabled || runtime.config.passive) return;
			const line = statusLineFor(runtime, ctx.sessionManager.getBranch());
			return { messages: applyStatusToSystem(event.messages as never, line) };
		}) as never,
	);
}
