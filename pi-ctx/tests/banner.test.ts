import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../src/config.js";
import { mismatchBanner } from "../src/render/banner.js";
import { renderInject } from "../src/render/inject.js";
import type { Observation, SessionFold } from "../src/types.js";
import { constraint, obs, question, userMsg } from "./fixtures.js";

const branch = [userMsg("u0", "before"), userMsg("u1", "kept"), userMsg("u2", "tail")];

const records = [
	constraint("c-all", "never reopen packing", "all"),
	question("q1", "claimed work"),
	question("q2", "other work"),
];

function session(over: Partial<SessionFold> = {}): SessionFold {
	return {
		enabled: true,
		bound: true,
		projectId: "p",
		claimedId: "q1",
		occupancy: null,
		observations: [],
		recency: [],
		...over,
	};
}

function bannerLine(text: string): string | undefined {
	return text.split("\n").find((line) => line.startsWith("tail_claim:"));
}

function render(over: Partial<SessionFold> = {}) {
	return renderInject({
		session: session(over),
		branch,
		firstKeptId: "u1",
		config: DEFAULTS,
		projectRecords: records,
	});
}

describe("mismatchBanner", () => {
	it("MATCH when stamped tail rows exist and all match claimed_id", () => {
		const observations: Observation[] = [
			obs("o1", "about claimed", "u1", "q1"),
			obs("o2", "also claimed", "u2", "q1"),
		];
		expect(
			mismatchBanner({
				session: session(),
				claimEmpty: false,
				claimNotLive: false,
				firstKeptId: "u1",
				branch,
				observations,
			}),
		).toBe("tail_claim: MATCH 0");
	});

	it("DIVERGED n is mismatch count; no ids", () => {
		const observations: Observation[] = [
			obs("o1", "about claimed", "u1", "q1"),
			obs("o2", "about other", "u2", "q2"),
			obs("o3", "also other", "u2", "q2"),
		];
		const line = mismatchBanner({
			session: session(),
			claimEmpty: false,
			claimNotLive: false,
			firstKeptId: "u1",
			branch,
			observations,
		});
		expect(line).toBe("tail_claim: DIVERGED 2");
		expect(line).not.toMatch(/o[123]|q[12]/);
	});

	it("omits when claim_empty, claim_not_live, or zero stamped tail rows", () => {
		const diverged: Observation[] = [obs("o2", "about other", "u2", "q2")];
		const unstamped: Observation[] = [obs("o1", "no stamp", "u2")];
		const beforeCut: Observation[] = [obs("o0", "old other", "u0", "q2")];
		expect(
			mismatchBanner({
				session: session({ claimedId: null }),
				claimEmpty: true,
				claimNotLive: false,
				firstKeptId: "u1",
				branch,
				observations: diverged,
			}),
		).toBeUndefined();
		expect(
			mismatchBanner({
				session: session({ claimedId: "gone" }),
				claimEmpty: false,
				claimNotLive: true,
				firstKeptId: "u1",
				branch,
				observations: diverged,
			}),
		).toBeUndefined();
		expect(
			mismatchBanner({
				session: session(),
				claimEmpty: false,
				claimNotLive: false,
				firstKeptId: "u1",
				branch,
				observations: unstamped,
			}),
		).toBeUndefined();
		expect(
			mismatchBanner({
				session: session(),
				claimEmpty: false,
				claimNotLive: false,
				firstKeptId: "u1",
				branch,
				observations: beforeCut,
			}),
		).toBeUndefined();
	});
});

describe("mismatchBanner on inject", () => {
	it("GE and CS emit MATCH/DIVERGED without retargeting claimed_id", () => {
		const matchObs = [obs("o1", "about claimed", "u1", "q1")];
		const ge = session({ observations: matchObs, recency: matchObs });
		const gePacked = renderInject({
			session: ge,
			branch,
			firstKeptId: "u1",
			config: DEFAULTS,
			projectRecords: records,
		});
		expect(bannerLine(gePacked.text)).toBe("tail_claim: MATCH 0");
		expect(ge.claimedId).toBe("q1");

		const divergedObs = [obs("o1", "about claimed", "u1", "q1"), obs("o2", "about other", "u2", "q2")];
		const cs = session({ occupancy: "claim-strip", observations: divergedObs, recency: divergedObs });
		const csPacked = renderInject({
			session: cs,
			branch,
			firstKeptId: "u1",
			config: DEFAULTS,
			projectRecords: records,
		});
		expect(bannerLine(csPacked.text)).toBe("tail_claim: DIVERGED 1");
		expect(cs.claimedId).toBe("q1");
	});

	it("close+compact does not emit DIVERGED", () => {
		const packed = render({
			claimedId: null,
			observations: [obs("o2", "about other", "u2", "q2")],
		});
		expect(packed.text).toContain("claim_empty:1");
		expect(bannerLine(packed.text)).toBeUndefined();
		expect(packed.text).not.toContain("DIVERGED");
	});

	it("stale claim omits banner and keeps stored id", () => {
		const packed = render({
			claimedId: "gone",
			observations: [obs("o2", "about other", "u2", "q2")],
		});
		expect(packed.text).toContain("claim_not_live:1");
		expect(packed.text).toContain("gone");
		expect(bannerLine(packed.text)).toBeUndefined();
		expect(packed.text).not.toContain("DIVERGED");
	});
});
