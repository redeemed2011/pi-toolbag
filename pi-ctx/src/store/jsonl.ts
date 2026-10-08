import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import type { JudgmentRecord, ReasonClass } from "../types.js";
import { isJudgmentType, isPlainRecord, isNonEmptyString, isReasonClass } from "../types.js";
import { parseEvidenceMeta } from "../evidence.js";
import { parseAppliesTo } from "../fold.js";

export type JsonlLine = {
	id: string;
	type: string;
	ts: string;
	session: string;
	[key: string]: unknown;
};

export function byteHash(line: string): string {
	return createHash("sha256").update(line).digest("hex");
}

/** Skip-bad-line: malformed JSON or missing id/type/ts/session is dropped, not fatal. */
export function parseJsonl(text: string): JsonlLine[] {
	const out: JsonlLine[] = [];
	const seen = new Set<string>();
	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isPlainRecord(parsed)) continue;
		if (!isNonEmptyString(parsed.id) || !isNonEmptyString(parsed.type)) continue;
		if (!isNonEmptyString(parsed.ts) || !isNonEmptyString(parsed.session)) continue;
		const hash = byteHash(line);
		if (seen.has(hash) || seen.has(parsed.id)) continue;
		seen.add(hash);
		seen.add(parsed.id);
		out.push(parsed as JsonlLine);
	}
	return out;
}

export function readJsonlFile(path: string): JsonlLine[] {
	if (!existsSync(path)) return [];
	try {
		return parseJsonl(readFileSync(path, "utf-8"));
	} catch {
		return [];
	}
}

export function appendJsonl(path: string, record: object): void {
	mkdirSync(dirname(path), { recursive: true });
	appendFileSync(path, `${JSON.stringify(record)}\n`, "utf-8");
}

export function unionLogDir(dir: string): JsonlLine[] {
	if (!existsSync(dir)) return [];
	const files = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
	const lines: JsonlLine[] = [];
	for (const file of files) {
		lines.push(...readJsonlFile(join(dir, file)));
	}
	return lines;
}

export type AppliesToRefuse =
	| { ok: true; applies_to: NonNullable<JudgmentRecord["applies_to"]> }
	| { ok: false; error: "applies_to_missing" | "applies_to_empty" | "applies_to_dangling" };

/**
 * Mint refuse for `applies_to`. Missing never defaults to `all`.
 * `[]` refuses. Dangling ids (not in live questions) refuse.
 */
export function validateAppliesTo(
	value: unknown,
	liveQuestionIds: Iterable<string>,
): AppliesToRefuse {
	if (value === undefined || value === null) return { ok: false, error: "applies_to_missing" };
	const parsed = parseAppliesTo(value);
	if (!parsed) {
		if (Array.isArray(value) && value.length === 0) return { ok: false, error: "applies_to_empty" };
		return { ok: false, error: "applies_to_missing" };
	}
	if (parsed === "all") return { ok: true, applies_to: "all" };
	const live = new Set(liveQuestionIds);
	for (const id of parsed) {
		if (!live.has(id)) return { ok: false, error: "applies_to_dangling" };
	}
	return { ok: true, applies_to: parsed };
}

function parseIdList(value: unknown): string[] | undefined {
	if (typeof value === "string" && value.length > 0) return [value];
	if (Array.isArray(value)) {
		const ids = value.filter(isNonEmptyString);
		return ids.length ? ids : undefined;
	}
	return undefined;
}

export function lineToJudgment(line: JsonlLine): JudgmentRecord | undefined {
	const type = line.type;
	if (!isJudgmentType(type)) return undefined;
	const headline = typeof line.headline === "string" ? line.headline : "";
	const body = typeof line.body === "string" ? line.body : headline;
	if (!headline && !body) return undefined;
	const applies = type === "constraint" ? parseAppliesTo(line.applies_to) : undefined;
	if (type === "constraint" && applies === undefined) return undefined;
	const reason_class: ReasonClass | undefined = isReasonClass(line.reason_class)
		? line.reason_class
		: undefined;
	const evidence = type === "evidence" ? parseEvidenceMeta({
		blob_hash: line.blob_hash,
		byte_size: line.byte_size,
		producer: line.producer,
		expires_at: line.expires_at,
	}) : undefined;
	if (evidence && !evidence.ok) return undefined;
	return {
		id: line.id,
		type,
		ts: line.ts,
		session: line.session,
		headline: headline || body.slice(0, 80),
		body,
		directive: typeof line.directive === "string" ? line.directive : undefined,
		rationale: typeof line.rationale === "string" ? line.rationale : undefined,
		applies_to: applies,
		supersedes: parseIdList(line.supersedes),
		parent: typeof line.parent === "string" ? line.parent : undefined,
		blocks: parseIdList(line.blocks),
		conflicts_with: parseIdList(line.conflicts_with),
		reason_class,
		citation_target: typeof line.citation_target === "string" ? line.citation_target : undefined,
		blob_hash: evidence?.blob_hash,
		byte_size: evidence?.byte_size,
		producer: evidence?.producer,
		expires_at: evidence?.expires_at,
	};
}
