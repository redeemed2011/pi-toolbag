import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { findChain, loadFallbackConfigFile, modelKey, splitModelKey } from "pi-fallback-lib";
import type { ConfiguredModel } from "../config.js";
import { workerRunDir } from "../store/paths.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const WORKER_EXTENSION_PATH = join(REPO_ROOT, "worker.ts");

export function modelArg(model: ConfiguredModel): string {
	return `${model.provider}/${model.id}`;
}
/** Numeric nvm dir order. `v9.0.0` is older than `v24.21.0`. */
export function compareNodeVersionDir(a: string, b: string): number {
	const parts = (name: string) =>
		name
			.replace(/^v/i, "")
			.split(".")
			.map((part) => {
				const n = Number(part);
				return Number.isInteger(n) ? n : Number.NEGATIVE_INFINITY;
			});
	const av = parts(a);
	const bv = parts(b);
	const len = Math.max(av.length, bv.length);
	for (let i = 0; i < len; i++) {
		const diff = (av[i] ?? 0) - (bv[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

/**
 * Prefer the already-running Pi CLI JS (so a sandboxed parent does not re-enter
 * the cplt wrapper). Then the newest nvm global `pi`, then `pi-unsafe`.
 * Never PATH `pi` unless that is the only option.
 */
export function resolvePiBinary(): { command: string; baseArgs: string[] } {
	if (process.env.SBX_PI_BIN && existsSync(process.env.SBX_PI_BIN)) {
		return { command: process.env.SBX_PI_BIN, baseArgs: [] };
	}
	const entry = process.argv[1];
	if (entry) {
		try {
			const realEntry = realpathSync(entry);
			if (/\.(?:mjs|cjs|js)$/i.test(realEntry)) {
				return { command: process.execPath, baseArgs: [realEntry] };
			}
		} catch {
			// fall through
		}
	}
	const nvmVersions = join(homedir(), ".nvm", "versions", "node");
	if (existsSync(nvmVersions)) {
		const versions = readdirSync(nvmVersions).sort(compareNodeVersionDir);
		for (let i = versions.length - 1; i >= 0; i--) {
			const cand = join(nvmVersions, versions[i], "bin", "pi");
			if (existsSync(cand)) {
				return { command: cand, baseArgs: [] };
			}
		}
	}
	return { command: "pi-unsafe", baseArgs: [] };
}

/**
 * Provider packages needed to setModel() unused chain members.
 * Worker uses --no-extensions, so grok-cli (from npm:pi-grok-cli) is otherwise
 * absent from modelRegistry — failover then logs not-in-registry.
 */
export function extraWorkerExtensionPaths(model: ConfiguredModel): string[] {
	const agentDir = getAgentDir();
	const out: string[] = [];
	const seen = new Set<string>();
	const addProvider = (provider: string) => {
		const dir = join(agentDir, "npm", "node_modules", `pi-${provider}`);
		if (!existsSync(join(dir, "package.json")) || seen.has(dir)) return;
		seen.add(dir);
		out.push(dir);
	};
	addProvider(model.provider);
	const loaded = loadFallbackConfigFile(join(agentDir, "auto-fallback.json"));
	if (loaded.ok && loaded.config.enabled) {
		const chain = findChain(loaded.config, modelKey(model.provider, model.id));
		if (chain) {
			for (const key of chain.models) {
				const parsed = splitModelKey(key);
				if (parsed) addProvider(parsed.provider);
			}
		}
	}
	return out;
}

export function buildWorkerArgv(opts: {
	model: ConfiguredModel;
	sessionName: string;
	kickoffPrompt: string;
	workerExtensionPath?: string;
	sessionDir: string;
}): string[] {
	const pi = resolvePiBinary();
	const args = [
		...pi.baseArgs,
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--no-context-files",
		"--no-builtin-tools",
		"--offline",
		"--model",
		modelArg(opts.model),
	];
	if (opts.model.thinking) args.push("--thinking", opts.model.thinking);
	args.push("--session-dir", opts.sessionDir);
	args.push("-e", opts.workerExtensionPath ?? WORKER_EXTENSION_PATH);
	const extras = extraWorkerExtensionPaths(opts.model);
	for (const extra of extras) {
		args.push("-e", extra);
	}
	if (extras.length > 0) {
		args.push("--exclude-tools", "image_gen");
	}
	args.push("-n", opts.sessionName);
	args.push("-p", opts.kickoffPrompt);
	return [pi.command, ...args];
}

export type WorkerExit = { code: number | null; signal: NodeJS.Signals | null; stderr: string };

export function spawnWorker(opts: {
	argv: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	signal?: AbortSignal;
}): Promise<WorkerExit> {
	const [command, ...rest] = opts.argv;
	mkdirSync(opts.cwd, { recursive: true });
	return new Promise((resolvePromise) => {
		const proc = spawn(command, rest, {
			cwd: opts.cwd,
			env: opts.env,
			stdio: ["ignore", "ignore", "pipe"],
		});
		let stderr = "";
		proc.stderr?.on("data", (d: Buffer) => {
			stderr += d.toString();
		});
		let exited = false;
		proc.on("error", () => {
			exited = true;
			resolvePromise({ code: 1, signal: null, stderr: stderr || "spawn error" });
		});
		proc.on("close", (code, signal) => {
			exited = true;
			resolvePromise({ code, signal, stderr });
		});
		if (opts.signal) {
			const kill = () => {
				try {
					proc.kill("SIGTERM");
				} catch {
					// already gone
				}
				// `proc.killed` is true as soon as SIGTERM is delivered, even if the process ignores it.
				const timer = setTimeout(() => {
					if (exited) return;
					try {
						proc.kill("SIGKILL");
					} catch {
						// already gone
					}
				}, 3000);
				const stop = () => clearTimeout(timer);
				proc.on("close", stop);
				proc.on("error", stop);
			};
			if (opts.signal.aborted) kill();
			else opts.signal.addEventListener("abort", kill, { once: true });
		}
	});
}

export function prepareWorkerCwd(sessionId: string, runId: string): { cwd: string; sessionDir: string } {
	const cwd = workerRunDir(sessionId, runId);
	const sessionDir = join(cwd, "session");
	mkdirSync(sessionDir, { recursive: true });
	return { cwd, sessionDir };
}
