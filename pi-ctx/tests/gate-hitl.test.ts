import { describe, expect, it } from "vitest";
import { GATE_REFUSE, GATE_SPLIT, GATE_SUPERSEDE, runRecordFlow } from "../src/commands/record.js";
import type { Hitl } from "../src/hitl.js";
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

const twenty = Array.from({ length: 20 }, (_, i) => constraint(`c${i}`, "x"));
const input = {
	type: "constraint" as const,
	headline: "another",
	directive: "another",
	applies_to: "all" as const,
	session: "s",
};

const base = {
	enabled: true,
	bound: true,
	occupancy: "gated-edge" as const,
	siblingKnob: 0 as const,
	claimedId: null as string | null,
	existing: [...twenty, question("q1", "work"), question("q2", "other")],
	input,
};

describe("mint GATE overflow HITL", () => {
	it("print stays refuse gate and does not write", async () => {
		const result = await runRecordFlow({
			...base,
			hitl: scriptedHitl({ hasUI: false, selects: [GATE_SUPERSEDE] }),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("gate");
			if ("would_gate_ge" in result) expect(result.would_gate_ge).toBe(1);
		}
	});

	it("TUI refuse-first select; picking refuse stays gate", async () => {
		const confirms: boolean[] = [];
		const optionLists: string[][] = [];
		const hitl: Hitl = {
			hasUI: true,
			select: async (_title, options) => {
				optionLists.push(options);
				return options[0];
			},
			confirm: async () => {
				confirms.push(true);
				return true;
			},
			input: async () => undefined,
			notify: () => {},
		};
		const result = await runRecordFlow({ ...base, hitl });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe("gate");
		expect(optionLists[0]?.[0]).toBe(GATE_REFUSE);
		expect(confirms).toEqual([]);
	});

	it("TUI cancel on GATE select stays gate (refuse-default)", async () => {
		const result = await runRecordFlow({
			...base,
			hitl: scriptedHitl({ selects: [undefined] }),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe("gate");
	});

	it("TUI cancel after picking supersede does not write", async () => {
		const result = await runRecordFlow({
			...base,
			hitl: scriptedHitl({ selects: [GATE_SUPERSEDE, undefined] }),
		});
		expect(result).toEqual({ ok: false, error: "cancelled" });
	});

	it("TUI supersede retries and mints when GATE clears", async () => {
		const result = await runRecordFlow({
			...base,
			hitl: scriptedHitl({
				selects: [GATE_SUPERSEDE, "c0 — c0"],
			}),
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.record.supersedes).toEqual(["c0"]);
			expect(result.record.reason_class).toBe("decision_change");
			expect(result.would_gate_ge).toBe(0);
		}
	});

	it("TUI split retries on claim-strip when narrowing applies_to clears GATE", async () => {
		const result = await runRecordFlow({
			...base,
			occupancy: "claim-strip",
			claimedId: "q1",
			hitl: scriptedHitl({
				selects: [GATE_SPLIT, "q2 — q2"],
			}),
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.record.applies_to).toEqual(["q2"]);
			expect(result.would_gate_cs).toBe(0);
		}
	});

	it("TUI split on gated-edge still refuses gate (bodies dump regardless of applies_to)", async () => {
		const result = await runRecordFlow({
			...base,
			hitl: scriptedHitl({
				selects: [GATE_SPLIT, "q2 — q2"],
			}),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe("gate");
	});

	it("mechanical put/executeRecord still refuses gate without HITL", () => {
		const result = executeRecord({
			enabled: true,
			bound: true,
			occupancy: "gated-edge",
			siblingKnob: 0,
			claimedId: null,
			existing: twenty,
			input,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe("gate");
	});
});
