import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { foldSession } from "../fold.js";
import { applyFonceA } from "../render/fonce.js";
import type { Runtime } from "../runtime.js";
import type { Entry } from "../types.js";

export function registerContextHook(pi: ExtensionAPI, runtime: Runtime): void {
	pi.on("context", ((event: { messages: unknown[] }, ctx: { sessionManager: { getBranch: () => Entry[] } }) => {
		if (!runtime.enabled || runtime.config.passive) return;
		const branch = ctx.sessionManager.getBranch();
		const session = foldSession(branch, runtime.sessionId);
		if (!session.bound) {
			return { messages: applyFonceA(event.messages as never, branch, session, runtime.config) };
		}
		return {
			messages: applyFonceA(event.messages as never, branch, session, runtime.config, {
				projectRecords: runtime.projectRecords,
			}),
		};
	}) as never);
}
