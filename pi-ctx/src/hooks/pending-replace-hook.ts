import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { foldLive, foldSession, resolveOccupancy } from "../fold.js";
import { hitlFromCtx } from "../hitl.js";
import { runPendingReplaceHitl } from "../promoter/hitl.js";
import { PENDING_HITL_TURNS } from "../promoter/schema.js";
import type { Runtime } from "../runtime.js";
import { CTX_PENDING_TURN, type Entry } from "../types.js";

type TurnCtx = {
	hasUI: boolean;
	cwd?: string;
	sessionManager: { getBranch: () => Entry[]; getSessionId?: () => string };
	ui?: Parameters<typeof hitlFromCtx>[0]["ui"];
};

/** Shared by one hook registration so overlapping settles cannot stack selects. */
export type PendingReplaceGate = { inFlight: boolean };

const TOOL_STOP = new Set(["tool_use", "tool_calls", "toolUse"]);
const DEAD_STOP = new Set(["error", "aborted"]);

/**
 * A parent turn is one settled agent run. Tool rounds are not parent turns.
 * `agent_settled` has no payload; a turn_end-shaped event counts only when it
 * will not continue into another tool call.
 */
export function isCompletedParentTurn(event: {
	outcome?: string;
	continue?: boolean;
	toolResults?: unknown[];
	message?: { stopReason?: string };
} | null | undefined): boolean {
	if (!event) return true;
	if (event.outcome === "aborted" || event.outcome === "error") return false;
	if (event.outcome && event.outcome !== "completed") return false;
	if (event.continue === true) return false;
	if (Array.isArray(event.toolResults) && event.toolResults.length > 0) return false;
	const stop = event.message?.stopReason;
	if (stop && (TOOL_STOP.has(stop) || DEAD_STOP.has(stop))) return false;
	return true;
}

function branchEndedDead(branch: Entry[]): boolean {
	for (let i = branch.length - 1; i >= 0; i--) {
		const message = branch[i].message;
		if (message?.role !== "assistant") continue;
		return message.stopReason === "error" || message.stopReason === "aborted";
	}
	return false;
}

export function registerPendingReplaceHook(pi: ExtensionAPI, runtime: Runtime): void {
	const gate: PendingReplaceGate = { inFlight: false };
	// agent_settled: one event after the tool loop, retries, and follow-ups finish.
	// turn_end fires per LLM round, so counting it reopened HITL inside one reply.
	pi.on("agent_settled", ((event: unknown, ctx: TurnCtx) => {
		return onPendingReplaceSettled(pi, runtime, ctx, gate, event);
	}) as never);
}

export async function onPendingReplaceSettled(
	pi: ExtensionAPI,
	runtime: Runtime,
	ctx: TurnCtx,
	gate: PendingReplaceGate = { inFlight: false },
	event?: unknown,
): Promise<void> {
	if (gate.inFlight) return;
	if (!isCompletedParentTurn(event as Parameters<typeof isCompletedParentTurn>[0])) return;
	if (!runtime.enabled || runtime.config.passive) return;
	if (!runtime.bound || !runtime.projectId) return;
	runtime.reloadProject();
	const live = foldLive(runtime.projectRecords);
	const open = live.pendingReplaces.filter((p) => live.live.has(p.id));
	if (open.length === 0) return;
	const branch = ctx.sessionManager.getBranch();
	if (branchEndedDead(branch)) return;
	const sessionId = ctx.sessionManager.getSessionId?.() ?? runtime.sessionId;
	const fold = foldSession(branch, sessionId);
	const n = (fold.pendingReplaceTurns ?? 0) + 1;
	pi.appendEntry(CTX_PENDING_TURN, { n });
	if (n < PENDING_HITL_TURNS) return;
	if (!ctx.hasUI || !ctx.ui) return;
	gate.inFlight = true;
	try {
		const occupancy = resolveOccupancy({ occupancy: runtime.occupancy }, runtime.config.occupancy);
		const out = await runPendingReplaceHitl({
			hitl: hitlFromCtx({ hasUI: true, ui: ctx.ui }),
			projectId: runtime.projectId,
			sessionId: runtime.sessionId,
			occupancy,
			siblingKnob: runtime.config.gatedEdgeSiblingHeadlines,
			claimedId: runtime.claimedId,
			existing: runtime.projectRecords,
		});
		runtime.projectRecords = out.existing;
		runtime.projectLive = foldLive(out.existing);
		pi.appendEntry(CTX_PENDING_TURN, { n: 0 });
	} finally {
		gate.inFlight = false;
	}
}
