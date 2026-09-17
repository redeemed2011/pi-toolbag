import { describe, expect, it } from "vitest";
import { runRecordFlow } from "../src/commands/record.js";
import type { Hitl } from "../src/hitl.js";
import { putJudgment } from "../src/mint.js";
import { executeRecord } from "../src/tools/record.js";
import { constraint, question } from "./fixtures.js";

function scriptedHitl(
	plan: {
		selects?: Array<string | undefined>;
		confirms?: boolean[];
		hasUI?: boolean;
	} = {},
): Hitl {
	const selects = [...(plan.selects ?? [])];
	const confirms = [...(plan.confirms ?? [])];
	return {
		hasUI: plan.hasUI ?? true,
		select: async () => selects.shift(),
		confirm: async () => confirms.shift() ?? false,
		input: async () => undefined,
		notify: () => {},
	};
}

function sameHeadline(id: string, headline: string) {
	return { ...constraint(id, headline), headline };
}

const input = {
	type: "constraint" as const,
	headline: "never reopen x",
	directive: "never reopen x",
	applies_to: "all" as const,
	session: "s",
};

const base = {
	enabled: true,
	bound: true,
	occupancy: "gated-edge" as const,
	siblingKnob: 0 as const,
	claimedId: null as string | null,
	existing: [question("q1", "work"), sameHeadline("c1", "Never reopen X")],
	input,
};

describe("live_conflict HITL", () => {
	it("print stays refuse live_conflict and does not write", async () => {
		const selects: string[] = [];
		const hitl: Hitl = {
			hasUI: false,
			select: async (title, options) => {
				selects.push(title, ...options);
				return options[0];
			},
			confirm: async () => true,
			input: async () => undefined,
			notify: () => {},
		};
		const result = await runRecordFlow({ ...base, hitl });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("live_conflict");
			if ("conflict_ids" in result) expect(result.conflict_ids).toEqual(["c1"]);
		}
		expect(selects).toEqual([]);
	});

	it("TUI cancel on select does not write", async () => {
		const result = await runRecordFlow({
			...base,
			hitl: scriptedHitl({ selects: [undefined] }),
		});
		expect(result).toEqual({ ok: false, error: "cancelled" });
	});

	it("TUI select supersedes the picked live constraint with reason_class conflict", async () => {
		const result = await runRecordFlow({
			...base,
			hitl: scriptedHitl({ selects: ["c1 — Never reopen X"] }),
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.record.supersedes).toEqual(["c1"]);
			expect(result.record.reason_class).toBe("conflict");
		}
	});

	it("TUI conflicts_with select retires the explicit edge", async () => {
		const result = await runRecordFlow({
			...base,
			existing: [question("q1", "work"), constraint("c1", "other law")],
			input: { ...input, headline: "new law", directive: "new law", conflicts_with: ["c1"] },
			hitl: scriptedHitl({ selects: ["c1 — c1"] }),
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.record.supersedes).toEqual(["c1"]);
			expect(result.record.reason_class).toBe("conflict");
			expect(result.record.conflicts_with).toEqual(["c1"]);
		}
	});

	it("TUI leftover pair after one supersede stays mechanical live_conflict (no HITL loop)", async () => {
		const selects: string[] = [];
		const hitl: Hitl = {
			hasUI: true,
			select: async (title, options) => {
				selects.push(title, ...options);
				return options[0];
			},
			confirm: async () => true,
			input: async () => undefined,
			notify: () => {},
		};
		const result = await runRecordFlow({
			...base,
			existing: [
				question("q1", "work"),
				sameHeadline("c1", "Never reopen X"),
				sameHeadline("c2", "never  reopen  x"),
			],
			hitl,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe("live_conflict");
		expect(selects).toEqual(["Supersede which live constraint?", "c1 — Never reopen X", "c2 — never  reopen  x"]);
	});

	it("writer-supplied supersedes + reason_class conflict mints without HITL", async () => {
		const selects: string[] = [];
		const hitl: Hitl = {
			hasUI: true,
			select: async (title) => {
				selects.push(title);
				return undefined;
			},
			confirm: async () => true,
			input: async () => undefined,
			notify: () => {},
		};
		const result = await runRecordFlow({
			...base,
			input: { ...input, supersedes: "c1", reason_class: "conflict" },
			hitl,
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.record.supersedes).toEqual(["c1"]);
		expect(selects).toEqual([]);
	});

	it("mechanical put/executeRecord still refuses live_conflict without HITL", () => {
		const put = putJudgment({
			occupancy: "gated-edge",
			siblingKnob: 0,
			claimedId: null,
			existing: base.existing,
			input,
		});
		expect(put.ok).toBe(false);
		if (!put.ok) {
			expect(put.error).toBe("live_conflict");
			expect(put.conflict_ids).toEqual(["c1"]);
		}
		const exec = executeRecord({
			enabled: true,
			bound: true,
			occupancy: "gated-edge",
			siblingKnob: 0,
			claimedId: null,
			existing: base.existing,
			input,
		});
		expect(exec.ok).toBe(false);
		if (!exec.ok) expect(exec.error).toBe("live_conflict");
	});
});
