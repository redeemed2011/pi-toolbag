import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { foldLive, foldSession, resolveOccupancy } from "../fold.js";
import { applyPendingInject, pendingReplaceSection } from "../promoter/inject.js";
import { applyFonceA } from "../render/fonce.js";
import { applyStatusInject, statusLine } from "../render/status.js";
import type { Runtime } from "../runtime.js";
import type { Entry } from "../types.js";

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
			const line = live
				? statusLine({
						occupancy: resolveOccupancy(session, runtime.config.occupancy),
						claimedId: session.claimedId,
						live,
					})
				: "";
			return { messages: applyStatusInject(withPending, line) };
		}) as never,
	);
}
