import { frontierItems } from "../fold.js";
import type { LiveSet } from "../types.js";

export const FRONTIER_CAP = 20;

export function executeFrontier(opts: {
	enabled: boolean;
	bound: boolean;
	claimedId: string | null;
	live: LiveSet;
	include_blocked?: boolean;
}): unknown {
	if (!opts.enabled) return { error: "ctx is off" };
	if (!opts.bound) return { error: "no project bound" };
	const items = frontierItems(opts.live, opts.claimedId, opts.include_blocked === true);
	return {
		items: items.slice(0, FRONTIER_CAP).map((q) => ({
			id: q.id,
			headline: q.headline,
			blocks: q.blocks,
		})),
		elided: Math.max(0, items.length - FRONTIER_CAP),
		claimed_id: opts.claimedId,
		claim_empty: opts.claimedId ? 0 : 1,
	};
}
