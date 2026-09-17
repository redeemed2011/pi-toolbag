import { describe, expect, it } from "vitest";
import { canSkipObserverWait, snapCutoff } from "../src/snap.js";
import { assistantMsg, recorded, toolResult, userMsg } from "./fixtures.js";

describe("snapCutoff later-or-equal", () => {
	it("keeps Pi's proposal when no observation boundary exists", () => {
		const branch = [userMsg("u1", "hi"), assistantMsg("a1", "ok")];
		expect(snapCutoff(branch, "u1", 20_000).firstKeptId).toBe("u1");
	});

	it("never snaps to an earlier id (would lengthen the suffix)", () => {
		const branch = [
			userMsg("u1", "one"),
			recorded("r1", "u1", ["early"]),
			userMsg("u2", "two"),
			assistantMsg("a2", "ok"),
			userMsg("u3", "three"),
		];
		const snap = snapCutoff(branch, "u3", 20_000);
		const idx = Object.fromEntries(branch.map((e, i) => [e.id, i]));
		expect(idx[snap.firstKeptId]).toBeGreaterThanOrEqual(idx.u3);
	});

	it("does not choose a firstKept that is a tool result", () => {
		const branch = [
			userMsg("u1", "x"),
			recorded("r1", "u1", ["h"]),
			toolResult("tr"),
			userMsg("u2", "y"),
		];
		const snap = snapCutoff(branch, "u2", 20_000);
		expect(snap.firstKeptId).not.toBe("tr");
		expect(snap.firstKeptId).toBe("u2");
	});
});

describe("canSkipObserverWait all-or-nothing", () => {
	const branch = [userMsg("u1", "a"), userMsg("u2", "b"), userMsg("u3", "c")];

	it("skips wait when every in-flight cover is at-or-after the cutoff", () => {
		expect(
			canSkipObserverWait(branch, "u2", 100, 20_000, [{ coversUpToId: "u2" }, { coversUpToId: "u3" }]),
		).toBe(true);
		expect(canSkipObserverWait(branch, "u2", 100, 20_000, [])).toBe(true);
	});

	it("waits if any in-flight cover is before the cutoff", () => {
		expect(
			canSkipObserverWait(branch, "u2", 100, 20_000, [{ coversUpToId: "u1" }, { coversUpToId: "u3" }]),
		).toBe(false);
	});

	it("waits if a cover id is missing from the branch", () => {
		expect(canSkipObserverWait(branch, "u2", 100, 20_000, [{ coversUpToId: "gone" }])).toBe(false);
	});

	it("waits if snapped tail is missing or larger than keepRecent", () => {
		expect(canSkipObserverWait(branch, "u2", undefined, 20_000, [])).toBe(false);
		expect(canSkipObserverWait(branch, "u2", 20_001, 20_000, [])).toBe(false);
	});
});
