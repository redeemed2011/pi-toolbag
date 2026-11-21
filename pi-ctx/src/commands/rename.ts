import type { Hitl } from "../hitl.js";
import type { Runtime } from "../runtime.js";
import { publishBoundStatus, type StatusSink } from "../render/bound-status.js";
import { renameProject, slugify } from "../store/project.js";
import { CTX_BIND } from "../types.js";
import type { BindPi, BindResult } from "./bind.js";

/** Rename the bound project. The old id stays an alias, so other sessions bound to it keep working. */
export async function runRenameFlow(opts: {
	pi: BindPi;
	runtime: Runtime;
	hitl: Hitl;
	name: string;
	status?: StatusSink;
}): Promise<BindResult> {
	const { pi, runtime, hitl } = opts;
	const name = opts.name.trim();
	if (!runtime.enabled) return { ok: false, error: "ctx is off" };
	if (!runtime.bound || !runtime.projectId) return { ok: false, error: "not bound" };
	if (!name) return { ok: false, error: "usage: /ctx rename <new name>" };
	if (!hitl.hasUI) return { ok: false, error: "rename requires HITL" };
	const from = runtime.projectId;
	const ok = await hitl.confirm(
		"Rename ctx project",
		`Rename project [${from}] to "${name}" [${slugify(name)}]? Its folder moves. [${from}] stays an alias, so every session still bound to it keeps reading and writing this project. Records are not rewritten.`,
	);
	if (!ok) return { ok: false, error: "cancelled" };
	const result = renameProject(from, name);
	if (!result.ok) return { ok: false, error: result.error };
	pi.appendEntry(CTX_BIND, { project_id: result.meta.id, project_name: result.meta.name });
	runtime.projectId = result.meta.id;
	runtime.reloadProject();
	publishBoundStatus(opts.status, { bound: true, projectId: result.meta.id, projectName: result.meta.name });
	hitl.notify(`renamed ${from} to ${result.meta.id}`, "info");
	return { ok: true, project_id: result.meta.id, project_name: result.meta.name };
}
