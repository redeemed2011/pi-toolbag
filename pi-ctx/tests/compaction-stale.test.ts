import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerCtxCommand } from "../src/commands/ctx.js";
import { registerCompactionHook } from "../src/hooks/compaction-hook.js";
import { registerCompactionTrigger } from "../src/hooks/compaction-trigger.js";
import { Runtime } from "../src/runtime.js";
import { userMsg } from "./fixtures.js";
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

describe("compactResume", () => {
	function arm(runtime: Runtime, sendMessage: () => void = () => {}) {
		const ui = staleUi();
		let duringCompact = false;
		const inner = ui.ctx.compact.bind(ui.ctx);
		ui.ctx.compact = (next) => {
			duringCompact = runtime.compactResume;
			inner(next);
		};
		let handler: (event: unknown, ctx: unknown) => void = () => {};
		registerCompactionTrigger(
			{
				on(_event: string, fn: typeof handler) {
					handler = fn;
				},
				sendMessage,
			} as unknown as ExtensionAPI,
			runtime,
		);
		return {
			ui,
			fire(event: unknown) {
				handler(event, ui.ctx);
			},
			duringCompact: () => duringCompact,
		};
	}

	it("is true inside the hook when the turn will resume, then false after onComplete", async () => {
		const runtime = new Runtime();
		const branch = [userMsg("u1", "hello")];
		const cwd = mkdtempSync(join(tmpdir(), "ctx-resume-"));
		let hook: (event: unknown, ctx: unknown) => Promise<unknown> = async () => undefined;
		registerCompactionHook(
			{
				on(_event: string, fn: (event: unknown, ctx: unknown) => Promise<unknown>) {
					hook = fn;
				},
			} as unknown as ExtensionAPI,
			runtime,
		);
		const armed = arm(runtime);
		let seen = false;
		const inner = armed.ui.ctx.compact.bind(armed.ui.ctx);
		armed.ui.ctx.compact = (next) => {
			inner(next);
			void hook(
				{ preparation: { firstKeptEntryId: "u1", tokensBefore: 99 }, branchEntries: branch },
				{
					hasUI: false,
					cwd,
					sessionManager: { getBranch: () => branch },
					ui: { notify: () => {} },
				},
			).then((result) => {
				const details = (result as { compaction: { details: { resumeInPlace?: boolean } } }).compaction.details;
				seen = details.resumeInPlace === true && runtime.compactResume === true;
			});
		};
		armed.fire({ toolResults: [{}] });
		await new Promise((resolve) => setImmediate(resolve));
		expect(seen).toBe(true);
		expect(runtime.compactResume).toBe(true);
		expect(() => armed.ui.callbacks().onComplete?.()).not.toThrow();
		expect(runtime.compactResume).toBe(false);
	});

	it.each(["Compaction cancelled", "Nothing to compact (session too small)", "Already compacted"])(
		"is false after onError %s",
		(message) => {
			const runtime = new Runtime();
			const armed = arm(runtime);
			armed.fire({ toolResults: [{}] });
			expect(runtime.compactResume).toBe(true);
			expect(() => armed.ui.callbacks().onError?.({ message })).not.toThrow();
			expect(runtime.compactResume).toBe(false);
		},
	);

	it("is set false when the turn will not resume", () => {
		const runtime = new Runtime();
		runtime.compactResume = true;
		const armed = arm(runtime);
		armed.fire({ message: { role: "assistant", stopReason: "stop" } });
		expect(armed.duringCompact()).toBe(false);
		expect(runtime.compactResume).toBe(false);
		armed.ui.callbacks().onComplete?.();
		expect(runtime.compactResume).toBe(false);
	});
});
