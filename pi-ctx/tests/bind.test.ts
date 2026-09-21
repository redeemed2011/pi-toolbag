import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBindFlow, runUnbind } from "../src/commands/bind.js";
import { foldSession } from "../src/fold.js";
import type { Hitl } from "../src/hitl.js";
import { Runtime } from "../src/runtime.js";
import { appendProjectRecord, createProject, loadProjectLive, readProjectMeta } from "../src/store/project.js";
import { CTX_BIND, type Entry } from "../src/types.js";
import { recorded } from "./fixtures.js";

function scriptedHitl(plan: {
	selects?: Array<string | undefined>;
	confirms?: boolean[];
	inputs?: Array<string | undefined>;
	hasUI?: boolean;
}): Hitl {
	const selects = [...(plan.selects ?? [])];
	const confirms = [...(plan.confirms ?? [])];
	const inputs = [...(plan.inputs ?? [])];
	return {
		hasUI: plan.hasUI ?? true,
		select: async () => selects.shift(),
		confirm: async () => confirms.shift() ?? false,
		input: async () => inputs.shift(),
		notify: () => {},
	};
}

describe("bind HITL", () => {
	const prev = process.env.CTX_HOME;
	let home: string;

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "ctx-home-"));
		process.env.CTX_HOME = home;
	});

	afterEach(() => {
		if (prev === undefined) delete process.env.CTX_HOME;
		else process.env.CTX_HOME = prev;
	});

	it("print mode refuses bind; does not write a project", async () => {
		const runtime = new Runtime();
		runtime.sessionId = "sess";
		const result = await runBindFlow({
			pi: { appendEntry: () => {} },
			runtime,
			hitl: scriptedHitl({ hasUI: false }),
			cwd: "/tmp/work",
			branch: [],
			suggestedName: "silent",
		});
		expect(result).toEqual({ ok: false, error: "bind requires HITL" });
		expect(runtime.bound).toBe(false);
	});

	it("binds with confirm, writes project.json without occupancy, unbind drops the pointer", async () => {
		const runtime = new Runtime();
		runtime.sessionId = "sess-a";
		const entries: Array<{ type: string; data: unknown }> = [];
		const pi = {
			appendEntry: (customType: string, data?: unknown) => {
				entries.push({ type: customType, data });
			},
		};
		const result = await runBindFlow({
			pi,
			runtime,
			hitl: scriptedHitl({
				selects: ["new: my-app — agent suggestion"],
				confirms: [true],
			}),
			cwd: "/tmp/work",
			branch: [],
			suggestedName: "my-app",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(runtime.bound).toBe(true);
		expect(runtime.projectId).toBe("my-app");
		expect(runtime.occupancy).toBe(null);
		const meta = readProjectMeta("my-app", home);
		expect(meta?.name).toBe("my-app");
		const raw = JSON.parse(readFileSync(join(home, "projects/my-app/project.json"), "utf-8")) as Record<
			string,
			unknown
		>;
		expect(raw).not.toHaveProperty("occupancy");
		expect(entries.some((e) => e.type === CTX_BIND)).toBe(true);

		const unbound = runUnbind({ pi, runtime, hitl: scriptedHitl({ hasUI: true }) });
		expect(unbound.ok).toBe(true);
		expect(runtime.bound).toBe(false);
		expect(readProjectMeta("my-app", home)?.id).toBe("my-app");

		const second = await runBindFlow({
			pi,
			runtime,
			hitl: scriptedHitl({
				selects: ["existing: my-app [my-app] — already on disk"],
				confirms: [true],
			}),
			cwd: "/tmp/work",
			branch: [],
		});
		expect(second.ok).toBe(true);
	});

	it("refuses a second bind until unbind", async () => {
		const runtime = new Runtime();
		runtime.sessionId = "sess";
		runtime.bound = true;
		runtime.projectId = "already";
		const result = await runBindFlow({
			pi: { appendEntry: () => {} },
			runtime,
			hitl: scriptedHitl({ confirms: [true] }),
			cwd: "/tmp/work",
			branch: [],
		});
		expect(result).toEqual({ ok: false, error: "already bound; unbind first" });
	});

	it("does not dump observations into law on bind", async () => {
		const runtime = new Runtime();
		runtime.sessionId = "sess-a";
		const confirms: string[] = [];
		const selects: string[] = [];
		const branch: Entry[] = [recorded("r1", "u1", ["never reopen packing"])];
		const result = await runBindFlow({
			pi: { appendEntry: () => {} },
			runtime,
			hitl: {
				hasUI: true,
				select: async (title, options) => {
					selects.push(title);
					return options.find((o) => o.startsWith("new: lawless")) ?? options[0];
				},
				confirm: async (title) => {
					confirms.push(title);
					return true;
				},
				input: async () => undefined,
				notify: () => {},
			},
			cwd: "/tmp/work",
			branch,
			suggestedName: "lawless",
		});
		expect(result.ok).toBe(true);
		expect(runtime.bound).toBe(true);
		expect(confirms).toEqual(["Confirm bind"]);
		expect(selects).toEqual(["Bind ctx project (never silent)"]);
		const live = loadProjectLive("lawless", home);
		expect([...live.live]).toEqual([]);
	});

	it("two writers two files; fold unions; no last-writer-wins", () => {
		createProject("shared", "shared", home);
		appendProjectRecord(
			"shared",
			"sess-a",
			{
				id: "c1",
				type: "constraint",
				ts: "1",
				session: "sess-a",
				headline: "A",
				body: "A",
				directive: "A",
				applies_to: "all",
			},
			home,
		);
		appendProjectRecord(
			"shared",
			"sess-b",
			{
				id: "c2",
				type: "constraint",
				ts: "2",
				session: "sess-b",
				headline: "B",
				body: "B",
				directive: "B",
				applies_to: "all",
			},
			home,
		);
		const live = loadProjectLive("shared", home);
		expect([...live.live].sort()).toEqual(["c1", "c2"]);
	});

	it("defaults session inject on when the session has no ctx.enabled entry", () => {
		const fold = foldSession([], "s");
		expect(fold.enabled).toBe(true);
		expect(fold.bound).toBe(false);
		expect(fold.occupancy).toBe(null);
		expect(fold.claimedId).toBe(null);
	});

	it("folds spec project_id and unbind null", () => {
		const bound = foldSession(
			[{ type: "custom", id: "b", customType: CTX_BIND, data: { project_id: "p1", project_name: "P" } }],
			"s",
		);
		expect(bound).toMatchObject({ bound: true, projectId: "p1" });
		const unbound = foldSession(
			[
				{ type: "custom", id: "b", customType: CTX_BIND, data: { project_id: "p1", project_name: "P" } },
				{ type: "custom", id: "u", customType: CTX_BIND, data: { project_id: null } },
			],
			"s",
		);
		expect(unbound.bound).toBe(false);
		expect(unbound.projectId).toBe(null);
	});
});
