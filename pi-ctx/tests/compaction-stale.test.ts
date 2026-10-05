import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { registerCtxCommand } from "../src/commands/ctx.js";
import { registerCompactionTrigger } from "../src/hooks/compaction-trigger.js";
import { Runtime } from "../src/runtime.js";

function staleUi() {
	let stale = false;
	let reads = 0;
	const notes: string[] = [];
	const ui = {
		notify(message: string) {
			notes.push(message);
		},
		select: async () => undefined,
		confirm: async () => false,
		input: async () => undefined,
	};
	let callbacks: { onComplete?: () => void; onError?: (error: { message: string }) => void } = {};
	const ctx = {
		get hasUI() {
			if (stale) {
				reads += 1;
				throw new Error("This extension ctx is stale");
			}
			return true;
		},
		get ui() {
			if (stale) {
				reads += 1;
				throw new Error("This extension ctx is stale");
			}
			return ui;
		},
		sessionManager: { getBranch: () => [], getSessionId: () => "sess" },
		getContextUsage: () => ({ tokens: 200_000 }),
		compact(next: typeof callbacks) {
			callbacks = next;
		},
	};
	return {
		ctx,
		notes,
		callbacks: () => callbacks,
		reads: () => reads,
		markStale() {
			stale = true;
		},
	};
}

describe("compaction callbacks", () => {
	it("does not read ctx after compaction finishes", () => {
		const runtime = new Runtime();
		const ui = staleUi();
		let handler: (event: unknown, ctx: unknown) => void = () => {};
		registerCompactionTrigger(
			{
				on(_event: string, fn: typeof handler) {
					handler = fn;
				},
				sendMessage() {},
			} as unknown as ExtensionAPI,
			runtime,
		);
		handler({ message: { role: "assistant", stopReason: "stop" } }, ui.ctx);
		expect(ui.notes).toContain("ctx: context threshold reached — compacting…");
		ui.markStale();
		expect(() => ui.callbacks().onComplete?.()).not.toThrow();
		expect(runtime.compactInFlight).toBe(false);
		expect(ui.reads()).toBe(0);
		expect(ui.notes).toContain("ctx: compaction complete");
	});

	it("reports a stale resume without reading ctx", () => {
		const runtime = new Runtime();
		const ui = staleUi();
		let handler: (event: unknown, ctx: unknown) => void = () => {};
		registerCompactionTrigger(
			{
				on(_event: string, fn: typeof handler) {
					handler = fn;
				},
				sendMessage() {
					throw new Error("This extension ctx is stale");
				},
			} as unknown as ExtensionAPI,
			runtime,
		);
		handler({ toolResults: [{}] }, ui.ctx);
		ui.markStale();
		expect(() => ui.callbacks().onComplete?.()).not.toThrow();
		expect(runtime.lastWorkerError).toMatch(/resume failed/);
		expect(ui.reads()).toBe(0);
		expect(ui.notes.some((line) => line.includes("resume failed"))).toBe(true);
	});

	it("does not read ctx from onError", () => {
		const runtime = new Runtime();
		const ui = staleUi();
		let handler: (event: unknown, ctx: unknown) => void = () => {};
		registerCompactionTrigger(
			{
				on(_event: string, fn: typeof handler) {
					handler = fn;
				},
				sendMessage() {},
			} as unknown as ExtensionAPI,
			runtime,
		);
		handler({ message: { role: "assistant", stopReason: "stop" } }, ui.ctx);
		ui.markStale();
		expect(() => ui.callbacks().onError?.({ message: "boom" })).not.toThrow();
		expect(runtime.compactInFlight).toBe(false);
		expect(ui.reads()).toBe(0);
		expect(ui.notes).toContain("ctx: boom");
	});
});

describe("/ctx compact", () => {
	it("does not read ctx from the compact callbacks", async () => {
		const runtime = new Runtime();
		let handler: (args: string, ctx: unknown) => Promise<void> = async () => {};
		registerCtxCommand(
			{
				registerCommand(_name: string, opts: { handler: typeof handler }) {
					handler = opts.handler;
				},
			} as unknown as ExtensionAPI,
			runtime,
		);
		const ui = staleUi();
		await handler("compact", ui.ctx);
		ui.markStale();
		expect(() => ui.callbacks().onComplete?.()).not.toThrow();
		expect(() => ui.callbacks().onError?.({ message: "boom" })).not.toThrow();
		expect(ui.reads()).toBe(0);
		expect(ui.notes).toContain("ctx: compaction complete");
		expect(ui.notes).toContain("ctx: boom");
	});
});
