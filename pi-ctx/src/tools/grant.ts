import { randomUUID } from "node:crypto";
import { GRANT_TYPE, hashGrantToken, newGrantToken } from "../grant.js";
import { appendProjectRecord } from "../store/project.js";
import type { LiveSet } from "../types.js";

export function executeGrant(opts: {
	enabled: boolean;
	bound: boolean;
	grantId: string | null;
	projectId: string | null;
	sessionId: string;
	questionId?: string;
	live: LiveSet;
	home?: string;
}): { ok: true; project_id: string; token: string; grant_id: string } | { ok: false; error: string } {
	if (!opts.enabled) return { ok: false, error: "ctx is off" };
	if (!opts.bound || !opts.projectId) return { ok: false, error: "no project bound" };
	if (opts.grantId) return { ok: false, error: "worker cannot grant" };
	if (!opts.questionId) return { ok: false, error: "question_id required" };
	const question = opts.live.byId.get(opts.questionId);
	if (!question || question.type !== "question" || !opts.live.live.has(question.id)) {
		return { ok: false, error: "not_found" };
	}
	const token = newGrantToken();
	const grantId = randomUUID();
	appendProjectRecord(opts.projectId, opts.sessionId, {
		id: grantId,
		type: GRANT_TYPE,
		ts: new Date().toISOString(),
		session: opts.sessionId,
		question_id: question.id,
		token_hash: hashGrantToken(token),
	}, opts.home);
	return { ok: true, project_id: opts.projectId, token, grant_id: grantId };
}
