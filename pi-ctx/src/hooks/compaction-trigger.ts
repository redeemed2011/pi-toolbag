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

function turnWillContinue(event: { toolResults?: unknown[]; message?: { stopReason?: string } }): boolean {
	const toolResults = event?.toolResults;
	if (Array.isArray(toolResults) && toolResults.length > 0) return true;
	const stop = event?.message?.stopReason;
	return stop === "tool_use" || stop === "tool_calls" || stop === "toolUse";
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

		const shouldResume = runtime.config.resumeAfterMidRunCompaction && turnWillContinue(event);
		const notify = notifyFrom(ctx);
		runtime.compactInFlight = true;
		notify?.("ctx: context threshold reached — compacting…", "info");

		ctx.compact({
			onComplete: () => {
				runtime.compactInFlight = false;
				notify?.("ctx: compaction complete", "info");
				if (!shouldResume || !runtime.enabled || runtime.config.passive) return;
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
			},
			onError: (error: { message: string }) => {
				runtime.compactInFlight = false;
				if (error.message === "Compaction cancelled") return;
				notify?.(`ctx: ${error.message}`, "error");
			},
		});
	});
}
