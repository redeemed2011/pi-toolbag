import { resolveOccupancy } from "../fold.js";
import { branchHasBind, findGrantByToken, PROJECT_ID_RE } from "../grant.js";
import { publishBoundStatus, type StatusSink } from "../render/bound-status.js";
import type { Runtime } from "../runtime.js";
import { loadProjectLive, readProjectMeta } from "../store/project.js";
import { applyClaim } from "./claim.js";
import { CTX_BIND, CTX_CLAIM, type Entry } from "../types.js";

type AttachPi = { appendEntry: (customType: string, data?: unknown) => void };

export function executeAttach(opts: {
	pi: AttachPi;
	runtime: Runtime;
	branch: Entry[];
	projectId?: string;
	token?: string;
	status?: StatusSink;
	home?: string;
}): { ok: true; project_id: string; project_name: string; grant_id: string; question_id: string; claimed_id: string } | { ok: false; error: string } {
	if (!opts.runtime.enabled) return { ok: false, error: "ctx is off" };
	if (branchHasBind(opts.branch)) return { ok: false, error: "not a fresh session" };
	if (!opts.projectId || !PROJECT_ID_RE.test(opts.projectId)) return { ok: false, error: "bad project id" };
	if (!opts.token) return { ok: false, error: "token required" };
	const meta = readProjectMeta(opts.projectId, opts.home);
	if (!meta || meta.id !== opts.projectId) return { ok: false, error: "not_found" };
	const grant = findGrantByToken(opts.projectId, opts.token, opts.home);
	if (!grant) return { ok: false, error: "grant not found" };
	const live = loadProjectLive(opts.projectId, opts.home);
	const result = applyClaim({
		action: "claim",
		question_id: grant.question_id,
		// The session is not bound until the writes below. The check still has to see a project.
		bound: true,
		enabled: opts.runtime.enabled,
		claimedId: null,
		live,
		occupancy: resolveOccupancy({ occupancy: opts.runtime.occupancy }, opts.runtime.config.occupancy),
		siblingKnob: opts.runtime.config.gatedEdgeSiblingHeadlines,
	});
	if (!result.ok || !result.claimed_id) return result.ok ? { ok: false, error: "not_found" } : result;
	opts.pi.appendEntry(CTX_BIND, {
		project_id: meta.id,
		grant_id: grant.id,
		question_id: grant.question_id,
	});
	opts.pi.appendEntry(CTX_CLAIM, { claimed_question_id: result.claimed_id });
	opts.runtime.bound = true;
	opts.runtime.projectId = meta.id;
	opts.runtime.claimedId = result.claimed_id;
	opts.runtime.reloadProject();
	publishBoundStatus(opts.status, { bound: true, projectId: meta.id, projectName: meta.name });
	return {
		ok: true,
		project_id: meta.id,
		project_name: meta.name,
		grant_id: grant.id,
		question_id: grant.question_id,
		claimed_id: result.claimed_id,
	};
}
