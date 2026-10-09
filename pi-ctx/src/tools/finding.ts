import { putJudgment, type PutOk } from "../mint.js";
import type { JudgmentRecord, Occupancy } from "../types.js";

export function executeFinding(opts: {
	enabled: boolean;
	bound: boolean;
	grantId: string | null;
	grantQuestionId: string | null;
	projectId: string | null;
	occupancy: Occupancy;
	siblingKnob: 0 | 2;
	claimedId: string | null;
	existing: JudgmentRecord[];
	headline: string;
	body: string;
	sessionId: string;
}): PutOk | { ok: false; error: string } {
	if (!opts.enabled) return { ok: false, error: "ctx is off" };
	if (!opts.grantId || !opts.bound || !opts.projectId) return { ok: false, error: "not a worker" };
	if (!opts.grantQuestionId) return { ok: false, error: "no granted question" };
	return putJudgment({
		occupancy: opts.occupancy,
		siblingKnob: opts.siblingKnob,
		claimedId: opts.claimedId,
		existing: opts.existing,
		input: {
			type: "finding",
			headline: opts.headline,
			body: opts.body,
			parent: opts.grantQuestionId,
			session: opts.sessionId,
		},
	});
}
