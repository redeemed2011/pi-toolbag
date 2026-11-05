import { describe, expect, it } from "vitest";
import { foldLive, frontierItems } from "../src/fold.js";
import { putJudgment } from "../src/mint.js";
import { lineToJudgment, type JsonlLine } from "../src/store/jsonl.js";
import { applyClaim } from "../src/tools/claim.js";
import { question } from "./fixtures.js";

const base = {
	occupancy: "gated-edge" as const,
	siblingKnob: 0 as const,
	claimedId: null as string | null,
};

describe("ask-operator marker", () => {
	it("hides a marked question from the frontier and refuses the claim", () => {
		const q = question("q1", "confirm the name");
		const marked = putJudgment({
			...base,
			existing: [q],
			input: {
				type: "decision",
				headline: "Ask the operator",
				body: q.headline,
				asks: ["q1"],
				session: "s",
				id: "m1",
			},
		});
		expect(marked.ok).toBe(true);
		if (!marked.ok) return;
		const live = foldLive([q, marked.record]);
		expect(live.askOperator.has("q1")).toBe(true);
		expect(frontierItems(live, null).map((item) => item.id)).toEqual([]);
		const claim = applyClaim({
			action: "claim",
			question_id: "q1",
			bound: true,
			enabled: true,
			claimedId: null,
			live,
			occupancy: "gated-edge",
			siblingKnob: 0,
		});
		expect(claim.ok).toBe(false);
		if (!claim.ok) expect(claim.error).toBe("ask_operator");
		const held = applyClaim({
			action: "claim",
			question_id: "q1",
			bound: true,
			enabled: true,
			claimedId: "q1",
			live,
			occupancy: "gated-edge",
			siblingKnob: 0,
		});
		expect(held.ok).toBe(false);
		if (!held.ok) expect(held.error).toBe("ask_operator");
	});

	it("drops the marker when the decision is superseded", () => {
		const q = question("q1", "confirm the name");
		const marker = putJudgment({
			...base,
			existing: [q],
			input: {
				type: "decision",
				headline: "Ask the operator",
				body: q.headline,
				asks: ["q1"],
				session: "s",
				id: "m1",
			},
		});
		expect(marker.ok).toBe(true);
		if (!marker.ok) return;
		const cleared = putJudgment({
			...base,
			existing: [q, marker.record],
			input: {
				type: "decision",
				headline: "Ask the operator",
				body: "q1",
				supersedes: "m1",
				reason_class: "decision_change",
				session: "s",
				id: "m2",
			},
		});
		expect(cleared.ok).toBe(true);
		if (!cleared.ok) return;
		const live = foldLive([q, marker.record, cleared.record]);
		expect(live.askOperator.has("q1")).toBe(false);
		expect(frontierItems(live, null).map((item) => item.id)).toEqual(["q1"]);
	});

	it("refuses asks on evidence and on a missing question", () => {
		const q = question("q1", "confirm the name");
		const evidence = putJudgment({
			...base,
			existing: [q],
			input: {
				type: "evidence",
				headline: "blob",
				asks: ["q1"],
				session: "s",
				blob_hash: "a".repeat(64),
				byte_size: 1,
				producer: "test",
				expires_at: "2099-01-01T00:00:00.000Z",
			},
		});
		expect(evidence.ok).toBe(false);
		if (!evidence.ok) expect(evidence.error).toBe("evidence cannot ask");
		const missing = putJudgment({
			...base,
			existing: [q],
			input: { type: "decision", headline: "Ask the operator", asks: ["nope"], session: "s" },
		});
		expect(missing.ok).toBe(false);
		if (!missing.ok) expect(missing.error).toBe("asks not_found");
	});

	it("reads asks back from a project line", () => {
		const line: JsonlLine = {
			id: "m1",
			type: "decision",
			ts: "2026-11-04T00:00:00.000Z",
			session: "s",
			headline: "Ask the operator",
			body: "q1",
			asks: ["q1"],
		};
		const rec = lineToJudgment(line);
		expect(rec?.asks).toEqual(["q1"]);
	});
});
