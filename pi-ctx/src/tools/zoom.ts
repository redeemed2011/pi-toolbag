import type { JudgmentRecord, LiveSet, Observation } from "../types.js";
import { lookupRecord } from "./get.js";

export function executeZoom(opts: {
	id: string;
	enabled: boolean;
	live: LiveSet;
	records: JudgmentRecord[];
	observations: Observation[];
}): unknown {
	if (!opts.enabled) return { error: "ctx is off" };
	if (!opts.id) return { error: "not_found", id: opts.id };
	return lookupRecord(opts.id, opts.live, opts.records, opts.observations);
}
