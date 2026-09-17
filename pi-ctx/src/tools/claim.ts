import { claimSlotFits } from "../render/occupancy.js";
import type { LiveSet, Occupancy } from "../types.js";

export type ClaimAction = "status" | "claim" | "close";

export type ClaimOk = {
	ok: true;
	claimed_id: string | null;
	claim_empty: 0 | 1;
	headline?: string;
	noop?: boolean;
};

export type ClaimErr = { ok: false; error: string };

export function applyClaim(opts: {
	action: ClaimAction;
	question_id?: string;
	bound: boolean;
	enabled: boolean;
	claimedId: string | null;
	live: LiveSet;
	occupancy: Occupancy;
	siblingKnob: 0 | 2;
}): ClaimOk | ClaimErr {
	if (!opts.enabled) return { ok: false, error: "ctx is off" };
	if (!opts.bound) return { ok: false, error: "no project bound" };
	if (opts.action === "status") {
		const q = opts.claimedId ? opts.live.byId.get(opts.claimedId) : undefined;
		return {
			ok: true,
			claimed_id: opts.claimedId,
			claim_empty: opts.claimedId ? 0 : 1,
			headline: q?.headline,
		};
	}
	if (opts.action === "close") {
		return { ok: true, claimed_id: null, claim_empty: 1 };
	}
	if (!opts.question_id) return { ok: false, error: "question_id required" };
	if (opts.claimedId && opts.claimedId !== opts.question_id) {
		return { ok: false, error: "close first or user /ctx claim" };
	}
	if (opts.claimedId === opts.question_id) {
		const q = opts.live.byId.get(opts.question_id);
		return {
			ok: true,
			claimed_id: opts.claimedId,
			claim_empty: 0,
			headline: q?.headline,
			noop: true,
		};
	}
	const q = opts.live.byId.get(opts.question_id);
	if (!q || q.type !== "question" || !opts.live.live.has(q.id)) {
		return { ok: false, error: "not_found" };
	}
	if (opts.live.blocked.has(q.id)) return { ok: false, error: "blocked" };
	if (!claimSlotFits(q, opts.occupancy, opts.siblingKnob)) {
		return { ok: false, error: "question_too_large" };
	}
	return { ok: true, claimed_id: q.id, claim_empty: 0, headline: q.headline };
}
