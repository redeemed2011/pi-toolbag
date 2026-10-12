import { describe, expect, it } from "vitest";
import { planCoverageStep } from "../src/cover.js";
import { recorded, userMsg } from "./fixtures.js";

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
