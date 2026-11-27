import { authorDisplayEnabled, authorOf } from "../author.js";
import { frontierItems } from "../fold.js";
import type { LiveSet } from "../types.js";

export const FRONTIER_CAP = 20;

const LISTED_TYPES = new Set([
	"question",
	"decision",
	"constraint",
	"finding",
	"destination",
	"out_of_scope",
	"fog",
	"tombstone",
	"citation",
	"evidence",
]);

export function executeFrontier(opts: {
	enabled: boolean;
	bound: boolean;
	claimedId: string | null;
	live: LiveSet;
	include_blocked?: boolean;
	offset?: number;
	type?: string;
	includeAuthor?: boolean;
}): Record<string, unknown> {
	if (!opts.enabled) return { error: "ctx is off" };
	if (!opts.bound) return { error: "no project bound" };
	const type = opts.type && opts.type !== "question" ? opts.type : undefined;
	if (type && !LISTED_TYPES.has(type)) return { error: `unknown type ${type}` };
	const items = type
		? [...opts.live.live]
			.map((id) => opts.live.byId.get(id)!)
			.filter((rec) => rec.type === type)
			.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id.localeCompare(b.id)))
		: frontierItems(opts.live, opts.claimedId, opts.include_blocked === true);
	const offset = Math.max(0, Math.floor(opts.offset ?? 0));
	const page = items.slice(offset, offset + FRONTIER_CAP);
	const after = offset + page.length;
	const showAuthor = authorDisplayEnabled(opts.includeAuthor);
	return {
		...(type ? { type } : {}),
		items: page.map((q) => ({
			id: q.id,
			headline: q.headline,
			...(showAuthor ? { author: authorOf(q) } : {}),
			...(q.blocks ? { blocks: q.blocks } : {}),
		})),
		total: items.length,
		offset,
		elided: Math.max(0, items.length - after),
		...(after < items.length ? { next_offset: after } : {}),
		claimed_id: opts.claimedId,
		claim_empty: opts.claimedId ? 0 : 1,
	};
}
