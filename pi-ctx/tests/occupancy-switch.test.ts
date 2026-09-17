import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { occupancyStatusLine, runOccupancyFlow } from "../src/commands/occupancy.js";
import { foldLive } from "../src/fold.js";
import type { Hitl } from "../src/hitl.js";
import { Runtime } from "../src/runtime.js";
import { projectLogsDir } from "../src/store/paths.js";
import { appendProjectRecord, createProject } from "../src/store/project.js";
import { constraint } from "./fixtures.js";

function scriptedHitl(plan: { confirms?: boolean[]; hasUI?: boolean } = {}): Hitl {
	const confirms = [...(plan.confirms ?? [])];
	return {
		hasUI: plan.hasUI ?? true,
		select: async () => undefined,
		confirm: async () => confirms.shift() ?? false,
		input: async () => undefined,
		notify: () => {},
	};
}

function runtimeWithLive(count: number, applies_to: "all" | string[] = "all"): Runtime {
	const runtime = new Runtime();
	runtime.sessionId = "sess";
	runtime.projectRecords = Array.from({ length: count }, (_, i) => constraint(`c${i}`, "x", applies_to));
	runtime.projectLive = foldLive(runtime.projectRecords);
	return runtime;
}

describe("occupancy switch", () => {
	it("shows current occupancy plus both GATE flags", async () => {
		const runtime = runtimeWithLive(21);
		const result = await runOccupancyFlow({
			pi: { appendEntry: () => {} },
			runtime,
			hitl: scriptedHitl({ hasUI: false }),
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.action).toBe("show");
		expect(result.occupancy).toBe("gated-edge");
		expect(result.would_gate_ge).toBe(1);
		expect(result.would_gate_cs).toBe(1);
		expect(occupancyStatusLine(result)).toContain("would_gate_ge=1");
	});

	it("print refuses a switch with a reason and does not write", async () => {
		const runtime = new Runtime();
		const entries: Array<{ type: string; data: unknown }> = [];
		const result = await runOccupancyFlow({
			pi: {
				appendEntry: (customType, data) => {
					entries.push({ type: customType, data });
				},
			},
			runtime,
			hitl: scriptedHitl({ hasUI: false }),
			want: "claim-strip",
		});
		expect(result).toEqual({ ok: false, error: "occupancy switch requires HITL" });
		expect(runtime.occupancy).toBe(null);
		expect(entries).toEqual([]);
	});

	it("print refuses a GATE target with a reason and keeps previous occupancy", async () => {
		const runtime = runtimeWithLive(21, ["q1"]);
		runtime.occupancy = "claim-strip";
		const entries: Array<{ type: string; data: unknown }> = [];
		const result = await runOccupancyFlow({
			pi: {
				appendEntry: (customType, data) => {
					entries.push({ type: customType, data });
				},
			},
			runtime,
			hitl: scriptedHitl({ hasUI: false }),
			want: "gated-edge",
		});
		expect(result).toEqual({
			ok: false,
			error: "occupancy switch refused: target gated-edge would gate=1",
		});
		expect(runtime.occupancy).toBe("claim-strip");
		expect(entries).toEqual([]);
	});

	it("TUI warns with confirm when the target occupancy would gate=1", async () => {
		const runtime = runtimeWithLive(21, ["q1"]);
		runtime.occupancy = "claim-strip";
		const entries: Array<{ type: string; data: unknown }> = [];
		const declined = await runOccupancyFlow({
			pi: {
				appendEntry: (customType, data) => {
					entries.push({ type: customType, data });
				},
			},
			runtime,
			hitl: scriptedHitl({ confirms: [false] }),
			want: "gated-edge",
		});
		expect(declined).toEqual({ ok: false, error: "cancelled" });
		expect(runtime.occupancy).toBe("claim-strip");
		expect(entries).toEqual([]);

		const accepted = await runOccupancyFlow({
			pi: {
				appendEntry: (customType, data) => {
					entries.push({ type: customType, data });
				},
			},
			runtime,
			hitl: scriptedHitl({ confirms: [true] }),
			want: "gated-edge",
		});
		expect(accepted.ok).toBe(true);
		if (accepted.ok) {
			expect(accepted.action).toBe("switched");
			expect(accepted.occupancy).toBe("gated-edge");
		}
		expect(runtime.occupancy).toBe("gated-edge");
		expect(entries).toEqual([{ type: "ctx.occupancy", data: { occupancy: "gated-edge" } }]);
	});

	it("TUI switches without confirm when the target would not gate", async () => {
		const runtime = runtimeWithLive(21, ["q1"]);
		const confirms: boolean[] = [];
		const hitl: Hitl = {
			hasUI: true,
			select: async () => undefined,
			confirm: async () => {
				confirms.push(true);
				return true;
			},
			input: async () => undefined,
			notify: () => {},
		};
		const entries: Array<{ type: string; data: unknown }> = [];
		const result = await runOccupancyFlow({
			pi: {
				appendEntry: (customType, data) => {
					entries.push({ type: customType, data });
				},
			},
			runtime,
			hitl,
			want: "claim-strip",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.action).toBe("switched");
			expect(result.occupancy).toBe("claim-strip");
			expect(result.would_gate_ge).toBe(1);
			expect(result.would_gate_cs).toBe(0);
		}
		expect(confirms).toEqual([]);
		expect(runtime.occupancy).toBe("claim-strip");
		expect(entries).toEqual([{ type: "ctx.occupancy", data: { occupancy: "claim-strip" } }]);
	});

	it("refuses an unknown occupancy name", async () => {
		const result = await runOccupancyFlow({
			pi: { appendEntry: () => {} },
			runtime: new Runtime(),
			hitl: scriptedHitl(),
			want: "gated-strip",
		});
		expect(result).toEqual({ ok: false, error: "ctx occupancy: gated-edge | claim-strip" });
	});
});

describe("occupancy switch does not rewrite project logs", () => {
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

	it("leaves project.json and writer JSONL unchanged", async () => {
		const meta = createProject("switch-test", "switch-test");
		appendProjectRecord(meta.id, "sess", {
			id: "c1",
			type: "constraint",
			ts: "2026-09-14T10:00:00.000Z",
			session: "sess",
			headline: "c1",
			body: "law",
			applies_to: "all",
		});
		const logs = projectLogsDir(meta.id);
		const beforeFiles = readdirSync(logs).sort();
		const before = Object.fromEntries(
			beforeFiles.map((name) => [name, readFileSync(join(logs, name), "utf-8")]),
		);
		const runtime = new Runtime();
		runtime.bound = true;
		runtime.projectId = meta.id;
		runtime.reloadProject();
		await runOccupancyFlow({
			pi: { appendEntry: () => {} },
			runtime,
			hitl: scriptedHitl({ hasUI: true }),
			want: "claim-strip",
		});
		expect(runtime.occupancy).toBe("claim-strip");
		expect(readdirSync(logs).sort()).toEqual(beforeFiles);
		for (const name of beforeFiles) {
			expect(readFileSync(join(logs, name), "utf-8")).toBe(before[name]);
		}
		const raw = JSON.parse(readFileSync(join(home, "projects", meta.id, "project.json"), "utf-8"));
		expect(raw).not.toHaveProperty("occupancy");
	});
});
