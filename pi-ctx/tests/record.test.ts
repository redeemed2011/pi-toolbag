import { describe, expect, it } from "vitest";
import { putJudgment } from "../src/mint.js";
import { constraint, question } from "./fixtures.js";

const base = {
	occupancy: "gated-edge" as const,
	siblingKnob: 0 as const,
	claimedId: null as string | null,
	existing: [question("q1", "do the thing")],
};

describe("record write path", () => {
	it("refuses missing, empty, and dangling applies_to; never defaults all", () => {
		const input = {
			type: "constraint" as const,
			headline: "never reopen X",
			directive: "never reopen X",
			session: "s",
		};
		const missing = putJudgment({ ...base, input });
		expect(missing.ok).toBe(false);
		if (!missing.ok) expect(missing.error).toBe("applies_to required");
		const empty = putJudgment({ ...base, input: { ...input, applies_to: [] } });
		expect(empty.ok).toBe(false);
		if (!empty.ok) expect(empty.error).toBe("applies_to empty refuses");
		const dangling = putJudgment({ ...base, input: { ...input, applies_to: ["nope"] } });
		expect(dangling.ok).toBe(false);
		if (!dangling.ok) expect(dangling.error).toBe("applies_to dangling");
		const ok = putJudgment({ ...base, input: { ...input, applies_to: "all" } });
		expect(ok.ok).toBe(true);
		if (ok.ok) expect(ok.record.applies_to).toBe("all");
	});

	it("refuses missing directive on constraint", () => {
		const result = putJudgment({
			...base,
			input: { type: "constraint", headline: "h", applies_to: "all", session: "s" },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe("directive required");
	});

	it("refuses a 4k-token question as question_too_large under GE cap", () => {
		const result = putJudgment({
			...base,
			input: {
				type: "question",
				headline: "big",
				body: "x".repeat(4 * 4000),
				session: "s",
			},
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe("question_too_large");
	});

	it("computes both mint GATE flags and refuses when current occupancy would gate", () => {
		const existing = [
			...base.existing,
			...Array.from({ length: 20 }, (_, i) => constraint(`c${i}`, "x")),
		];
		const result = putJudgment({
			...base,
			existing,
			input: {
				type: "constraint",
				headline: "another",
				directive: "another",
				applies_to: "all",
				session: "s",
			},
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("gate");
			expect(result.would_gate_ge).toBe(1);
		}
	});

	it("refuses supersedes without reason_class", () => {
		const result = putJudgment({
			...base,
			existing: [...base.existing, constraint("c1", "old")],
			input: {
				type: "constraint",
				headline: "new",
				directive: "new",
				applies_to: "all",
				supersedes: "c1",
				session: "s",
			},
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe("reason_class required");
	});
});
