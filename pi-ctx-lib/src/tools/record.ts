import { putJudgment, type PutInput } from "../mint.js";
import type { JudgmentRecord, Occupancy } from "../types.js";

export function executeRecord(opts: {
	enabled: boolean;
	bound: boolean;
	occupancy: Occupancy;
	siblingKnob: 0 | 2;
	claimedId: string | null;
	existing: JudgmentRecord[];
	input: PutInput;
}): ReturnType<typeof putJudgment> | { ok: false; error: string } {
	if (!opts.enabled) return { ok: false, error: "ctx is off" };
	if (!opts.bound) return { ok: false, error: "no project bound" };
	return putJudgment({
		occupancy: opts.occupancy,
		siblingKnob: opts.siblingKnob,
		claimedId: opts.claimedId,
		existing: opts.existing,
		input: opts.input,
	});
}
