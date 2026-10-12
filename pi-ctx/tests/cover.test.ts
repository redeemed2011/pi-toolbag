import { describe, expect, it } from "vitest";
import { planCoverageStep, retentionCutId } from "../src/cover.js";
import { recencyLines } from "../src/render/gated-edge.js";
import { assistantToolCall, obs, recorded, toolResult, userMsg } from "./fixtures.js";

const branch = [
	userMsg("early", "earlier chunk"),
	recorded("rec-early", "early", ["earlier"]),
	userMsg("fact", "one-shot fact"),
	userMsg("pad", "padding"),
];

describe("planCoverageStep", () => {
	it("does not treat an in-flight earlier chunk as coverage of a later fact", () => {
		expect(planCoverageStep(branch, "pad", 1500, ["early"]).action).toBe("wait");
	});

	it("dispatches the later fact once that earlier observer is idle", () => {
		const step = planCoverageStep(branch, "pad", 1500, []);
		expect(step.action).toBe("dispatch");
		if (step.action !== "dispatch") return;
		expect(step.slice.entries.map((entry) => entry.id)).toContain("fact");
	});

	it("is done once the fact's chunk is covered", () => {
		const covered = [...branch, recorded("rec-fact", "fact", ["one-shot fact"])];
		expect(planCoverageStep(covered, "pad", 1500, []).action).toBe("done");
	});
});

describe("retentionCutId", () => {
	it("keeps a user fact as the cut", () => {
		expect(retentionCutId(branch, "pad")).toBe("fact");
	});

	it("keeps the tool call when the uncovered fact is a tool result", () => {
		const entries = [
			assistantToolCall("call"),
			recorded("rec", "call", ["called"]),
			toolResult("fact", "one-shot fact"),
			userMsg("pad", "padding"),
		];
		expect(retentionCutId(entries, "pad")).toBe("call");
	});
});

describe("recency at the cut", () => {
	it("shows an observation that ends on the cut and hides one inside the tail", () => {
		const entries = [userMsg("before", "b"), userMsg("cut", "c"), userMsg("tail", "t")];
		const lines = recencyLines(
			[obs("on-cut", "kept fact", "cut"), obs("in-tail", "tail fact", "tail")],
			"cut",
			entries,
		);
		expect(lines.join("\n")).toContain("kept fact");
		expect(lines.join("\n")).not.toContain("tail fact");
	});
});
