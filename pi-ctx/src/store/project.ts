import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { foldLive, sortRecords } from "../fold.js";
import type { JudgmentRecord, LiveSet } from "../types.js";
import { isPlainRecord } from "../types.js";
import { appendJsonl, lineToJudgment, unionLogDir } from "./jsonl.js";
import { projectDir, projectLogsDir, projectMetaPath, projectsDir, resolveProjectId, writerLogPath } from "./paths.js";

export type ProjectMeta = { id: string; name: string; created_at: string; aliases?: string[] };

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
		const aliases = Array.isArray(raw.aliases) ? raw.aliases.filter((item): item is string => typeof item === "string") : [];
		return aliases.length ? { id: raw.id, name: raw.name, created_at, aliases } : { id: raw.id, name: raw.name, created_at };
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

export type RenameResult = { ok: true; meta: ProjectMeta } | { ok: false; error: string };

/**
 * Move a project to a new id and name. The old id becomes an alias, so every session
 * still bound to it reads and writes the renamed project. Records are not rewritten.
 */
export function renameProject(fromId: string, name: string, home?: string): RenameResult {
	const id = resolveProjectId(fromId, home);
	const meta = readProjectMeta(id, home);
	if (!meta) return { ok: false, error: `project ${fromId} is not on disk` };
	const to = slugify(name);
	const taken = resolveProjectId(to, home);
	if (to !== meta.id && taken !== meta.id && (readProjectMeta(taken, home) || existsSync(join(projectsDir(home), to)))) {
		return { ok: false, error: `project ${to} already exists` };
	}
	const aliases = [...new Set([...(meta.aliases ?? []), meta.id])].filter((item) => item !== to);
	const next: ProjectMeta = { id: to, name: name.trim(), created_at: meta.created_at, ...(aliases.length ? { aliases } : {}) };
	if (to !== meta.id) renameSync(projectDir(meta.id, home), join(projectsDir(home), to));
	writeFileSync(projectMetaPath(to, home), `${JSON.stringify(next)}\n`, "utf-8");
	return { ok: true, meta: next };
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
