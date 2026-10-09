import { describe, expect, it } from "vitest";
import { runClaimFlow } from "../src/commands/claim.js";
import { foldLive } from "../src/fold.js";
import type { Hitl } from "../src/hitl.js";
import { Runtime } from "../src/runtime.js";
import { applyClaim } from "../src/tools/claim.js";
import { question } from "./fixtures.js";

function scriptedHitl(plan: { confirms?: boolean[]; hasUI?: boolean } = {}): Hitl {
	const confirms = [...(plan.confirms ?? [])];
	return {
		hasUI: plan.hasUI ?? true,
		select: async () => undefined,
		confirm: async () => confirms.shift() ?? false,
		input: async () => undefined,
		notify: () => {},
	};
}

function boundRuntime(claimedId: string | null): Runtime {
	const runtime = new Runtime();
	runtime.enabled = true;
	runtime.bound = true;
	runtime.projectId = "p";
	runtime.claimedId = claimedId;
	runtime.projectRecords = [question("q1", "one"), question("q2", "two")];
	runtime.projectLive = foldLive(runtime.projectRecords);
	return runtime;
}

describe("claim HITL / empty claim", () => {
	it("print refuses a live swap with a reason and does not pick", async () => {
		const runtime = boundRuntime("q1");
		const entries: Array<{ type: string; data: unknown }> = [];
		const result = await runClaimFlow({
			pi: {
				appendEntry: (customType, data) => {
					entries.push({ type: customType, data });
				},
			},
			runtime,
			hitl: scriptedHitl({ hasUI: false }),
			action: "claim",
			question_id: "q2",
		});
		expect(result).toEqual({ ok: false, error: "close first or user /ctx claim" });
		expect(runtime.claimedId).toBe("q1");
		expect(entries).toEqual([]);
	});

	it("close does not pick the next question", async () => {
		const runtime = boundRuntime("q1");
		const result = await runClaimFlow({
			pi: { appendEntry: () => {} },
			runtime,
			hitl: scriptedHitl({ hasUI: false }),
			action: "close",
		});
		expect(result).toEqual({ ok: true, claimed_id: null });
		expect(runtime.claimedId).toBe(null);
	});

	it("claim tool refuses a CS question over the 1200-token slot", () => {
		const live = foldLive([question("q-big", "x".repeat(1200 * 4 + 4))]);
		expect(
			applyClaim({
				action: "claim",
				question_id: "q-big",
				enabled: true,
				bound: true,
				claimedId: null,
				live,
				occupancy: "claim-strip",
				siblingKnob: 0,
			}),
		).toEqual({ ok: false, error: "question_too_large" });
	});
	it("does not ask to close and claim while unbound", async () => {
		const runtime = new Runtime();
		runtime.enabled = true;
		runtime.bound = false;
		runtime.claimedId = "q1";
		runtime.projectRecords = [question("q1", "one"), question("q2", "two")];
		runtime.projectLive = foldLive(runtime.projectRecords);
		let confirms = 0;
		const result = await runClaimFlow({
			pi: { appendEntry: () => {} },
			runtime,
			hitl: {
				hasUI: true,
				select: async () => undefined,
				confirm: async () => {
					confirms += 1;
					return true;
				},
				input: async () => undefined,
				notify: () => {},
			},
			action: "claim",
			question_id: "q2",
		});
		expect(result).toEqual({ ok: false, error: "no project bound" });
		expect(confirms).toBe(0);
		expect(runtime.claimedId).toBe("q1");
	});
});
