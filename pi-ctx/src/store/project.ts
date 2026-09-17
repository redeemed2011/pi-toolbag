import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { foldLive, sortRecords } from "../fold.js";
import type { JudgmentRecord, LiveSet } from "../types.js";
import { isPlainRecord } from "../types.js";
import { appendJsonl, lineToJudgment, unionLogDir } from "./jsonl.js";
import { projectDir, projectLogsDir, projectMetaPath, projectsDir, writerLogPath } from "./paths.js";

export type ProjectMeta = { id: string; name: string; created_at: string };

export function slugify(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
	return slug || "project";
}

export function ensureProject(projectId: string, home?: string): string {
	const dir = projectDir(projectId, home);
	mkdirSync(projectLogsDir(projectId, home), { recursive: true });
	return dir;
}

export function readProjectMeta(projectId: string, home?: string): ProjectMeta | undefined {
	const path = projectMetaPath(projectId, home);
	if (!existsSync(path)) return undefined;
	try {
		const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
		if (!isPlainRecord(raw)) return undefined;
		if (typeof raw.id !== "string" || typeof raw.name !== "string") return undefined;
		const created_at = typeof raw.created_at === "string" ? raw.created_at : "";
		return { id: raw.id, name: raw.name, created_at };
	} catch {
		return undefined;
	}
}

export function listProjects(home?: string): ProjectMeta[] {
	const dir = projectsDir(home);
	if (!existsSync(dir)) return [];
	const out: ProjectMeta[] = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		try {
			if (!statSync(full).isDirectory()) continue;
		} catch {
			continue;
		}
		const meta = readProjectMeta(name, home);
		if (meta) out.push(meta);
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Write `{ id, name, created_at }` only. Never occupancy. Existing file is left as-is. */
export function createProject(name: string, id: string, home?: string): ProjectMeta {
	ensureProject(id, home);
	const path = projectMetaPath(id, home);
	const existing = readProjectMeta(id, home);
	if (existing) return existing;
	const meta: ProjectMeta = { id, name, created_at: new Date().toISOString() };
	writeFileSync(path, `${JSON.stringify(meta)}\n`, "utf-8");
	return meta;
}

export function loadProjectRecords(projectId: string, home?: string): JudgmentRecord[] {
	const lines = unionLogDir(projectLogsDir(projectId, home));
	const records: JudgmentRecord[] = [];
	for (const line of sortRecords(lines)) {
		const rec = lineToJudgment(line);
		if (rec) records.push(rec);
	}
	return records;
}

export function loadProjectLive(projectId: string, home?: string): LiveSet {
	return foldLive(loadProjectRecords(projectId, home));
}

export function appendProjectRecord(
	projectId: string,
	sessionId: string,
	record: object,
	home?: string,
): void {
	ensureProject(projectId, home);
	appendJsonl(writerLogPath(projectId, sessionId, home), record);
}
