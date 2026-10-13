import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateObserverTriggers } from "../src/hooks/observer-trigger.js";
import { Runtime } from "../src/runtime.js";
import { runResultPath, writeObserverResult } from "../src/spawn/runs.js";
import type { Entry } from "../src/types.js";
import { userMsg } from "./fixtures.js";

type Exit = { code: number | null; signal: NodeJS.Signals | null; stderr: string };

const gate = vi.hoisted(() => {
	const jobs: { cwd: string; resolve: (exit: Exit) => void }[] = [];
	return { jobs };
});

vi.mock("../src/spawn/observer.js", async () => {
	const actual = await vi.importActual<typeof import("../src/spawn/observer.js")>("../src/spawn/observer.js");
	return {
		...actual,
		buildWorkerArgv: () => ["node", "pi"],
		spawnWorker: (opts: { cwd: string }) =>
			new Promise<Exit>((resolve) => {
				gate.jobs.push({ cwd: opts.cwd, resolve });
			}),
	};
});

afterEach(() => {
	gate.jobs.length = 0;
});

function triggeringRuntime(): Runtime {
	const runtime = new Runtime();
	runtime.config = { ...runtime.config, chunkTokens: 1, models: { ...runtime.config.models } };
	runtime.sessionId = "sess";
	return runtime;
}

function staleCtx(branch: Entry[], liveHasUI: boolean) {
	let stale = false;
	let readsAfterStale = 0;
	const notifications: { message: string; level?: string }[] = [];
	const ui = {
		notify(message: string, level?: string) {
			notifications.push({ message, level });
		},
	};
	const ctx = {
		get hasUI() {
			if (stale) {
				readsAfterStale += 1;
				throw new Error("This extension ctx is stale");
			}
			return liveHasUI;
		},
		get ui() {
			if (stale) {
				readsAfterStale += 1;
				throw new Error("This extension ctx is stale");
			}
			return ui;
		},
		sessionManager: {
			getBranch: () => branch,
			getSessionId: () => "sess",
		},
	};
	return {
		ctx,
		notifications,
		markStale() {
			stale = true;
		},
		readsAfterStale: () => readsAfterStale,
	};
}

function start(liveHasUI: boolean) {
	const branch = [userMsg("u1", "hello from print mode")];
	const runtime = triggeringRuntime();
	const ui = staleCtx(branch, liveHasUI);
	const appended: { customType: string; data: unknown }[] = [];
	const pi = {
		appendEntry(customType: string, data: unknown) {
			appended.push({ customType, data });
		},
	} as unknown as ExtensionAPI;
	evaluateObserverTriggers(pi, runtime, ui.ctx);
	const task = [...runtime.observerTasks][0];
	if (!task || gate.jobs.length !== 1) throw new Error("observer did not start");
	return { runtime, ui, appended, pi, task, job: gate.jobs[0]! };
}

