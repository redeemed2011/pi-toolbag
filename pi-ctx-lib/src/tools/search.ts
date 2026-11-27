import type { JudgmentRecord, LiveSet } from "../types.js";
import { FRONTIER_CAP } from "./frontier.js";

const QUERY_CAP = 200;

function liveRecords(live: LiveSet): JudgmentRecord[] {
	return [...live.live]
		.map((id) => live.byId.get(id))
		.filter((rec): rec is JudgmentRecord => rec !== undefined)
		.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id.localeCompare(b.id)));
}

function haystack(rec: JudgmentRecord): string {
	return `${rec.headline}\n${rec.directive ?? ""}\n${rec.body}`.toLowerCase();
}

/** Topic lookup over live records. Observations are not in the live set. */
export function executeSearch(opts: {
	enabled: boolean;
	bound: boolean;
	live: LiveSet;
	query?: string;
}): Record<string, unknown> {
	if (!opts.enabled) return { error: "ctx is off" };
	if (!opts.bound) return { error: "no project bound" };
	const query = (opts.query ?? "").trim().replace(/\s+/g, " ");
	if (!query) return { error: "query required" };
	if (query.length > QUERY_CAP) return { error: "query too long" };
	const needle = query.toLowerCase();
	const hits = liveRecords(opts.live).filter((rec) => haystack(rec).includes(needle));
	return {
		items: hits.slice(0, FRONTIER_CAP).map((rec) => ({
			id: rec.id,
			type: rec.type,
			headline: rec.headline,
		})),
		elided: Math.max(0, hits.length - FRONTIER_CAP),
	};
}
