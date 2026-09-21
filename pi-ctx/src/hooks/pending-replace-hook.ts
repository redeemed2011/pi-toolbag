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

export function registerPendingReplaceHook(pi: ExtensionAPI, runtime: Runtime): void {
	pi.on("turn_end", ((_event: unknown, ctx: TurnCtx) => {
		void onTurnEnd(pi, runtime, ctx);
	}) as never);
}

export async function onTurnEnd(pi: ExtensionAPI, runtime: Runtime, ctx: TurnCtx): Promise<void> {
	if (!runtime.enabled || runtime.config.passive) return;
	if (!runtime.bound || !runtime.projectId) return;
	runtime.reloadProject();
	const live = foldLive(runtime.projectRecords);
	const open = live.pendingReplaces.filter((p) => live.live.has(p.id));
	if (open.length === 0) return;
	const branch = ctx.sessionManager.getBranch();
	const sessionId = ctx.sessionManager.getSessionId?.() ?? runtime.sessionId;
	const fold = foldSession(branch, sessionId);
	const n = (fold.pendingReplaceTurns ?? 0) + 1;
	pi.appendEntry(CTX_PENDING_TURN, { n });
	if (n < PENDING_HITL_TURNS) return;
	if (!ctx.hasUI || !ctx.ui) return;
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
}
