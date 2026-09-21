import { foldLive } from "../fold.js";
import type { Hitl } from "../hitl.js";
import { putJudgment } from "../mint.js";
import { appendProjectRecord } from "../store/project.js";
import { executeRecord } from "../tools/record.js";
import type { JudgmentRecord, Occupancy } from "../types.js";

export const KEEP = "Keep live law";
export const SUPERSEDE = "Supersede with user quote";
export const DEFER_ONE = "Defer this one";
export const KEEP_REST = "Keep all remaining";
export const DEFER_REST = "Defer remaining";

export type PendingHitlReport = {
	superseded: number;
	kept: number;
	deferred: number;
};

function closePending(
	existing: JudgmentRecord[],
	opts: {
		projectId: string;
		sessionId: string;
		occupancy: Occupancy;
		siblingKnob: 0 | 2;
		claimedId: string | null;
		pendingId: string;
		headline: string;
	},
): JudgmentRecord[] {
	const put = putJudgment({
		occupancy: opts.occupancy,
		siblingKnob: opts.siblingKnob,
		claimedId: opts.claimedId,
		existing,
		input: {
			type: "tombstone",
			headline: opts.headline,
			body: opts.pendingId,
			supersedes: opts.pendingId,
			reason_class: "decision_change",
			session: opts.sessionId,
		},
	});
	if (!put.ok) return existing;
	appendProjectRecord(opts.projectId, opts.sessionId, put.line);
	return [...existing, put.record];
}

export async function runPendingReplaceHitl(opts: {
	hitl: Hitl;
	projectId: string;
	sessionId: string;
	occupancy: Occupancy;
	siblingKnob: 0 | 2;
	claimedId: string | null;
	existing: JudgmentRecord[];
}): Promise<{ existing: JudgmentRecord[]; report: PendingHitlReport }> {
	const report: PendingHitlReport = { superseded: 0, kept: 0, deferred: 0 };
	if (!opts.hitl.hasUI) return { existing: opts.existing, report };
	let existing = [...opts.existing];

	const open = (): JudgmentRecord[] => {
		const live = foldLive(existing);
		return live.pendingReplaces.filter((p) => live.live.has(p.id));
	};

	let queue = open();
	while (queue.length > 0) {
		const p = queue[0];
		const live = foldLive(existing);
		const liveRec = p.parent ? live.byId.get(p.parent) : undefined;
		const options = [KEEP, SUPERSEDE, DEFER_ONE];
		if (queue.length > 1) options.push(KEEP_REST, DEFER_REST);
		const picked = await opts.hitl.select(
			`Pending replace (${queue.length} left)\nLive: ${liveRec?.headline ?? p.parent}\nQuote: ${p.body.slice(0, 280)}`,
			options,
		);
		if (!picked || picked === DEFER_ONE) {
			report.deferred += 1;
			queue = queue.slice(1);
			continue;
		}
		if (picked === DEFER_REST) {
			report.deferred += queue.length;
			break;
		}
		if (picked === KEEP || picked === KEEP_REST) {
			const targets = picked === KEEP_REST ? queue : [p];
			for (const item of targets) {
				existing = closePending(existing, {
					projectId: opts.projectId,
					sessionId: opts.sessionId,
					occupancy: opts.occupancy,
					siblingKnob: opts.siblingKnob,
					claimedId: opts.claimedId,
					pendingId: item.id,
					headline: "keep live law",
				});
				report.kept += 1;
			}
			queue = open();
			continue;
		}
		if (picked === SUPERSEDE) {
			if (!p.parent || !liveRec || !live.live.has(p.parent)) {
				queue = queue.slice(1);
				continue;
			}
			const minted = executeRecord({
				enabled: true,
				bound: true,
				occupancy: opts.occupancy,
				siblingKnob: opts.siblingKnob,
				claimedId: opts.claimedId,
				existing,
				input: {
					type: "constraint",
					headline: p.body.length <= 80 ? p.body : `${p.body.slice(0, 77)}...`,
					body: p.body,
					directive: p.body,
					applies_to: "all",
					supersedes: p.parent,
					reason_class: "conflict",
					session: opts.sessionId,
				},
			});
			if (minted.ok) {
				appendProjectRecord(opts.projectId, opts.sessionId, minted.line);
				existing = [...existing, minted.record];
				existing = closePending(existing, {
					projectId: opts.projectId,
					sessionId: opts.sessionId,
					occupancy: opts.occupancy,
					siblingKnob: opts.siblingKnob,
					claimedId: opts.claimedId,
					pendingId: p.id,
					headline: "pending resolved",
				});
				report.superseded += 1;
			}
			queue = open();
			continue;
		}
		queue = queue.slice(1);
	}
	return { existing, report };
}
