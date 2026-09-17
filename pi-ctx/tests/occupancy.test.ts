import { describe, expect, it } from "vitest";
import { bodySetCS, bodySetGE, foldLive, resolveOccupancy } from "../src/fold.js";
import { claimedSlotCap, claimSlotFits, gateCheck } from "../src/render/occupancy.js";
import { constraint, question } from "./fixtures.js";

describe("resolveOccupancy", () => {
	it("defaults to gated-edge when session has no override", () => {
		expect(resolveOccupancy({ occupancy: null })).toBe("gated-edge");
	});

	it("honors the session override", () => {
		expect(resolveOccupancy({ occupancy: "claim-strip" })).toBe("claim-strip");
	});
});

describe("body sets", () => {
	it("GE dumps all live constraint bodies; CS slices by applies_to", () => {
		const live = foldLive([
			constraint("c-all", "never reopen X", "all"),
			constraint("c-q1", "only for q1", ["q1"]),
			constraint("c-q2", "only for q2", ["q2"]),
			question("q1", "do the thing"),
		]);
		expect(bodySetGE(live).map((c) => c.id).sort()).toEqual(["c-all", "c-q1", "c-q2"]);
		expect(bodySetCS(live, "q1").map((c) => c.id).sort()).toEqual(["c-all", "c-q1"]);
		expect(bodySetCS(live, null).map((c) => c.id)).toEqual(["c-all"]);
	});

	it("keeps two live successors and surfaces live_conflict", () => {
		const a = constraint("c1", "first");
		const b = { ...constraint("c2", "second"), supersedes: ["c0"], ts: "2026-09-14T11:00:00.000Z" };
		const c = { ...constraint("c3", "third"), supersedes: ["c0"], ts: "2026-09-14T12:00:00.000Z" };
		const parent = { ...constraint("c0", "old"), ts: "2026-09-14T09:00:00.000Z" };
		const live = foldLive([parent, b, c, a]);
		expect(live.live.has("c0")).toBe(false);
		expect(live.live.has("c2")).toBe(true);
		expect(live.live.has("c3")).toBe(true);
		expect(live.liveConflict).toContain("c0");
	});
});

describe("GATE", () => {
	it("fires on N>20 or body tokens > 3500", () => {
		expect(gateCheck([constraint("c", "short")]).gate).toBe(0);
		const many = Array.from({ length: 21 }, (_, i) => constraint(`c${i}`, "x"));
		expect(gateCheck(many).gate).toBe(1);
		expect(gateCheck([constraint("big", "y".repeat(3500 * 4 + 4))]).gate).toBe(1);
	});
});

describe("claimed-slot caps", () => {
	it("CS 1200, GE 1500, sibling knob 2 is 1300; missing occupancy is GE", () => {
		expect(claimedSlotCap("claim-strip", 0)).toBe(1200);
		expect(claimedSlotCap("gated-edge", 0)).toBe(1500);
		expect(claimedSlotCap("gated-edge", 2)).toBe(1300);
		expect(claimedSlotCap(resolveOccupancy({ occupancy: null }), 0)).toBe(1500);
		expect(claimSlotFits({ body: "x".repeat(1200 * 4) }, "claim-strip", 0)).toBe(true);
		expect(claimSlotFits({ body: "x".repeat(1200 * 4 + 4) }, "claim-strip", 0)).toBe(false);
		expect(claimSlotFits({ body: "x".repeat(1500 * 4 + 4) }, "gated-edge", 0)).toBe(false);
		expect(claimSlotFits({ body: "x".repeat(1300 * 4 + 4) }, "gated-edge", 2)).toBe(false);
	});
});

describe("CS at 20 globals", () => {
	it("20× applies all collapses the CS body set to GE", () => {
		const live = foldLive([
			...Array.from({ length: 20 }, (_, i) => constraint(`c${i}`, "x", "all")),
			question("q1", "work"),
		]);
		expect(bodySetCS(live, "q1").map((c) => c.id)).toEqual(bodySetGE(live).map((c) => c.id));
	});
});

