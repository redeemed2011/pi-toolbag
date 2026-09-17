import { describe, expect, it } from "vitest";
import { isValidCutPoint, selectSourceSlice } from "../src/progress.js";
import { assistantToolCall, toolResult, userMsg } from "./fixtures.js";

describe("cut points", () => {
	it("never treats a tool result as a valid cut", () => {
		expect(isValidCutPoint(toolResult("tr"))).toBe(false);
		expect(isValidCutPoint(userMsg("u", "hi"))).toBe(true);
		expect(isValidCutPoint(assistantToolCall("a"))).toBe(true);
	});

	it("selectSourceSlice never splits a tool call from its result", () => {
		const entries = [
			userMsg("u1", "a".repeat(40)),
			assistantToolCall("a1"),
			toolResult("t1", "b".repeat(40)),
			userMsg("u2", "c".repeat(40)),
		];
		const slice = selectSourceSlice(entries, "u1", 1);
		const ids = slice.entries.map((e) => e.id);
		expect(ids).toContain("a1");
		expect(ids).toContain("t1");
		expect(ids.indexOf("a1")).toBeLessThan(ids.indexOf("t1"));
		expect(ids).not.toContain("u2");
	});
});
