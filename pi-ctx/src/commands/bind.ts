import { basename } from "node:path";
import type { Hitl } from "../hitl.js";
import { proposePromotion } from "../promotion.js";
import { runRecordFlow } from "./record.js";
import { foldSession, promotionDecisions, resolveOccupancy } from "../fold.js";
import type { Runtime } from "../runtime.js";
import { appendProjectRecord, createProject, listProjects, readProjectMeta, slugify } from "../store/project.js";
import { CTX_BIND, CTX_PROMOTION_DECISION, type Entry } from "../types.js";

export type BindPi = { appendEntry: (customType: string, data?: unknown) => void };

export type BindResult = { ok: true; project_id: string; project_name: string } | { ok: false; error: string };

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

async function promotionPass(opts: {
	pi: BindPi;
	runtime: Runtime;
	hitl: Hitl;
	branch: Entry[];
}): Promise<void> {
	const { pi, runtime, hitl, branch } = opts;
	if (!runtime.projectId) return;
	const session = foldSession(branch, runtime.sessionId);
	const occupancy = resolveOccupancy(session, runtime.config.occupancy);
	const skipped = promotionDecisions(branch);
	const { offered, notOffered } = proposePromotion(session.observations, skipped);
	let pool = [...offered];
	if (notOffered.length > 0) {
		hitl.notify(`${notOffered.length} not offered (later clarified)`, "info");
		const override = await hitl.confirm(
			"Later-clarified candidates",
			`${notOffered.map((c) => c.headline).join("; ")}\nOffer any of these anyway?`,
		);
		if (override) {
			for (const c of notOffered) {
				const yes = await hitl.confirm("Offer anyway?", c.wording);
				if (yes) pool.push(c);
			}
		}
	}
	for (const c of pool) {
		const title =
			c.kind === "conditional"
				? "Promote this conditional as a constraint? (not a work question)"
				: "Promote to constraint?";
		const yes = await hitl.confirm(title, c.wording);
		if (!yes) {
			const how = await hitl.select("Decline this candidate", [
				"not final — ask again later",
				"final skip — do not re-ask",
			]);
			const decision = how?.startsWith("final") ? "final_skip" : "not_final";
			pi.appendEntry(CTX_PROMOTION_DECISION, { observation_id: c.observationId, decision });
			continue;
		}
		const applies = await hitl.select("applies_to is required (never defaults to all)", [
			"all — true global / house rule",
			"skip mint — needs question ids",
		]);
		if (!applies || applies.startsWith("skip")) {
			pi.appendEntry(CTX_PROMOTION_DECISION, { observation_id: c.observationId, decision: "not_final" });
			continue;
		}
		const put = await runRecordFlow({
			hitl,
			enabled: runtime.enabled,
			bound: true,
			occupancy,
			siblingKnob: runtime.config.gatedEdgeSiblingHeadlines,
			claimedId: runtime.claimedId,
			existing: runtime.projectRecords,
			input: {
				type: "constraint",
				headline: c.headline,
				directive: c.headline,
				body: c.wording,
				applies_to: "all",
				session: runtime.sessionId,
			},
		});
		if (!put.ok) {
			hitl.notify(`promotion refused: ${put.error}`, "warning");
			pi.appendEntry(CTX_PROMOTION_DECISION, { observation_id: c.observationId, decision: "not_final" });
			continue;
		}
		appendProjectRecord(runtime.projectId, runtime.sessionId, put.line);
		runtime.projectRecords = [...runtime.projectRecords, put.record];
		pi.appendEntry(CTX_PROMOTION_DECISION, { observation_id: c.observationId, decision: "minted" });
	}
	runtime.reloadProject();
}

export async function runBindFlow(opts: {
	pi: BindPi;
	runtime: Runtime;
	hitl: Hitl;
	cwd: string;
	branch: Entry[];
	suggestedName?: string;
}): Promise<BindResult> {
	const { pi, runtime, hitl, cwd, branch, suggestedName } = opts;
	if (!runtime.enabled) return { ok: false, error: "ctx is off" };
	if (runtime.bound && runtime.projectId) {
		return { ok: false, error: "already bound; unbind first" };
	}
	if (!hitl.hasUI) return { ok: false, error: "bind requires HITL" };

	const picked = await pickName(hitl, cwd, suggestedName);
	if ("error" in picked) return { ok: false, error: picked.error };

	const ok = await hitl.confirm(
		"Confirm bind",
		`Bind this session to "${picked.name}" [${picked.id}]? Occupancy stays Gated Edge. Nothing is dumped into law.`,
	);
	if (!ok) return { ok: false, error: "cancelled" };

	if (picked.create) createProject(picked.name, picked.id);
	const meta = readProjectMeta(picked.id) ?? createProject(picked.name, picked.id);
	pi.appendEntry(CTX_BIND, { project_id: meta.id, project_name: meta.name });
	runtime.bound = true;
	runtime.projectId = meta.id;
	runtime.reloadProject();
	await promotionPass({
		pi,
		runtime,
		hitl,
		branch: [
			...branch,
			{
				type: "custom",
				id: "bind",
				customType: CTX_BIND,
				data: { project_id: meta.id, project_name: meta.name },
			},
		],
	});
	hitl.notify(`bound to ${meta.name}`, "info");
	return { ok: true, project_id: meta.id, project_name: meta.name };
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
