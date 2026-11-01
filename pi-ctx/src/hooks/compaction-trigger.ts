import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { foldSession } from "../fold.js";
import { rawTokensSinceLastCompaction } from "../progress.js";
import { sendGuardTokens } from "../render/fonce.js";
import { notifyFrom } from "../notify.js";
import type { Runtime } from "../runtime.js";
import { CTX_RESUME, type Entry } from "../types.js";

const RESUME_PROMPT =
	"[automatic] Your context was just compacted to free space; no user message was sent. " +
	"Continue exactly where you left off, as if the compaction had not happened.";

const RETRYABLE_ERROR_RE =
	/overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|websocket.?closed|websocket.?error|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|http2 request did not get a response|timed? out|timeout|terminated|retry delay/i;

function contextPressureTokens(
	ctx: { getContextUsage?: () => { tokens: number | null } | undefined; sessionManager: { getBranch: () => Entry[] } },
	threshold: number,
	sessionId: string,
): { tokens: number; due: boolean } {
	const branch = ctx.sessionManager.getBranch();
	const live = ctx.getContextUsage?.()?.tokens;
	if (live != null) {
		const tokens = sendGuardTokens(live, branch, foldSession(branch, sessionId));
		return { tokens, due: tokens >= threshold };
	}
	const raw = rawTokensSinceLastCompaction(branch);
	return { tokens: raw, due: raw >= threshold };
}

/** True only when `ctx.compact()` will abort a live run. Idle settle does not. */
function compactWillAbortRun(ctx: { isIdle?: () => boolean }): boolean {
	return typeof ctx.isIdle === "function" && !ctx.isIdle();
}

export function registerCompactionTrigger(pi: ExtensionAPI, runtime: Runtime): void {
	pi.on("turn_end", (event: any, ctx: any) => {
		if (!runtime.enabled || runtime.config.passive) return;
		if (runtime.compactInFlight) return;

		const message = event?.message;
		if (
			message?.role === "assistant" &&
			message.stopReason === "error" &&
			message.errorMessage &&
			RETRYABLE_ERROR_RE.test(message.errorMessage)
		) {
			return;
		}

		if (!contextPressureTokens(ctx, runtime.config.compactAtContextTokens, runtime.sessionId).due) return;

		// Arm only. compact() aborts an active run, and that abort is recorded as a user pause.
		runtime.compactInFlight = true;
	});

	// The run is already idle: _isAgentRunActive is cleared before this event.
	// Await compact before returning so a later setTimeout(0) cannot start the next run first.
	pi.on("agent_settled", async (_event: any, ctx: any) => {
		if (!runtime.compactInFlight) return;
		if (!runtime.enabled || runtime.config.passive) {
			runtime.compactInFlight = false;
			runtime.compactResume = false;
			return;
		}

		const notify = notifyFrom(ctx);
		const shouldResume = runtime.config.resumeAfterMidRunCompaction && compactWillAbortRun(ctx);
		runtime.compactResume = shouldResume;
		notify?.("ctx: context threshold reached — compacting…", "info");

		try {
			await new Promise<void>((resolve) => {
				ctx.compact({
					onComplete: () => {
						runtime.compactResume = false;
						runtime.compactInFlight = false;
						notify?.("ctx: compaction complete", "info");
						if (!shouldResume || !runtime.enabled || runtime.config.passive) {
							resolve();
							return;
						}
						try {
							pi.sendMessage(
								{ customType: CTX_RESUME, content: RESUME_PROMPT, display: false },
								{ triggerTurn: true },
							);
						} catch (error) {
							const msg = error instanceof Error ? error.message : String(error);
							runtime.lastWorkerError = `resume failed: ${msg}`;
							notify?.(`ctx: resume failed — ${msg}`, "error");
						}
						resolve();
					},
					onError: (error: { message: string }) => {
						runtime.compactResume = false;
						runtime.compactInFlight = false;
						if (error.message !== "Compaction cancelled") {
							notify?.(`ctx: ${error.message}`, "error");
						}
						resolve();
					},
				});
			});
		} catch (error) {
			runtime.compactResume = false;
			runtime.compactInFlight = false;
			const msg = error instanceof Error ? error.message : String(error);
			notify?.(`ctx: ${msg}`, "error");
		}
	});
}
