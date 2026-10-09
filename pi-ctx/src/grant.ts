import { randomBytes } from "node:crypto";
import { byteHash, unionLogDir, type JsonlLine } from "./store/jsonl.js";
import { projectLogsDir } from "./store/paths.js";
import { CTX_BIND, isPlainRecord, type Entry } from "./types.js";

export const GRANT_TYPE = "ctx.grant";

/** A project id is also a directory name. This is the only shape attach accepts. */
export const PROJECT_ID_RE = /^[a-z0-9-]{1,64}$/;

export type GrantLine = {
	id: string;
	type: typeof GRANT_TYPE;
	ts: string;
	session: string;
	question_id: string;
	token_hash: string;
};

/** Shared by ctx_grant and ctx_attach. The log stores this, never the token. */
export function hashGrantToken(token: string): string {
	return byteHash(token);
}

export function newGrantToken(): string {
	return randomBytes(32).toString("hex");
}

export function branchHasBind(entries: Entry[]): boolean {
	return entries.some((entry) => entry.type === "custom" && entry.customType === CTX_BIND);
}

function asGrant(line: JsonlLine): GrantLine | undefined {
	if (line.type !== GRANT_TYPE) return undefined;
	if (typeof line.question_id !== "string" || line.question_id.length === 0) return undefined;
	if (typeof line.token_hash !== "string" || line.token_hash.length === 0) return undefined;
	return {
		id: line.id,
		type: GRANT_TYPE,
		ts: line.ts,
		session: line.session,
		question_id: line.question_id,
		token_hash: line.token_hash,
	};
}

/** Read the project logs directly. The law loader never returns this line. */
export function findGrantByToken(projectId: string, token: string, home?: string): GrantLine | undefined {
	const hash = hashGrantToken(token);
	for (const line of unionLogDir(projectLogsDir(projectId, home))) {
		const grant = asGrant(line);
		if (grant && grant.token_hash === hash) return grant;
	}
	return undefined;
}

/** The finding tool's handler check. The schema is not the check. */
export function findingRawError(args: unknown): string | undefined {
	if (!isPlainRecord(args)) return "headline and body required";
	for (const key of Object.keys(args)) {
		if (key !== "headline" && key !== "body") return "extra field";
	}
	if (typeof args.headline !== "string" || typeof args.body !== "string") return "headline and body required";
	return undefined;
}
