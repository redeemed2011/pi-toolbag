import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../src/config.js";
import { applyFonceA, isFirstCallAfterCompact, sendGuardTokens, stripFooter } from "../src/render/fonce.js";
import { FOOTER_TAG, type SessionFold } from "../src/types.js";
import { assistantMsg, compaction, constraint, question, userMsg } from "./fixtures.js";

const bound: SessionFold = {
	enabled: true,
	bound: true,
	projectId: "p",
	claimedId: "q1",
	occupancy: null,
	observations: [],
	recency: [],
	grantId: null,
	grantQuestionId: null,
};

describe("F-once A", () => {
	it("is first call after compact only when no assistant follows the compaction entry", () => {
		const after = [userMsg("u1", "hi"), assistantMsg("a1", "ok"), compaction("c1", "u1")];
		expect(isFirstCallAfterCompact(after)).toBe(true);
		expect(isFirstCallAfterCompact([...after, assistantMsg("a2", "next")])).toBe(false);
		expect(isFirstCallAfterCompact([userMsg("u1", "hi")])).toBe(false);
	});

	it("appends constitution after the suffix on the first bound call; strips stale footer", () => {
		const branch = [userMsg("u1", "hi"), compaction("c1", "u1")];
		const msgs = applyFonceA(
			[
				{ role: "custom", customType: FOOTER_TAG, content: "stale" },
				{ role: "user", content: "continue" },
			],
			branch,
			bound,
			DEFAULTS,
			{ firstKeptId: "u1", projectRecords: [constraint("c-all", "never X", "all"), question("q1", "work")] },
		);
		expect(msgs.some((m) => m.customType === FOOTER_TAG && m.content === "stale")).toBe(false);
		const footer = msgs.filter((m) => m.customType === FOOTER_TAG);
		expect(footer).toHaveLength(1);
		expect(String(footer[0].content)).toContain("never X");
		expect(msgs[msgs.length - 1].customType).toBe(FOOTER_TAG);
	});

	it("unbound compact has no footer", () => {
		const branch = [userMsg("u1", "hi"), compaction("c1", "u1")];
		const msgs = applyFonceA([{ role: "user", content: "x" }], branch, { ...bound, bound: false }, DEFAULTS);
		expect(stripFooter(msgs)).toEqual(msgs);
		expect(msgs.some((m) => m.customType === FOOTER_TAG)).toBe(false);
	});

	it("later calls in the fill have no footer", () => {
		const branch = [userMsg("u1", "hi"), compaction("c1", "u1"), assistantMsg("a2", "went")];
		const msgs = applyFonceA([{ role: "user", content: "x" }], branch, bound, DEFAULTS, {
			projectRecords: [constraint("c-all", "never X", "all")],
		});
		expect(msgs.some((m) => m.customType === FOOTER_TAG)).toBe(false);
	});

	it("sendGuardTokens adds 8k only on that first bound call", () => {
		const first = [userMsg("u1", "hi"), compaction("c1", "u1")];
		expect(sendGuardTokens(100, first, bound)).toBe(8100);
		expect(sendGuardTokens(100, first, { ...bound, bound: false })).toBe(100);
		expect(sendGuardTokens(100, [...first, assistantMsg("a2", "x")], bound)).toBe(100);
	});
});
