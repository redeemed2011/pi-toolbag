import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBindFlow, runUnbind } from "../src/commands/bind.js";
import { registerCtxCommand } from "../src/commands/ctx.js";
import type { Hitl } from "../src/hitl.js";
import { registerSessionStart } from "../src/hooks/session-start.js";
import {
	BOUND_STATUS_KEY,
	boundStatusText,
	publishBoundStatus,
	publishRuntimeBoundStatus,
	statusSink,
} from "../src/render/bound-status.js";
import { Runtime } from "../src/runtime.js";
import { createProject } from "../src/store/project.js";
import { registerTools } from "../src/tools/register.js";
import { CTX_BIND, CTX_ENABLED, type Entry } from "../src/types.js";

function bindEntry(projectId: string | null, id = "b"): Entry {
	return { type: "custom", id, customType: CTX_BIND, data: { project_id: projectId } };
}

function enabledEntry(enabled: boolean): Entry {
	return { type: "custom", id: "e", customType: CTX_ENABLED, data: { enabled } };
}

function scriptedHitl(plan: {
	selects?: Array<string | undefined>;
	confirms?: boolean[];
	hasUI?: boolean;
}): Hitl {
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

describe("bound footer status", () => {
	const prev = process.env.CTX_HOME;
	let home: string;

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "ctx-status-"));
		process.env.CTX_HOME = home;
	});

	afterEach(() => {
		if (prev === undefined) delete process.env.CTX_HOME;
		else process.env.CTX_HOME = prev;
	});

	it("shows the project name when bound and clears the slot when not", () => {
		expect(boundStatusText({ bound: true, projectId: "wayfinder", projectName: "Wayfinder" })).toBe("ctx: Wayfinder");
		expect(boundStatusText({ bound: true, projectId: "wayfinder", projectName: "  " })).toBe("ctx: wayfinder");
		expect(boundStatusText({ bound: true, projectId: "wayfinder" })).toBe("ctx: wayfinder");
		expect(boundStatusText({ bound: false, projectId: "wayfinder", projectName: "Wayfinder" })).toBeUndefined();
		expect(boundStatusText({ bound: true, projectId: null, projectName: "Wayfinder" })).toBeUndefined();
		expect(boundStatusText({ bound: true, projectId: "wayfinder", projectName: "Wayfinder" })).not.toContain("occupancy");
		expect(BOUND_STATUS_KEY).toBe("ctx");
	});

	it("publishes the label and swallows a dead UI", () => {
		const calls: Array<[string, string | undefined]> = [];
		publishBoundStatus((key, text) => calls.push([key, text]), {
			bound: true,
			projectId: "wayfinder",
			projectName: "Wayfinder",
		});
		publishBoundStatus((key, text) => calls.push([key, text]), { bound: false, projectId: "wayfinder" });
		expect(calls).toEqual([
			["ctx", "ctx: Wayfinder"],
			["ctx", undefined],
		]);
		expect(() => publishBoundStatus(undefined, { bound: true, projectId: "wayfinder", projectName: "Wayfinder" })).not.toThrow();
		expect(() =>
			publishBoundStatus(() => {
				throw new Error("stale ctx");
			}, { bound: true, projectId: "wayfinder", projectName: "Wayfinder" }),
		).not.toThrow();
	});

	it("does not read the UI when there is none, and ignores a disposed ctx", () => {
		const sink = statusSink({
			hasUI: false,
			get ui(): { setStatus: () => void } {
				throw new Error("ui touched");
			},
		});
		expect(sink).toBeUndefined();
		expect(statusSink({ get hasUI(): boolean { throw new Error("stale"); } })).toBeUndefined();
		expect(statusSink({ hasUI: true, ui: {} })).toBeUndefined();
		const calls: Array<[string, string | undefined]> = [];
		const live = statusSink({ hasUI: true, ui: { setStatus: (key, text) => calls.push([key, text]) } });
		live?.("other", "nope");
		expect(calls).toEqual([["other", "nope"]]);
	});

	it("uses project.json for the name and the id when that read fails", () => {
		createProject("Wayfinder", "wayfinder", home);
		const calls: Array<string | undefined> = [];
		const setStatus = (_key: string, text: string | undefined) => calls.push(text);
		publishRuntimeBoundStatus(setStatus, { bound: true, projectId: "wayfinder" });
		publishRuntimeBoundStatus(setStatus, { bound: true, projectId: "missing" });
		publishRuntimeBoundStatus(setStatus, { bound: false, projectId: "wayfinder" });
		publishRuntimeBoundStatus(setStatus, { bound: true, projectId: "wayfinder" }, () => {
			throw new Error("disk");
		});
		publishRuntimeBoundStatus(setStatus, { bound: true, projectId: "wayfinder" }, () => "   ");
		expect(calls).toEqual(["ctx: Wayfinder", "ctx: missing", undefined, "ctx: wayfinder", "ctx: wayfinder"]);
	});

	describe("session start", () => {
		function fire(runtime: Runtime, branch: Entry[], ctx: Record<string, unknown>) {
			const handlers = new Map<string, (event: unknown, ctx: unknown) => void>();
			registerSessionStart(
				{
					on(event: string, fn: (event: unknown, ctx: unknown) => void) {
						handlers.set(event, fn);
					},
				} as unknown as ExtensionAPI,
				runtime,
			);
			handlers.get("session_start")?.({}, ctx);
		}

		it("shows the bound project name", () => {
			createProject("Wayfinder", "wayfinder", home);
			const calls: Array<[string, string | undefined]> = [];
			const runtime = new Runtime();
			fire(runtime, [enabledEntry(false), bindEntry("wayfinder")], {
				cwd: "/tmp/work",
				hasUI: true,
				ui: { setStatus: (key: string, text: string | undefined) => calls.push([key, text]) },
				sessionManager: { getBranch: () => [enabledEntry(false), bindEntry("wayfinder")], getSessionId: () => "sess" },
			});
			expect(runtime.bound).toBe(true);
			expect(runtime.enabled).toBe(false);
			expect(calls).toEqual([["ctx", "ctx: Wayfinder"]]);
		});

		it("falls back to the id when the project file is missing", () => {
			const calls: Array<string | undefined> = [];
			fire(new Runtime(), [bindEntry("wayfinder")], {
				cwd: "/tmp/work",
				hasUI: true,
				ui: { setStatus: (_key: string, text: string | undefined) => calls.push(text) },
				sessionManager: { getBranch: () => [bindEntry("wayfinder")], getSessionId: () => "sess" },
			});
			expect(calls).toEqual(["ctx: wayfinder"]);
		});

		it("clears the slot when the resumed session is unbound", () => {
			const calls: Array<string | undefined> = [];
			const runtime = new Runtime();
			runtime.bound = true;
			runtime.projectId = "stale";
			fire(runtime, [bindEntry("wayfinder"), bindEntry(null, "u")], {
				cwd: "/tmp/work",
				hasUI: true,
				ui: { setStatus: (_key: string, text: string | undefined) => calls.push(text) },
				sessionManager: {
					getBranch: () => [bindEntry("wayfinder"), bindEntry(null, "u")],
					getSessionId: () => "sess",
				},
			});
			expect(runtime.bound).toBe(false);
			expect(calls).toEqual([undefined]);
		});

		it("does not throw without a UI or when setStatus throws", () => {
			expect(() =>
				fire(new Runtime(), [bindEntry("wayfinder")], {
					cwd: "/tmp/work",
					hasUI: false,
					get ui() {
						throw new Error("ui touched");
					},
					sessionManager: { getBranch: () => [bindEntry("wayfinder")] },
				}),
			).not.toThrow();
			expect(() =>
				fire(new Runtime(), [], {
					cwd: "/tmp/work",
					hasUI: true,
					ui: {
						setStatus() {
							throw new Error("stale");
						},
					},
					sessionManager: { getBranch: () => [] },
				}),
			).not.toThrow();
		});
	});

	describe("bind flow", () => {
		it("sets the footer only after a confirmed bind, and clears it on unbind", async () => {
			const calls: Array<string | undefined> = [];
			const status = (_key: string, text: string | undefined) => calls.push(text);
			const runtime = new Runtime();
			runtime.sessionId = "sess";
			const result = await runBindFlow({
				pi: { appendEntry: () => {} },
				runtime,
				hitl: scriptedHitl({ selects: ["new: Wayfinder — agent suggestion"], confirms: [true] }),
				cwd: "/tmp/work",
				branch: [],
				suggestedName: "Wayfinder",
				status,
			});
			expect(result.ok).toBe(true);
			expect(calls).toEqual(["ctx: Wayfinder"]);

			const unbound = runUnbind({ pi: { appendEntry: () => {} }, runtime, hitl: scriptedHitl({}), status });
			expect(unbound.ok).toBe(true);
			expect(runtime.bound).toBe(false);
			expect(calls).toEqual(["ctx: Wayfinder", undefined]);
		});

		it("does not touch the footer when bind or unbind is refused", async () => {
			const calls: Array<string | undefined> = [];
			const status = (_key: string, text: string | undefined) => calls.push(text);
			const runtime = new Runtime();
			runtime.sessionId = "sess";
			const cancelled = await runBindFlow({
				pi: { appendEntry: () => {} },
				runtime,
				hitl: scriptedHitl({ selects: [undefined] }),
				cwd: "/tmp/work",
				branch: [],
				suggestedName: "Wayfinder",
				status,
			});
			expect(cancelled).toEqual({ ok: false, error: "cancelled" });

			const headless = await runBindFlow({
				pi: { appendEntry: () => {} },
				runtime,
				hitl: scriptedHitl({ hasUI: false }),
				cwd: "/tmp/work",
				branch: [],
				suggestedName: "Wayfinder",
				status,
			});
			expect(headless).toEqual({ ok: false, error: "bind requires HITL" });

			runtime.enabled = false;
			const off = await runBindFlow({
				pi: { appendEntry: () => {} },
				runtime,
				hitl: scriptedHitl({ confirms: [true] }),
				cwd: "/tmp/work",
				branch: [],
				status,
			});
			expect(off).toEqual({ ok: false, error: "ctx is off" });
			const unbindOff = runUnbind({ pi: { appendEntry: () => {} }, runtime, hitl: scriptedHitl({}), status });
			expect(unbindOff).toEqual({ ok: false, error: "ctx is off" });

			runtime.enabled = true;
			const notBound = runUnbind({ pi: { appendEntry: () => {} }, runtime, hitl: scriptedHitl({}), status });
			expect(notBound).toEqual({ ok: false, error: "not bound" });

			runtime.bound = true;
			runtime.projectId = "already";
			const second = await runBindFlow({
				pi: { appendEntry: () => {} },
				runtime,
				hitl: scriptedHitl({ confirms: [true] }),
				cwd: "/tmp/work",
				branch: [],
				status,
			});
			expect(second).toEqual({ ok: false, error: "already bound; unbind first" });
			expect(calls).toEqual([]);
		});
	});

	describe("/ctx command", () => {
		function command(runtime: Runtime) {
			let handler: (args: string, ctx: unknown) => Promise<void> = async () => {};
			registerCtxCommand(
				{
					registerCommand(_name: string, opts: { handler: typeof handler }) {
						handler = opts.handler;
					},
					appendEntry() {},
				} as unknown as ExtensionAPI,
				runtime,
			);
			return handler;
		}

		function uiCtx(branch: Entry[], calls: Array<string | undefined>, notes: string[]) {
			return {
				cwd: "/tmp/work",
				hasUI: true,
				ui: {
					notify(message: string) {
						notes.push(message);
					},
					select: async (title: string, options: string[]) => {
						void title;
						return options.find((option) => option.startsWith("new: Wayfinder"));
					},
					confirm: async () => true,
					input: async () => undefined,
					setStatus: (_key: string, text: string | undefined) => calls.push(text),
				},
				sessionManager: { getBranch: () => branch, getSessionId: () => "sess" },
			};
		}

		it("shows the name after bind and drops it after unbind", async () => {
			const calls: Array<string | undefined> = [];
			const notes: string[] = [];
			const runtime = new Runtime();
			const handler = command(runtime);
			await handler("bind Wayfinder", uiCtx([], calls, notes));
			expect(calls.at(-1)).toBe("ctx: Wayfinder");
			expect(runtime.bound).toBe(true);

			const boundBranch = [bindEntry("wayfinder")];
			await handler("unbind", uiCtx(boundBranch, calls, notes));
			expect(calls.at(-1)).toBeUndefined();
			expect(runtime.bound).toBe(false);
			expect(calls.some((text) => text?.includes("occupancy"))).toBe(false);
		});

		it("keeps the name when unbind is refused because ctx is off", async () => {
			createProject("Wayfinder", "wayfinder", home);
			const calls: Array<string | undefined> = [];
			const notes: string[] = [];
			const runtime = new Runtime();
			const handler = command(runtime);
			await handler("unbind", uiCtx([enabledEntry(false), bindEntry("wayfinder")], calls, notes));
			expect(runtime.bound).toBe(true);
			expect(runtime.enabled).toBe(false);
			expect(calls).toEqual(["ctx: Wayfinder"]);
			expect(notes).toContain("ctx is off");
		});

		it("refreshes a resumed binding on status without copying the model line", async () => {
			createProject("Wayfinder", "wayfinder", home);
			const calls: Array<string | undefined> = [];
			const notes: string[] = [];
			const handler = command(new Runtime());
			await handler("status", uiCtx([bindEntry("wayfinder")], calls, notes));
			expect(calls).toEqual(["ctx: Wayfinder"]);
			expect(notes.join(" ")).toContain("occupancy=");
			expect(notes.join(" ")).toContain("bound=wayfinder");
		});

		it("does not show a name when bind is cancelled or there is no UI", async () => {
			const calls: Array<string | undefined> = [];
			const runtime = new Runtime();
			const handler = command(runtime);
			await handler("bind Wayfinder", {
				cwd: "/tmp/work",
				hasUI: true,
				ui: {
					notify() {},
					select: async () => undefined,
					confirm: async () => true,
					input: async () => undefined,
					setStatus: (_key: string, text: string | undefined) => calls.push(text),
				},
				sessionManager: { getBranch: () => [] as Entry[], getSessionId: () => "sess" },
			});
			expect(calls).toEqual([undefined]);
			expect(runtime.bound).toBe(false);

			await expect(
				handler("bind Wayfinder", {
					cwd: "/tmp/work",
					hasUI: false,
					get ui() {
						throw new Error("ui touched");
					},
					sessionManager: { getBranch: () => [] as Entry[], getSessionId: () => "sess" },
				}),
			).resolves.toBeUndefined();
			expect(runtime.bound).toBe(false);
		});
	});

	describe("ctx_bind tool", () => {
		it("sets the footer after the tool binds and not when bind is refused", async () => {
			const calls: Array<string | undefined> = [];
			const tools = new Map<string, { execute: (...args: never[]) => Promise<{ details: unknown }> }>();
			registerTools(
				{
					registerTool: (tool: { name: string; execute: (...args: never[]) => Promise<{ details: unknown }> }) => {
						tools.set(tool.name, tool);
					},
					appendEntry: () => {},
				} as never,
				new Runtime(),
			);
			const execute = tools.get("ctx_bind")!.execute;
			const bound = await execute(
				"call" as never,
				{ name: "Wayfinder" } as never,
				undefined as never,
				undefined as never,
				{
					hasUI: true,
					cwd: "/tmp/work",
					ui: {
						notify() {},
						select: async (_title: string, options: string[]) => options.find((option) => option.startsWith("new: Wayfinder")),
						confirm: async () => true,
						input: async () => undefined,
						setStatus: (_key: string, text: string | undefined) => calls.push(text),
					},
					sessionManager: { getBranch: () => [], getSessionId: () => "sess" },
				} as never,
			);
			expect(bound.details).toMatchObject({ ok: true, project_name: "Wayfinder" });
			expect(calls).toEqual(["ctx: Wayfinder"]);

			const refused = await execute(
				"call" as never,
				{} as never,
				undefined as never,
				undefined as never,
				{
					hasUI: false,
					cwd: "/tmp/work",
					get ui() {
						throw new Error("ui touched");
					},
					sessionManager: { getBranch: () => [], getSessionId: () => "sess" },
				} as never,
			);
			expect(refused.details).toEqual({ ok: false, error: "bind requires HITL" });
			expect(calls).toEqual(["ctx: Wayfinder"]);
		});
	});
});
