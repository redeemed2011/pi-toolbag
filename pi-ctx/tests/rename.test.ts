import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runRenameFlow } from "../src/commands/rename.js";
import type { Hitl } from "../src/hitl.js";
import { Runtime } from "../src/runtime.js";
import { resolveProjectId } from "../src/store/paths.js";
import { appendProjectRecord, createProject, listProjects, loadProjectRecords, readProjectMeta, renameProject } from "../src/store/project.js";
import { CTX_BIND, type Entry } from "../src/types.js";

const recorded = (r: { id: string; type: string; headline: string }) => ({ ...r, ts: `2026-11-21T00:00:0${r.id.slice(1)}.000Z`, session: "old-session", body: r.headline });

const hitl = (confirm: boolean, hasUI = true): Hitl => ({
	hasUI,
	select: async () => undefined,
	confirm: async () => confirm,
	input: async () => undefined,
	notify: () => {},
});

describe("project rename", () => {
	const prev = process.env.CTX_HOME;
	let home: string;

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "ctx-rename-"));
		process.env.CTX_HOME = home;
		createProject("apple-pi", "apple-pi");
		appendProjectRecord("apple-pi", "old-session", recorded({ id: "d1", type: "decision", headline: "kept" }));
	});

	afterEach(() => {
		if (prev === undefined) delete process.env.CTX_HOME;
		else process.env.CTX_HOME = prev;
	});

	it("moves the folder, keeps the old id as an alias, and keeps every record", () => {
		const result = renameProject("apple-pi", "brazos");
		expect(result.ok).toBe(true);
		expect(existsSync(join(home, "projects", "apple-pi"))).toBe(false);
		expect(JSON.parse(readFileSync(join(home, "projects", "brazos", "project.json"), "utf-8"))).toMatchObject({ id: "brazos", name: "brazos", aliases: ["apple-pi"] });
		expect(listProjects().map((p) => p.id)).toEqual(["brazos"]);
		expect(loadProjectRecords("brazos").map((r) => r.id)).toEqual(["d1"]);
	});

	it("a session still bound to the old id reads and writes the renamed project", () => {
		renameProject("apple-pi", "brazos");
		expect(resolveProjectId("apple-pi")).toBe("brazos");
		expect(readProjectMeta("apple-pi")?.id).toBe("brazos");
		const runtime = new Runtime();
		const branch: Entry[] = [{ type: "custom", id: "b", customType: CTX_BIND, data: { project_id: "apple-pi" } } as Entry];
		runtime.restoreFromBranch(branch, "old-session");
		expect(runtime.projectId).toBe("brazos");
		expect(runtime.projectLive?.byId.has("d1")).toBe(true);
		appendProjectRecord("apple-pi", "old-session", recorded({ id: "d2", type: "decision", headline: "after" }));
		expect(existsSync(join(home, "projects", "apple-pi"))).toBe(false);
		expect(loadProjectRecords("brazos").map((r) => r.id).sort()).toEqual(["d1", "d2"]);
	});

	it("refuses a name another project holds, and allows renaming back to an old id", () => {
		createProject("other", "other");
		expect(renameProject("apple-pi", "other")).toEqual({ ok: false, error: "project other already exists" });
		renameProject("apple-pi", "brazos");
		const back = renameProject("brazos", "apple-pi");
		expect(back.ok && back.meta).toMatchObject({ id: "apple-pi", aliases: ["brazos"] });
		expect(resolveProjectId("brazos")).toBe("apple-pi");
	});

	it("/ctx rename asks first, renames the bound project, and rebinds this session", async () => {
		const runtime = new Runtime();
		runtime.restoreFromBranch([{ type: "custom", id: "b", customType: CTX_BIND, data: { project_id: "apple-pi" } } as Entry], "s");
		const entries: unknown[] = [];
		const pi = { appendEntry: (type: string, data?: unknown) => entries.push({ type, data }) };
		expect(await runRenameFlow({ pi, runtime, hitl: hitl(false), name: "brazos" })).toEqual({ ok: false, error: "cancelled" });
		expect(await runRenameFlow({ pi, runtime, hitl: hitl(true, false), name: "brazos" })).toEqual({ ok: false, error: "rename requires HITL" });
		expect(readProjectMeta("apple-pi")?.id).toBe("apple-pi");
		const done = await runRenameFlow({ pi, runtime, hitl: hitl(true), name: "brazos" });
		expect(done).toEqual({ ok: true, project_id: "brazos", project_name: "brazos" });
		expect(runtime.projectId).toBe("brazos");
		expect(entries).toEqual([{ type: CTX_BIND, data: { project_id: "brazos", project_name: "brazos" } }]);
	});
});
