import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../src/config.js";
import { INJECT_CAP, injectTokens } from "../src/render/estimate.js";
import { renderInject } from "../src/render/inject.js";
import { recallErrorInject } from "../src/render/unbound.js";
import { obs } from "./fixtures.js";

describe("unbound inject", () => {
	it("is recency + no project bound, no law", () => {
		const packed = renderInject({
			session: {
				enabled: true,
				bound: false,
				projectId: null,
				claimedId: null,
				occupancy: null,
				observations: [obs("o1", "did the thing", "u1")],
				recency: [obs("o1", "did the thing", "u1")],
				grantId: null,
				grantQuestionId: null,
			},
			branch: [],
			firstKeptId: "u2",
			config: DEFAULTS,
			projectRecords: [],
		});
		expect(packed.text).toContain("no project bound");
		expect(packed.text).toContain("did the thing");
		expect(packed.text).not.toContain("## Constraints");
		expect(injectTokens(packed.text)).toBeLessThanOrEqual(INJECT_CAP);
	});

	it("recall_error fallback is still typed and capped", () => {
		const packed = recallErrorInject("q1", "boom");
		expect(packed.text).toContain("recall_error=1");
		expect(packed.text).toContain("no constraint bodies this cycle");
		expect(injectTokens(packed.text)).toBeLessThanOrEqual(INJECT_CAP);
	});
});
