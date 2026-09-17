import { describe, expect, it } from "vitest";
import { INJECT_CAP, injectTokens } from "../src/render/estimate.js";
import { packInject } from "../src/render/pack.js";
import { renderInject } from "../src/render/inject.js";
import { DEFAULTS } from "../src/config.js";
import { constraint, question } from "./fixtures.js";
import type { SessionFold } from "../src/types.js";

const session = (over: Partial<SessionFold> = {}): SessionFold => ({
	enabled: true,
	bound: true,
	projectId: "p",
	claimedId: "q1",
	occupancy: null,
	observations: [],
	recency: [],
	...over,
});

describe("packInject", () => {
	it("truncates claim before dropping GATE=0 bodies", () => {
		const bodies = "## Constraints\n" + "L".repeat(3000);
		const claimed = "## Claimed\n" + "Q".repeat(29000);
		const packed = packInject({
			headers: "# ctx",
			dest: "## Destination\nhi",
			bodiesMd: bodies,
			claimedMd: claimed,
			counts: "## Counts\ngate:0",
			fill: ["## Recency\n- lots"],
		});
		expect(packed.gate).toBe(0);
		expect(packed.claim_truncated).toBe(1);
		expect(packed.text).toContain("## Constraints");
		expect(injectTokens(packed.text)).toBeLessThanOrEqual(INJECT_CAP);
	});

	it("does not leftover-fill past the cap", () => {
		const packed = packInject({
			headers: "# h",
			dest: "",
			bodiesMd: "body",
			claimedMd: "",
			counts: "c",
			fill: Array.from({ length: 500 }, (_, i) => `fill-${i}-${"z".repeat(80)}`),
		});
		expect(injectTokens(packed.text)).toBeLessThanOrEqual(INJECT_CAP);
	});
});

describe("bound inject occupancy", () => {
	it("missing occupancy renders Gated Edge (all live bodies)", () => {
		const packed = renderInject({
			session: session({ occupancy: null }),
			branch: [],
			firstKeptId: "u1",
			config: DEFAULTS,
			projectRecords: [
				constraint("c-all", "never X", "all"),
				constraint("c-q2", "only q2", ["q2"]),
				question("q1", "claimed work"),
			],
		});
		expect(packed.text).toContain("occupancy: gated-edge");
		expect(packed.text).toContain("never X");
		expect(packed.text).toContain("only q2");
		expect(injectTokens(packed.text)).toBeLessThanOrEqual(INJECT_CAP);
	});

	it("claim-strip omits unapplied bodies", () => {
		const packed = renderInject({
			session: session({ occupancy: "claim-strip" }),
			branch: [],
			firstKeptId: "u1",
			config: DEFAULTS,
			projectRecords: [
				constraint("c-all", "never X", "all"),
				constraint("c-q2", "only q2", ["q2"]),
				question("q1", "claimed work"),
			],
		});
		expect(packed.text).toContain("occupancy: claim-strip");
		expect(packed.text).toContain("never X");
		expect(packed.text).not.toContain("only q2");
	});
});

