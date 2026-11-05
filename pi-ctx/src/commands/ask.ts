import { foldLive, resolveOccupancy } from "../fold.js";
import { putJudgment } from "../mint.js";
import type { Runtime } from "../runtime.js";
import { appendProjectRecord } from "../store/project.js";
import { CTX_CLAIM } from "../types.js";

export const ASK_HEADLINE = "Ask the operator";

export type AskPi = { appendEntry: (customType: string, data?: unknown) => void };

export function runAskFlow(opts: {
	pi: AskPi;
	runtime: Runtime;
	questionId: string;
	clear: boolean;
}): { ok: true; cleared: number } | { ok: false; error: string } {
	const { pi, runtime } = opts;
	if (!runtime.enabled) return { ok: false, error: "ctx is off" };
	if (!runtime.bound || !runtime.projectId) return { ok: false, error: "no project bound" };
	const questionId = opts.questionId.trim();
	if (!questionId) return { ok: false, error: "question_id required" };

	const occupancy = resolveOccupancy({ occupancy: runtime.occupancy }, runtime.config.occupancy);
	const existing = runtime.projectRecords;
	const live = runtime.projectLive ?? foldLive(existing);
	const question = live.byId.get(questionId);
	if (!question || question.type !== "question" || !live.live.has(questionId)) {
		return { ok: false, error: "not_found" };
	}

	if (opts.clear) {
		const markers = [...live.live].flatMap((id) => {
			const rec = live.byId.get(id);
			if (!rec || rec.type !== "decision" || rec.headline !== ASK_HEADLINE) return [];
			if (!rec.asks?.includes(questionId)) return [];
			return [rec];
		});
		for (const marker of markers) {
			const put = putJudgment({
				occupancy,
				siblingKnob: runtime.config.gatedEdgeSiblingHeadlines,
				claimedId: runtime.claimedId,
				existing: runtime.projectRecords,
				input: {
					type: "decision",
					headline: ASK_HEADLINE,
					body: questionId,
					supersedes: marker.id,
					reason_class: "decision_change",
					session: runtime.sessionId,
				},
			});
			if (!put.ok) return put;
			appendProjectRecord(runtime.projectId, runtime.sessionId, put.line);
			runtime.reloadProject();
		}
		return { ok: true, cleared: markers.length };
	}

	if (live.askOperator.has(questionId)) return { ok: true, cleared: 0 };

	const put = putJudgment({
		occupancy,
		siblingKnob: runtime.config.gatedEdgeSiblingHeadlines,
		claimedId: runtime.claimedId,
		existing,
		input: {
			type: "decision",
			headline: ASK_HEADLINE,
			body: question.headline,
			asks: [questionId],
			session: runtime.sessionId,
		},
	});
	if (!put.ok) return put;
	appendProjectRecord(runtime.projectId, runtime.sessionId, put.line);
	runtime.reloadProject();
	if (runtime.claimedId === questionId) {
		pi.appendEntry(CTX_CLAIM, { claimed_question_id: null });
		runtime.claimedId = null;
	}
	return { ok: true, cleared: 0 };
}
