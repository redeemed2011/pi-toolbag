import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/** Override for tests and sandboxed runs. Never write the real home store from vitest. */
export function ctxHome(): string {
	const override = process.env.CTX_HOME || process.env.PI_CTX_HOME;
	if (override && override.trim()) return override.trim();
	return join(homedir(), ".pi", "ctx");
}

export function projectsDir(home = ctxHome()): string {
	return join(home, "projects");
}

export function projectDir(projectId: string, home = ctxHome()): string {
	return join(projectsDir(home), projectId);
}

export function projectMetaPath(projectId: string, home = ctxHome()): string {
	return join(projectDir(projectId, home), "project.json");
}

export function projectLogsDir(projectId: string, home = ctxHome()): string {
	return join(projectDir(projectId, home), "logs");
}

export function writerLogPath(projectId: string, sessionId: string, home = ctxHome()): string {
	return join(projectLogsDir(projectId, home), `${sessionId}.jsonl`);
}

export function projectBlobsDir(projectId: string, home = ctxHome()): string {
	return join(projectDir(projectId, home), "blobs");
}

export function blobPath(projectId: string, hash: string, home = ctxHome()): string {
	return join(projectBlobsDir(projectId, home), hash);
}

/** Worker cwd + session-dir: cplt scratch (`$TMPDIR`) so session inject needs no `~/.pi/ctx` grant. */
export function workerRunDir(sessionId: string, runId: string): string {
	const root = process.env.TMPDIR || tmpdir();
	return join(root, "pi-ctx-workers", sessionId, runId);
}
