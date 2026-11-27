import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir, hostname, tmpdir } from "node:os";
import { join } from "node:path";

export type StorePathConfig = {
	defaultHome?: () => string;
	writerFile?: (sessionId: string) => string;
};

const defaultHomeFallback = () => join(homedir(), ".pi", "ctx");
const defaultWriterFile = (sessionId: string) => `${sessionId}.jsonl`;

let activeDefaultHome: () => string = defaultHomeFallback;
let activeWriterFile: (sessionId: string) => string = defaultWriterFile;

export function configureStore(config: StorePathConfig): void {
	if (config.defaultHome) activeDefaultHome = config.defaultHome;
	if (config.writerFile) activeWriterFile = config.writerFile;
}

export function resetStoreConfig(): void {
	activeDefaultHome = defaultHomeFallback;
	activeWriterFile = defaultWriterFile;
}

export function writerDevice(): string {
	return hostname().replace(/[^A-Za-z0-9._-]/g, "_") || "device";
}

/** Override for tests and sandboxed runs. Never write the real home store from vitest. */
export function ctxHome(): string {
	const override = process.env.CTX_HOME || process.env.PI_CTX_HOME;
	if (override && override.trim()) return override.trim();
	return activeDefaultHome();
}

export function projectsDir(home = ctxHome()): string {
	return join(home, "projects");
}

/**
 * A renamed project lists its old ids in project.json "aliases". A session bound
 * to an old id still reads and writes the renamed project.
 */
export function resolveProjectId(projectId: string, home = ctxHome()): string {
	const root = projectsDir(home);
	if (existsSync(join(root, projectId, "project.json"))) return projectId;
	if (!existsSync(root)) return projectId;
	for (const name of readdirSync(root)) {
		try {
			const raw = JSON.parse(readFileSync(join(root, name, "project.json"), "utf-8")) as { id?: unknown; aliases?: unknown };
			if (typeof raw.id === "string" && Array.isArray(raw.aliases) && raw.aliases.includes(projectId)) return raw.id;
		} catch {
			continue;
		}
	}
	return projectId;
}

export function projectDir(projectId: string, home = ctxHome()): string {
	return join(projectsDir(home), resolveProjectId(projectId, home));
}

export function projectMetaPath(projectId: string, home = ctxHome()): string {
	return join(projectDir(projectId, home), "project.json");
}

export function projectLogsDir(projectId: string, home = ctxHome()): string {
	return join(projectDir(projectId, home), "logs");
}

export function writerLogPath(projectId: string, sessionId: string, home = ctxHome()): string {
	return join(projectLogsDir(projectId, home), activeWriterFile(sessionId));
}

export function projectBlobsDir(projectId: string, home = ctxHome()): string {
	return join(projectDir(projectId, home), "blobs");
}

export function blobPath(projectId: string, hash: string, home = ctxHome()): string {
	return join(projectBlobsDir(projectId, home), hash);
}

/** Worker cwd + session-dir: cplt scratch ($TMPDIR) so session inject needs no ~/.pi/ctx grant. */
export function workerRunDir(sessionId: string, runId: string): string {
	const root = process.env.TMPDIR || tmpdir();
	return join(root, "pi-ctx-workers", sessionId, runId);
}
