import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isMessageId, validateIncoming, type BridgeMessage } from "./message.js";

export interface Paths {
	inbox: string;
	state: string;
}

export function bridgePaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): Paths {
	return {
		inbox: env.DEV_AGENT_BRIDGE_INBOX || join(home, "ResilioSync", "BnBShare", "grokbot", "engineering-lead", "dev-agent-bridge", "inbox"),
		state: env.DEV_AGENT_BRIDGE_STATE || join(home, ".cache", "dev-agent-bridge"),
	};
}

export interface Listener {
	pid: number;
	sessionId: string;
	cwd: string;
	since: string;
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function listenerFile(paths: Paths): string {
	return join(paths.state, "listener.json");
}

export function readListener(paths: Paths): Listener | undefined {
	try {
		const parsed = JSON.parse(readFileSync(listenerFile(paths), "utf8")) as Listener;
		return typeof parsed.pid === "number" && typeof parsed.sessionId === "string" ? parsed : undefined;
	} catch {
		return undefined;
	}
}

export function liveListener(paths: Paths): Listener | undefined {
	const listener = readListener(paths);
	return listener && alive(listener.pid) ? listener : undefined;
}

export function writeListener(paths: Paths, listener: Listener | undefined): void {
	mkdirSync(paths.state, { recursive: true });
	const tmp = `${listenerFile(paths)}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(listener ?? {}), { mode: 0o600 });
	renameSync(tmp, listenerFile(paths));
}

function deliveredFile(paths: Paths): string {
	return join(paths.state, "delivered.json");
}

export function deliveredIds(paths: Paths): Set<string> {
	try {
		const parsed = JSON.parse(readFileSync(deliveredFile(paths), "utf8")) as unknown;
		return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
	} catch {
		return new Set();
	}
}

export function markDelivered(paths: Paths, id: string): void {
	const ids = [...deliveredIds(paths), id].slice(-2000);
	mkdirSync(paths.state, { recursive: true });
	const tmp = `${deliveredFile(paths)}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(ids));
	renameSync(tmp, deliveredFile(paths));
}

export type Scanned =
	| { kind: "message"; file: string; message: BridgeMessage }
	| { kind: "duplicate"; file: string; id: string }
	| { kind: "rejected"; file: string; reason: string };

const UNREADABLE_GRACE_MS = 60_000;

export function scanInbox(paths: Paths, now = Date.now()): Scanned[] {
	let names: string[];
	try {
		names = readdirSync(paths.inbox);
	} catch {
		return [];
	}
	const delivered = deliveredIds(paths);
	const found: { scanned: Scanned; at: number }[] = [];
	for (const name of names) {
		if (!name.endsWith(".json")) continue;
		const id = name.slice(0, -".json".length);
		if (!isMessageId(id)) continue;
		const file = join(paths.inbox, name);
		let at = now;
		try {
			at = statSync(file).mtimeMs;
		} catch {
			continue;
		}
		if (delivered.has(id)) {
			found.push({ scanned: { kind: "duplicate", file, id }, at });
			continue;
		}
		let raw: unknown;
		try {
			raw = JSON.parse(readFileSync(file, "utf8"));
		} catch {
			if (now - at > UNREADABLE_GRACE_MS) found.push({ scanned: { kind: "rejected", file, reason: "the file is not valid JSON" }, at });
			continue;
		}
		const { message, errors } = validateIncoming(raw);
		if (!message) found.push({ scanned: { kind: "rejected", file, reason: errors.join("; ") }, at });
		else if (message.id !== id) found.push({ scanned: { kind: "rejected", file, reason: `the file name does not match its id ${message.id}` }, at });
		else found.push({ scanned: { kind: "message", file, message }, at });
	}
	return found.sort((a, b) => a.at - b.at).map((item) => item.scanned);
}

export function moveOut(paths: Paths, file: string, folder: "delivered" | "rejected"): void {
	const dir = join(paths.inbox, folder);
	mkdirSync(dir, { recursive: true });
	try {
		renameSync(file, join(dir, file.slice(file.lastIndexOf("/") + 1)));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}
