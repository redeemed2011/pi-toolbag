import { describe, expect, it } from "vitest";
import { validateAppliesTo } from "../src/store/jsonl.js";

describe("applies_to refuse-missing", () => {
	it("refuses missing, empty array, and dangling ids; never defaults to all", () => {
		expect(validateAppliesTo(undefined, ["q1"]).ok).toBe(false);
		expect(validateAppliesTo(null, ["q1"]).ok).toBe(false);
		expect(validateAppliesTo([], ["q1"])).toEqual({ ok: false, error: "applies_to_empty" });
		expect(validateAppliesTo(["nope"], ["q1"])).toEqual({ ok: false, error: "applies_to_dangling" });
		expect(validateAppliesTo("all", ["q1"])).toEqual({ ok: true, applies_to: "all" });
		expect(validateAppliesTo(["q1"], ["q1"])).toEqual({ ok: true, applies_to: ["q1"] });
	});
});
