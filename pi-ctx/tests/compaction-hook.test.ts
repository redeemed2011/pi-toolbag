import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerCompactionHook } from "../src/hooks/compaction-hook.js";
import { INJECT_CAP, injectTokens } from "../src/render/estimate.js";
import { Runtime } from "../src/runtime.js";
import { userMsg } from "./fixtures.js";

type HookResult = Awaited<ReturnType<ReturnType<typeof captureHook>>>;

function captureHook(runtime: Runtime) {
	let handler: (event: unknown, ctx: unknown) => Promise<unknown> = async () => undefined;
	registerCompactionHook(
		{
			on(_event: string, fn: (event: unknown, ctx: unknown) => Promise<unknown>) {
				handler = fn;
			},
		} as unknown as ExtensionAPI,
		runtime,
	);
	return handler;
}

function ctxOf(
	branch: ReturnType<typeof userMsg>[],
	over: { throwOnBranch?: boolean; hasUI?: boolean; throwAfter?: number } = {},
) {
	const cwd = mkdtempSync(join(tmpdir(), "ctx-hook-"));
	let reads = 0;
	return {
		hasUI: over.hasUI ?? false,
		cwd,
		sessionManager: {
			getBranch: () => {
				reads += 1;
				if (over.throwOnBranch) throw new Error("branch boom");
				if (over.throwAfter !== undefined && reads > over.throwAfter) throw new Error("stale branch");
				return branch;
			},
		},
		ui: { notify: () => {} },
	};
}

const branch = [userMsg("u1", "hello")];
const event = {
	preparation: { firstKeptEntryId: "u1", tokensBefore: 99 },
	branchEntries: branch,
};

describe("session_before_compact", () => {
	it("returns undefined only when disabled or passive", async () => {
		const off = new Runtime();
		off.enabled = false;
		expect(await captureHook(off)(event, ctxOf(branch))).toBeUndefined();

		const passive = new Runtime();
		passive.config.passive = true;
		expect(await captureHook(passive)(event, ctxOf(branch))).toBeUndefined();
	});

	it("ensureConfig does not pick occupancy from the operator home settings", async () => {
		const runtime = new Runtime();
		const result = (await captureHook(runtime)(event, ctxOf(branch))) as {
			compaction: { details: { occupancy: string } };
		};
		expect(runtime.config.occupancy).toBe("gated-edge");
		expect(runtime.config.models.observer).toBeUndefined();
		expect(result.compaction.details.occupancy).toBe("gated-edge");
	});

	it("enabled hook returns a typed compaction summary, never undefined", async () => {
		const runtime = new Runtime();
		const result = (await captureHook(runtime)(event, ctxOf(branch))) as {
			compaction: { summary: string; firstKeptEntryId: string; tokensBefore: number; details: { type: string } };
		};
		expect(result).toBeTruthy();
		expect(result.compaction.summary).toContain("no project bound");
		expect(result.compaction.firstKeptEntryId).toBe("u1");
		expect(result.compaction.tokensBefore).toBe(99);
		expect(result.compaction.details.type).toBe("ctx.folded");
		expect(injectTokens(result.compaction.summary)).toBeLessThanOrEqual(INJECT_CAP);
	});

	it("duplicate in-flight cancels instead of returning undefined", async () => {
		const runtime = new Runtime();
		runtime.compactHookInFlight = true;
		expect(await captureHook(runtime)(event, ctxOf(branch, { hasUI: true }))).toEqual({ cancel: true });
	});

	it("renderer exception returns recall_error, not undefined", async () => {
		const runtime = new Runtime();
		runtime.claimedId = "q1";
		const result = (await captureHook(runtime)(event, ctxOf(branch, { throwOnBranch: true }))) as {
			compaction: { summary: string; details: { recall_error?: number; gate: number } };
		};
		expect(result).toBeTruthy();
		expect(result.compaction.summary).toContain("recall_error=1");
		expect(result.compaction.summary).toContain("no constraint bodies this cycle");
		expect(result.compaction.details.recall_error).toBe(1);
		expect(result.compaction.details.gate).toBe(1);
		expect(injectTokens(result.compaction.summary)).toBeLessThanOrEqual(INJECT_CAP);
	});

	it("a stale getBranch after the observer wait keeps the branch already read", async () => {
		const runtime = new Runtime();
		runtime.observersInFlight.set("obs", {
			controller: new AbortController(),
			coversUpToId: "not-in-branch",
		});
		const result = (await captureHook(runtime)(event, ctxOf(branch, { throwAfter: 1 }))) as {
			compaction: { summary: string };
		};
		expect(runtime.lastCompactionObserverWait).toBe("waited");
		expect(result.compaction.summary).toContain("no project bound");
		expect(result.compaction.summary).not.toContain("recall_error");
	});

	it("malformed event still returns recall_error (never undefined)", async () => {
		const runtime = new Runtime();
		const result = (await captureHook(runtime)({}, ctxOf(branch))) as HookResult;
		expect(result).toBeTruthy();
		expect(result).not.toEqual({ cancel: true });
		expect(JSON.stringify(result)).toContain("recall_error");
	});
});
