import { describe, expect, it } from "vitest";
import { proposePromotion } from "../src/promotion.js";
import { obs } from "./fixtures.js";

describe("promotion later-context", () => {
	it("offers firm never; later conditional on shared terms is not offered", () => {
		const early = obs("o1", "never a from-scratch harness", "u1");
		early.ts = "2026-09-14T10:00:00.000Z";
		early.body = "never a from-scratch harness";
		const later = obs("o2", "from-scratch harness only if an extension cannot", "u2");
		later.ts = "2026-09-14T11:00:00.000Z";
		later.body = "from-scratch harness only if an extension cannot";
		const { offered, notOffered } = proposePromotion([early, later], new Map());
		expect(notOffered.map((c) => c.observationId)).toEqual(["o1"]);
		expect(offered.map((c) => c.observationId)).toEqual(["o2"]);
		expect(offered[0]?.kind).toBe("conditional");
		expect(notOffered[0]?.wording).toContain("Later:");
	});

	it("skips minted and final_skip; not_final is offered again", () => {
		const o = obs("o1", "never reopen packing", "u1");
		o.body = "never reopen packing";
		const skipped = new Map<"o1", "final_skip">([["o1", "final_skip"]]);
		expect(proposePromotion([o], skipped).offered).toEqual([]);
		expect(proposePromotion([o], new Map([["o1", "not_final"]])).offered).toHaveLength(1);
	});

	it("does not dump non-law observations", () => {
		const o = obs("o1", "edited the file", "u1");
		expect(proposePromotion([o], new Map()).offered).toEqual([]);
		expect(proposePromotion([o], new Map()).notOffered).toEqual([]);
	});
});
