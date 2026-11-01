import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerCtxCommand } from "../src/commands/ctx.js";
import { registerCompactionHook } from "../src/hooks/compaction-hook.js";
import { registerCompactionTrigger } from "../src/hooks/compaction-trigger.js";
import { Runtime } from "../src/runtime.js";
import { CTX_RESUME } from "../src/types.js";
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
	let compacts = 0;
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
		isIdle: () => true,
		compact(next: typeof callbacks) {
			compacts += 1;
			callbacks = next;
		},
	};
	return {
		ctx,
		notes,
		callbacks: () => callbacks,
		reads: () => reads,
		compacts: () => compacts,
		markStale() {
			stale = true;
		},
	};
}

function install(
	runtime: Runtime,
	sendMessage: (message: unknown, options?: unknown) => void = () => {},
) {
	const ui = staleUi();
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	registerCompactionTrigger(
		{
			on(event: string, fn: (event: unknown, ctx: unknown) => unknown) {
				handlers.set(event, fn);
			},
			sendMessage,
		} as unknown as ExtensionAPI,
		runtime,
	);
	return {
		ui,
		turn(event: unknown) {
			return handlers.get("turn_end")?.(event, ui.ctx);
		},
		settle(event: unknown = {}) {
			return handlers.get("agent_settled")?.(event, ui.ctx);
		},
	};
}

describe("compaction callbacks", () => {
	it("does not read ctx after compaction finishes", async () => {
		const runtime = new Runtime();
		const armed = install(runtime);
		armed.turn({ message: { role: "assistant", stopReason: "stop" } });
		expect(armed.ui.compacts()).toBe(0);
		const pending = armed.settle();
		expect(armed.ui.notes).toContain("ctx: context threshold reached — compacting…");
		armed.ui.markStale();
		expect(() => armed.ui.callbacks().onComplete?.()).not.toThrow();
		await pending;
		expect(runtime.compactInFlight).toBe(false);
		expect(armed.ui.reads()).toBe(0);
		expect(armed.ui.notes).toContain("ctx: compaction complete");
	});

	it("reports a stale resume without reading ctx", async () => {
		const runtime = new Runtime();
		const armed = install(runtime, () => {
			throw new Error("This extension ctx is stale");
		});
		armed.ui.ctx.isIdle = () => false;
		armed.turn({ toolResults: [{}] });
		const pending = armed.settle();
		armed.ui.markStale();
		expect(() => armed.ui.callbacks().onComplete?.()).not.toThrow();
		await pending;
		expect(runtime.lastWorkerError).toMatch(/resume failed/);
		expect(armed.ui.reads()).toBe(0);
		expect(armed.ui.notes.some((line) => line.includes("resume failed"))).toBe(true);
	});

	it("does not read ctx from onError", async () => {
		const runtime = new Runtime();
		const armed = install(runtime);
		armed.turn({ message: { role: "assistant", stopReason: "stop" } });
		const pending = armed.settle();
		armed.ui.markStale();
		expect(() => armed.ui.callbacks().onError?.({ message: "boom" })).not.toThrow();
		await pending;
		expect(runtime.compactInFlight).toBe(false);
		expect(armed.ui.reads()).toBe(0);
		expect(armed.ui.notes).toContain("ctx: boom");
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

describe("deferred compaction", () => {
	it("does not call ctx.compact() on a tool turn until settle", () => {
		const runtime = new Runtime();
		const armed = install(runtime);
		armed.turn({ toolResults: [{}] });
		expect(armed.ui.compacts()).toBe(0);
		expect(runtime.compactInFlight).toBe(true);
		const pending = armed.settle();
		expect(armed.ui.compacts()).toBe(1);
		armed.ui.callbacks().onComplete?.();
		return pending;
	});

	it("blocks a second trigger in the same run", () => {
		const runtime = new Runtime();
		const armed = install(runtime);
		armed.turn({ toolResults: [{}] });
		armed.turn({ toolResults: [{}] });
		expect(armed.ui.compacts()).toBe(0);
		expect(runtime.compactInFlight).toBe(true);
		const pending = armed.settle();
		expect(armed.ui.compacts()).toBe(1);
		armed.ui.callbacks().onComplete?.();
		return pending;
	});

	it("does not send CTX_RESUME when the run was not interrupted", async () => {
		const runtime = new Runtime();
		const sent: unknown[] = [];
		const armed = install(runtime, (message) => {
			sent.push(message);
		});
		armed.turn({ toolResults: [{}] });
		const pending = armed.settle();
		expect(runtime.compactResume).toBe(false);
		armed.ui.callbacks().onComplete?.();
		await pending;
		expect(sent).toEqual([]);
	});

	it("sends a resume only when compaction aborts a live run", async () => {
		const runtime = new Runtime();
		const sent: { customType?: string }[] = [];
		const armed = install(runtime, (message) => {
			sent.push(message as { customType?: string });
		});
		armed.ui.ctx.isIdle = () => false;
		armed.turn({ message: { role: "assistant", stopReason: "stop" } });
		const pending = armed.settle();
		expect(runtime.compactResume).toBe(true);
		armed.ui.callbacks().onComplete?.();
		await pending;
		expect(sent.map((message) => message.customType)).toEqual([CTX_RESUME]);
		expect(runtime.compactResume).toBe(false);
	});
});

describe("compactResume", () => {
	function arm(runtime: Runtime, sendMessage: () => void = () => {}) {
		const armed = install(runtime, sendMessage);
		let duringCompact = false;
		const inner = armed.ui.ctx.compact.bind(armed.ui.ctx);
		armed.ui.ctx.compact = (next) => {
			duringCompact = runtime.compactResume;
			inner(next);
		};
		return {
			...armed,
			duringCompact: () => duringCompact,
		};
	}

	it("is true inside the hook when compaction aborts a live run, then false after onComplete", async () => {
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
		armed.ui.ctx.isIdle = () => false;
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
		armed.turn({ toolResults: [{}] });
		const pending = armed.settle();
		await new Promise((resolve) => setImmediate(resolve));
		expect(seen).toBe(true);
		expect(runtime.compactResume).toBe(true);
		expect(() => armed.ui.callbacks().onComplete?.()).not.toThrow();
		await pending;
		expect(runtime.compactResume).toBe(false);
	});

	it.each(["Compaction cancelled", "Nothing to compact (session too small)", "Already compacted"])(
		"is false after onError %s",
		async (message) => {
			const runtime = new Runtime();
			const armed = arm(runtime);
			armed.ui.ctx.isIdle = () => false;
			armed.turn({ toolResults: [{}] });
			const pending = armed.settle();
			expect(runtime.compactResume).toBe(true);
			expect(() => armed.ui.callbacks().onError?.({ message })).not.toThrow();
			await pending;
			expect(runtime.compactResume).toBe(false);
		},
	);

	it("is set false when the run was not interrupted", async () => {
		const runtime = new Runtime();
		runtime.compactResume = true;
		const armed = arm(runtime);
		armed.turn({ message: { role: "assistant", stopReason: "stop" } });
		const pending = armed.settle();
		expect(armed.duringCompact()).toBe(false);
		expect(runtime.compactResume).toBe(false);
		armed.ui.callbacks().onComplete?.();
		await pending;
		expect(runtime.compactResume).toBe(false);
	});
});
