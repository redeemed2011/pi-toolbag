import type { Hitl } from "../hitl.js";
import { foldLive, resolveOccupancy } from "../fold.js";
import type { Runtime } from "../runtime.js";
import { applyClaim, type ClaimAction } from "../tools/claim.js";
import { CTX_CLAIM } from "../types.js";

export type ClaimPi = { appendEntry: (customType: string, data?: unknown) => void };

export async function runClaimFlow(opts: {
	pi: ClaimPi;
	runtime: Runtime;
	hitl: Hitl;
	action: ClaimAction;
	question_id?: string;
}): Promise<{ ok: true; claimed_id: string | null } | { ok: false; error: string }> {
	const { pi, runtime, hitl } = opts;
	const occupancy = resolveOccupancy({ occupancy: runtime.occupancy }, runtime.config.occupancy);
	const live = runtime.projectLive ?? foldLive(runtime.projectRecords);
	const action = opts.action;
	const questionId = opts.question_id;
	if (
		action === "claim" &&
		runtime.claimedId &&
		questionId &&
		runtime.claimedId !== questionId
	) {
		if (!hitl.hasUI) return { ok: false, error: "close first or user /ctx claim" };
		const ok = await hitl.confirm(
			"Close and claim",
			`Close ${runtime.claimedId} and claim ${questionId}?`,
		);
		if (!ok) return { ok: false, error: "cancelled" };
		pi.appendEntry(CTX_CLAIM, { claimed_question_id: null });
		runtime.claimedId = null;
	}
	const result = applyClaim({
		action,
		question_id: questionId,
		bound: runtime.bound,
		enabled: runtime.enabled,
		claimedId: runtime.claimedId,
		live,
		occupancy,
		siblingKnob: runtime.config.gatedEdgeSiblingHeadlines,
	});
	if (!result.ok) return result;
	if (!result.noop) {
		pi.appendEntry(CTX_CLAIM, { claimed_question_id: result.claimed_id });
		runtime.claimedId = result.claimed_id;
	}
	return { ok: true, claimed_id: result.claimed_id };
}
