import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { foldLive, foldSession } from "../fold.js";
import { applyPendingInject, pendingReplaceSection } from "../promoter/inject.js";
import { applyFonceA } from "../render/fonce.js";
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
			const pending = session.bound
				? pendingReplaceSection(foldLive(runtime.projectRecords ?? []))
				: "";
			if (!session.bound) {
				return {
					messages: applyPendingInject(
						applyFonceA(event.messages as never, branch, session, runtime.config),
						pending,
					),
				};
			}
			return {
				messages: applyPendingInject(
					applyFonceA(event.messages as never, branch, session, runtime.config, {
						projectRecords: runtime.projectRecords,
					}),
					pending,
				),
			};
		}) as never,
	);
}
