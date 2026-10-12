import { describe, expect, it } from "vitest";
import { foldSession } from "../src/fold.js";
import { observationRecordId } from "../src/hooks/observer-trigger.js";
import type { Entry } from "../src/types.js";

function batch(entryId: string, cover: string, rows: { id: string; body: string }[]): Entry {
	return {
		type: "custom",
		id: entryId,
		customType: "ctx.observations.recorded",
		data: {
			coversUpToId: cover,
			observations: rows.map((row) => ({
				id: row.id,
				headline: row.body,
				body: row.body,
				coversUpToId: cover,
				ts: "2026-10-12 16:12",
				session: "s",
			})),
		},
	};
}

describe("same-minute observation ids", () => {
	it("keeps different bodies that were minted with the same minute id", () => {
		const id = "2026-10-12 16:12-0";
		const fold = foldSession([
			batch("a", "u1", [{ id, body: "first fact" }]),
			batch("b", "u2", [{ id, body: "second fact" }]),
		]);
		expect(fold.observations.map((obs) => obs.body)).toEqual(["first fact", "second fact"]);
		expect(fold.observations.map((obs) => obs.id)).toEqual([id, `${id}#2`]);
	});

	it("still drops an exact duplicate id and body", () => {
		const id = "2026-10-12 16:12-0";
		const fold = foldSession([
			batch("a", "u1", [{ id, body: "same" }]),
			batch("b", "u2", [{ id, body: "same" }]),
		]);
		expect(fold.observations).toHaveLength(1);
	});

	it("mints ids that differ across runs in the same minute", () => {
		const ts = "2026-10-12 16:12";
		const first = observationRecordId(ts, "obs-run-a", 0);
		const second = observationRecordId(ts, "obs-run-b", 0);
		expect(first).not.toBe(second);
		const fold = foldSession([
			batch("a", "u1", [{ id: first, body: "first fact" }]),
			batch("b", "u2", [{ id: second, body: "second fact" }]),
		]);
		expect(fold.observations.map((obs) => obs.id)).toEqual([first, second]);
	});
});
