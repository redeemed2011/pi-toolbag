import { estimateTokens } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../src/config.js";
import { injectTokens, textTokens } from "../src/render/estimate.js";
import { renderInject } from "../src/render/inject.js";
import { estimateEntryTokens } from "../src/tokens.js";
import { bashHidden, constraint, question, userMsg } from "./fixtures.js";

function piCompactionSummaryTokens(summary: string): number {
	return estimateTokens({
		role: "compactionSummary",
		summary,
		tokensBefore: 0,
		timestamp: 0,
	});
}

describe("injectTokens", () => {
	it("matches Pi chars/4 ceil (compactionSummary)", () => {
		expect(injectTokens("abcd")).toBe(1);
		expect(injectTokens("abcde")).toBe(2);
		expect(injectTokens("")).toBe(0);
	});

	it("is identical to Pi estimateTokens for compactionSummary, including a real inject", () => {
		const packed = renderInject({
			session: {
				enabled: true,
				bound: true,
				projectId: "p",
				claimedId: "q1",
				occupancy: null,
				observations: [],
				recency: [],
				grantId: null,
				grantQuestionId: null,
			},
			branch: [],
			firstKeptId: "u1",
			config: DEFAULTS,
			projectRecords: [constraint("c-all", "never reopen packing", "all"), question("q1", "claimed work")],
		});
		for (const summary of ["", "abcd", "abcde", "x".repeat(17), packed.text]) {
			expect(injectTokens(summary)).toBe(piCompactionSummaryTokens(summary));
			expect(textTokens(summary)).toBe(piCompactionSummaryTokens(summary));
		}
	});
});

describe("clock defaults", () => {
	it("observer chunk is 5k and compact trigger is 150k", () => {
		expect(DEFAULTS.chunkTokens).toBe(5_000);
		expect(DEFAULTS.compactAtContextTokens).toBe(150_000);
	});
});

describe("excludeFromContext clocks", () => {
	it("counts ordinary user text", () => {
		expect(estimateEntryTokens(userMsg("u1", "hello world!!"))).toBeGreaterThan(0);
	});

	it("!! bash contributes 0 to observer/compact clocks", () => {
		expect(estimateEntryTokens(bashHidden("b1"))).toBe(0);
	});
});
