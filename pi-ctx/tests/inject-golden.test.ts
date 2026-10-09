import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../src/config.js";
import { INJECT_CAP, injectTokens } from "../src/render/estimate.js";
import { renderInject } from "../src/render/inject.js";
import type { Config } from "../src/config.js";
import type { JudgmentRecord, SessionFold } from "../src/types.js";
import { constraint, obs, question } from "./fixtures.js";

const session = (over: Partial<SessionFold> = {}): SessionFold => ({
	enabled: true,
	bound: true,
	projectId: "p",
	claimedId: "q1",
	occupancy: null,
	observations: [],
	recency: [],
	grantId: null,
	grantQuestionId: null,
	...over,
});

const records: JudgmentRecord[] = [
	constraint("c-all", "never reopen packing", "all"),
	constraint("c-q1", "only for q1", ["q1"]),
	constraint("c-q2", "only for q2", ["q2"]),
	question("q1", "claimed work"),
	question("q2", "other work"),
];

function render(over: Partial<SessionFold> = {}, extra: JudgmentRecord[] = [], config: Config = DEFAULTS) {
	return renderInject({
		session: session(over),
		branch: [],
		firstKeptId: "u1",
		config,
		projectRecords: [...records, ...extra],
	});
}

describe("golden inject / slot table", () => {
	it("missing occupancy is Gated Edge: all live bodies, 8k cap, GATE=0", () => {
		const packed = render({ occupancy: null });
		expect(packed.text).toContain("occupancy: gated-edge");
		expect(packed.text).toContain("never reopen packing");
		expect(packed.text).toContain("only for q1");
		expect(packed.text).toContain("only for q2");
		expect(packed.text).toContain("claimed work");
		expect(packed.text).toContain("gate:0");
		expect(packed.gate).toBe(0);
		expect(injectTokens(packed.text)).toBeLessThanOrEqual(INJECT_CAP);
	});

	it("Claim Strip omits unapplied bodies and keeps the 8k cap", () => {
		const packed = render({ occupancy: "claim-strip" });
		expect(packed.text).toContain("occupancy: claim-strip");
		expect(packed.text).toContain("never reopen packing");
		expect(packed.text).toContain("only for q1");
		expect(packed.text).not.toContain("only for q2");
		expect(packed.text).toContain("unapplied:1");
		expect(packed.gate).toBe(0);
		expect(injectTokens(packed.text)).toBeLessThanOrEqual(INJECT_CAP);
	});

	it("empty claim on CS keeps globals only, claim_empty, no frontier dump", () => {
		const packed = render({ occupancy: "claim-strip", claimedId: null });
		expect(packed.text).toContain("claim_empty:1");
		expect(packed.text).toContain("never reopen packing");
		expect(packed.text).not.toContain("only for q1");
		expect(packed.text).not.toContain("only for q2");
		expect(packed.text).not.toContain("## Claimed");
		expect(packed.text).not.toContain("other work");
		expect(injectTokens(packed.text)).toBeLessThanOrEqual(INJECT_CAP);
	});

	it("GATE=1 overflow has zero constraint bodies and stays ≤8000", () => {
		const many = Array.from({ length: 21 }, (_, i) => constraint(`c${i}`, "short body", "all"));
		const packed = render({ occupancy: null, claimedId: "q1" }, many);
		expect(packed.gate).toBe(1);
		expect(packed.text).toContain("gate=1");
		expect(packed.text).not.toContain("## Constraints");
		expect(packed.text).not.toContain("short body");
		expect(injectTokens(packed.text)).toBeLessThanOrEqual(INJECT_CAP);
	});

	it("stale claim stays stored: not_live, no retarget", () => {
		const packed = render({ claimedId: "gone" });
		expect(packed.text).toContain("claim_not_live:1");
		expect(packed.text).toContain("gone");
		expect(packed.text).not.toContain("## Claimed\nclaimed work");
	});

	it("CS recency is claim-stamped only; GE recency is all-session fill", () => {
		const observations = [
			obs("o-q1", "about claimed", "u0", "q1"),
			obs("o-q2", "about other", "u0", "q2"),
		];
		const ge = render({ occupancy: null, observations, recency: observations });
		expect(ge.text).toContain("about claimed");
		expect(ge.text).toContain("about other");
		const cs = render({ occupancy: "claim-strip", observations, recency: observations });
		expect(cs.text).toContain("about claimed");
		expect(cs.text).not.toContain("about other");
	});

	it("GE siblings are fill under knob 2; knob 0 has none", () => {
		const withSiblings = render({}, [], { ...DEFAULTS, gatedEdgeSiblingHeadlines: 2 });
		expect(withSiblings.text).toContain("## Siblings");
		expect(withSiblings.text).toContain("- q2 (q2)");
		const noSiblings = render({}, [], { ...DEFAULTS, gatedEdgeSiblingHeadlines: 0 });
		expect(noSiblings.text).not.toContain("## Siblings");
	});
});
