import { basename } from "node:path";
import type { Hitl } from "../hitl.js";
import type { Runtime } from "../runtime.js";
import { createProject, listProjects, readProjectMeta, slugify } from "../store/project.js";
import { harvestAfterBind, type HarvestReceipt, type PromoterRunFn } from "../promoter/run.js";
import { CTX_BIND, type Entry } from "../types.js";

export type BindPi = { appendEntry: (customType: string, data?: unknown) => void };

export type BindResult =
	| { ok: true; project_id: string; project_name: string; harvest?: HarvestReceipt }
	| { ok: false; error: string };

function suggestedNames(opts: {
	suggested?: string;
	cwd: string;
	destinationHeadline?: string;
}): { name: string; why: string }[] {
	const out: { name: string; why: string }[] = [];
	const seen = new Set<string>();
	const add = (name: string, why: string) => {
		const trimmed = name.trim();
		if (!trimmed) return;
		const key = slugify(trimmed);
		if (seen.has(key)) return;
		seen.add(key);
		out.push({ name: trimmed, why });
	};
	if (opts.suggested) add(opts.suggested, "agent suggestion");
	if (opts.destinationHeadline) add(opts.destinationHeadline, "destination headline");
	add(basename(opts.cwd), "working directory");
	return out;
}

async function pickName(
	hitl: Hitl,
	cwd: string,
	suggested?: string,
	destinationHeadline?: string,
): Promise<{ id: string; name: string; create: boolean } | { error: string }> {
	const existing = listProjects();
	const suggestions = suggestedNames({ suggested, cwd, destinationHeadline });
	type Opt = { label: string; kind: "new" | "existing" | "type"; name?: string; id?: string };
	const opts: Opt[] = [
		...suggestions.map((s) => ({
			label: `new: ${s.name} — ${s.why}`,
			kind: "new" as const,
			name: s.name,
			id: slugify(s.name),
		})),
		...existing.map((p) => ({
			label: `existing: ${p.name} [${p.id}] — already on disk`,
			kind: "existing" as const,
			name: p.name,
			id: p.id,
		})),
		{ label: "type a name", kind: "type" },
	];
	const choice = await hitl.select("Bind ctx project (never silent)", opts.map((o) => o.label));
	if (!choice) return { error: "cancelled" };
	const picked = opts.find((o) => o.label === choice);
	if (!picked) return { error: "cancelled" };

	let name = picked.name ?? "";
	if (picked.kind === "type") {
		const typed = await hitl.input("Project name", "ctx-project");
		if (!typed?.trim()) return { error: "cancelled" };
		name = typed.trim();
	}
	if (picked.kind === "existing" && picked.id) {
		return { id: picked.id, name: picked.name ?? picked.id, create: false };
	}
	const id = slugify(name);
	const meta = readProjectMeta(id);
	if (meta) {
		const join = await hitl.confirm(
			"Name collision",
			`Project ${id} already exists as "${meta.name}". Bind this session to it?`,
		);
		if (!join) return { error: "cancelled" };
		return { id: meta.id, name: meta.name, create: false };
	}
	return { id, name, create: true };
}

export async function runBindFlow(opts: {
	pi: BindPi;
	runtime: Runtime;
	hitl: Hitl;
	cwd: string;
	branch: Entry[];
	suggestedName?: string;
	promoterRun?: PromoterRunFn;
	sessionModel?: import("../config.js").SessionModelSource;
}): Promise<BindResult> {
	const { pi, runtime, hitl, cwd, suggestedName } = opts;
	if (!runtime.enabled) return { ok: false, error: "ctx is off" };
	if (runtime.bound && runtime.projectId) {
		return { ok: false, error: "already bound; unbind first" };
	}
	if (!hitl.hasUI) return { ok: false, error: "bind requires HITL" };

	const picked = await pickName(hitl, cwd, suggestedName);
	if ("error" in picked) return { ok: false, error: picked.error };

	const ok = await hitl.confirm(
		"Confirm bind",
		`Bind this session to "${picked.name}" [${picked.id}]? Occupancy stays Gated Edge. This does not dump the session. After Yes, a nested promoter may record up to 10 short house rules you stated in this chat (checked against live law). Unclear is skipped. Fights with live law become pending-replace for you to decide.`,
	);
	if (!ok) return { ok: false, error: "cancelled" };

	if (picked.create) createProject(picked.name, picked.id);
	const meta = readProjectMeta(picked.id) ?? createProject(picked.name, picked.id);
	pi.appendEntry(CTX_BIND, { project_id: meta.id, project_name: meta.name });
	runtime.bound = true;
	runtime.projectId = meta.id;
	runtime.reloadProject();
	let harvest: HarvestReceipt | undefined;
	try {
		harvest = await harvestAfterBind({
			pi,
			runtime,
			hitl,
			branch: opts.branch,
			projectName: meta.name,
			promoterRun: opts.promoterRun,
			sessionModel: opts.sessionModel,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		hitl.notify(`Promoted none (${message})`, "warning");
		harvest = { promoted: [], pending: 0, skipped: 0, note: message };
	}
	return { ok: true, project_id: meta.id, project_name: meta.name, harvest };
}

export function runUnbind(opts: { pi: BindPi; runtime: Runtime; hitl: Hitl }): BindResult {
	const { pi, runtime, hitl } = opts;
	if (!runtime.enabled) return { ok: false, error: "ctx is off" };
	if (!runtime.bound) return { ok: false, error: "not bound" };
	pi.appendEntry(CTX_BIND, { project_id: null });
	runtime.bound = false;
	runtime.projectId = null;
	runtime.reloadProject();
	hitl.notify("unbound (project law kept)", "info");
	return { ok: true, project_id: "", project_name: "" };
}
