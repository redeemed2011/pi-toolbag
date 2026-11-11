import { describe, expect, it } from "vitest";
import { gateAgentMessage, runRecordFlow } from "../src/commands/record.js";
import type { Hitl } from "../src/hitl.js";
import { executeRecord } from "../src/tools/record.js";
import { constraint, question } from "./fixtures.js";

function throwingHitl(): Hitl {
	return {
		hasUI: true,
		select: async () => {
			throw new Error("dialog");
		},
		confirm: async () => {
			throw new Error("dialog");
		},
		input: async () => {
			throw new Error("dialog");
		},
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

describe("mint GATE overflow", () => {
	it("returns the full list to the agent and does not open a dialog", async () => {
		const result = await runRecordFlow({ ...base, hitl: throwingHitl() });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("gate");
			expect("message" in result ? result.message : "").toBe(gateAgentMessage("gated-edge"));
			expect("message" in result ? result.message : "").toContain("Narrowing applies_to does not shrink");
			expect("message" in result ? result.message : "").toContain("tell the user");
			if ("would_gate_ge" in result) expect(result.would_gate_ge).toBe(1);
		}
	});

	it("print stays refuse gate and does not write", async () => {
		const result = await runRecordFlow({
			...base,
			hitl: { ...throwingHitl(), hasUI: false },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("gate");
			expect("message" in result ? result.message : "").toBe(gateAgentMessage("gated-edge"));
		}
	});

	it("claim-strip tells the agent a different question can shrink the list", async () => {
		const result = await runRecordFlow({
			...base,
			occupancy: "claim-strip",
			claimedId: "q1",
			hitl: throwingHitl(),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("gate");
			expect("message" in result ? result.message : "").toBe(gateAgentMessage("claim-strip"));
			expect("message" in result ? result.message : "").toContain("other than the claimed question");
		}
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