describe("observer after the session ctx is stale", () => {
	it("settles a successful -p observer without reading hasUI again", async () => {
		const { runtime, ui, appended, task, job } = start(false);
		ui.markStale();
		writeObserverResult(runResultPath(job.cwd), {
			observations: [{ timestamp: "2026-09-14T10:00:00.000Z", content: "noted" }],
		});
		job.resolve({ code: 0, signal: null, stderr: "" });
		await expect(task).resolves.toBeUndefined();
		expect(ui.readsAfterStale()).toBe(0);
		expect(appended.map((entry) => entry.customType)).toEqual(["ctx.observations.recorded"]);
		expect(ui.notifications).toEqual([]);
		expect(runtime.lastWorkerError).toBeUndefined();
		expect(runtime.observersInFlight.size).toBe(0);
	});

	it("settles a failed observer from inside the catch without reading hasUI", async () => {
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on("unhandledRejection", onUnhandled);
		try {
			const { runtime, ui, appended, task, job } = start(true);
			ui.markStale();
			job.resolve({ code: 1, signal: null, stderr: "boom" });
			await expect(task).resolves.toBeUndefined();
			await new Promise((resolve) => setImmediate(resolve));
			expect(ui.readsAfterStale()).toBe(0);
			expect(appended).toEqual([]);
			expect(runtime.lastWorkerError).toMatch(/exited with code 1/);
			expect(ui.notifications.some((note) => note.level === "error" && note.message.includes("observer failed"))).toBe(
				true,
			);
			expect(unhandled).toEqual([]);
		} finally {
			process.off("unhandledRejection", onUnhandled);
		}
	});

	it("does not escape when appendEntry rejects a stale pi on the success path", async () => {
		const { runtime, ui, task, job, pi } = start(true);
		(pi as unknown as { appendEntry: () => void }).appendEntry = () => {
			throw new Error("This extension ctx is stale");
		};
		ui.markStale();
		writeObserverResult(runResultPath(job.cwd), {
			observations: [{ timestamp: "2026-09-14T10:00:00.000Z", content: "noted" }],
		});
		job.resolve({ code: 0, signal: null, stderr: "" });
		await expect(task).resolves.toBeUndefined();
		expect(ui.readsAfterStale()).toBe(0);
		expect(runtime.lastWorkerError).toMatch(/stale/);
	});

	const truncated = "Response was truncated: the model reached its output token limit.";

	it("commits observations when print mode exits 1 on a length stop", async () => {
		const { runtime, appended, task, job } = start(false);
		writeObserverResult(runResultPath(job.cwd), {
			observations: [{ timestamp: "2026-09-14T10:00:00.000Z", content: "noted" }],
		});
		job.resolve({ code: 1, signal: null, stderr: truncated });
		await expect(task).resolves.toBeUndefined();
		expect(appended.map((entry) => entry.customType)).toEqual(["ctx.observations.recorded"]);
		expect(runtime.lastWorkerError).toBeUndefined();
	});

	it("does not commit a length stop with no observations", async () => {
		const { runtime, appended, task, job } = start(false);
		writeObserverResult(runResultPath(job.cwd), { observations: [] });
		job.resolve({ code: 1, signal: null, stderr: truncated });
		await expect(task).resolves.toBeUndefined();
		expect(appended).toEqual([]);
		expect(runtime.lastWorkerError).toMatch(/exited with code 1/);
	});

	it("does not commit observations when stderr is not the truncation sentence", async () => {
		const { runtime, appended, task, job } = start(false);
		writeObserverResult(runResultPath(job.cwd), {
			observations: [{ timestamp: "2026-09-14T10:00:00.000Z", content: "noted" }],
		});
		job.resolve({ code: 1, signal: null, stderr: "provider exploded" });
		await expect(task).resolves.toBeUndefined();
		expect(appended).toEqual([]);
		expect(runtime.lastWorkerError).toMatch(/exited with code 1/);
	});

	it("does not commit observations when the worker is signalled", async () => {
		const { runtime, appended, task, job } = start(false);
		writeObserverResult(runResultPath(job.cwd), {
			observations: [{ timestamp: "2026-09-14T10:00:00.000Z", content: "noted" }],
		});
		job.resolve({ code: null, signal: "SIGTERM", stderr: truncated });
		await expect(task).resolves.toBeUndefined();
		expect(appended).toEqual([]);
		expect(runtime.lastWorkerError).toMatch(/exited with code/);
	});

	it("commits an empty cover when print mode exits 0 with no observations", async () => {
		const { runtime, appended, task, job } = start(false);
		writeObserverResult(runResultPath(job.cwd), { observations: [] });
		job.resolve({ code: 0, signal: null, stderr: "" });
		await expect(task).resolves.toBeUndefined();
		expect(appended.map((entry) => entry.customType)).toEqual(["ctx.observations.empty_cover"]);
		expect(runtime.lastWorkerError).toBeUndefined();
	});
});
