import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Runtime } from "../runtime.js";
import type { Entry } from "../types.js";
import { publishRuntimeBoundStatus, statusSink } from "../render/bound-status.js";

export function registerSessionStart(pi: ExtensionAPI, runtime: Runtime): void {
	pi.on("session_start", (_event: unknown, ctx: {
		cwd: string;
		hasUI?: boolean;
		ui?: { setStatus?: (key: string, text: string | undefined) => void };
		sessionManager: { getBranch: () => Entry[]; getSessionId?: () => string };
	}) => {
		runtime.ensureConfig(ctx.cwd);
		runtime.dispatchedCoversUpToId = undefined;
		const branch = ctx.sessionManager.getBranch();
		const sessionId = ctx.sessionManager.getSessionId?.() ?? "";
		runtime.restoreFromBranch(branch, sessionId);
		publishRuntimeBoundStatus(statusSink(ctx), runtime);
	});

	pi.on("session_shutdown", () => {
		runtime.abortAllWorkers();
	});
}
