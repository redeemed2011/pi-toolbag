import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildWorkerArgv, extraWorkerExtensionPaths, modelArg, WORKER_EXTENSION_PATH } from "../src/spawn/observer.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("observer argv", () => {
	const model = { provider: "openrouter" as const, id: "z-ai/glm-5.3", thinking: "low" as const };

	it("uses the OM contract plus sandbox --session-dir", () => {
		const argv = buildWorkerArgv({
			model,
			sessionName: "ctx-observer-x",
			kickoffPrompt: "go",
			sessionDir: "/tmp/pi-ctx-workers/s/r/session",
		});
		expect(argv).toContain("--no-extensions");
		expect(argv).toContain("--no-builtin-tools");
		expect(argv).toContain("--no-skills");
		expect(argv).toContain("--no-prompt-templates");
		expect(argv).toContain("--no-context-files");
		expect(argv[argv.indexOf("--model") + 1]).toBe("openrouter/z-ai/glm-5.3");
		expect(argv[argv.indexOf("--thinking") + 1]).toBe("low");
		expect(argv[argv.indexOf("-e") + 1]).toBe(WORKER_EXTENSION_PATH);
		expect(argv[argv.indexOf("-n") + 1]).toBe("ctx-observer-x");
		expect(argv[argv.indexOf("--session-dir") + 1]).toBe("/tmp/pi-ctx-workers/s/r/session");
		expect(argv).not.toContain("index.ts");
	});

	it("omits --thinking when unset", () => {
		const argv = buildWorkerArgv({
			model: { provider: "x", id: "y" },
			sessionName: "n",
			kickoffPrompt: "p",
			sessionDir: "/tmp/s",
		});
		expect(argv).not.toContain("--thinking");
	});

	it("formats provider/id", () => {
		expect(modelArg(model)).toBe("openrouter/z-ai/glm-5.3");
	});

	it("worker.ts does not register orchestrator hooks", () => {
		const src = readFileSync(join(root, "worker.ts"), "utf-8");
		expect(src).not.toMatch(/session_before_compact/);
		expect(src).not.toMatch(/registerCompaction/);
		expect(src).not.toMatch(/registerObserverTrigger/);
		expect(src).toMatch(/record_observations/);
		expect(src).toMatch(/attachFallback/);
		expect(src).toMatch(/retryAfterTools:\s*true/);
	});

	it("worker cannot construct judgment types", () => {
		const src = readFileSync(join(root, "worker.ts"), "utf-8");
		expect(src).not.toMatch(/name:\s*"(record|bind|claim|get|zoom|frontier)"/);
		expect(src).not.toMatch(/putJudgment|executeRecord|appendProjectRecord/);
		expect(src).not.toMatch(/submit_harvest/);
		const names = [...src.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);
		expect(new Set(names)).toEqual(new Set(["record_observations"]));
	});

	it("loads the starting provider package even without a fallback chain", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "ctx-provider-agent-"));
		const grokCli = join(agentDir, "npm", "node_modules", "pi-grok-cli");
		mkdirSync(grokCli, { recursive: true });
		writeFileSync(join(grokCli, "package.json"), JSON.stringify({ name: "pi-grok-cli" }));
		const prev = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		try {
			expect(extraWorkerExtensionPaths({ provider: "grok-cli", id: "grok-4.6" })).toEqual([grokCli]);
		} finally {
			if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = prev;
		}
	});

	it("does not load provider packages when the observer model is not in a chain", () => {
		const argv = buildWorkerArgv({
			model,
			sessionName: "n",
			kickoffPrompt: "p",
			sessionDir: "/tmp/s",
		});
		const extensionFlags = argv.filter((arg, i) => argv[i - 1] === "-e");
		expect(extensionFlags).toEqual([WORKER_EXTENSION_PATH]);
		expect(argv).not.toContain("--exclude-tools");
	});

	it("loads pi-grok-cli so the worker can setModel unused chain members", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "ctx-fallback-agent-"));
		writeFileSync(
			join(agentDir, "auto-fallback.json"),
			JSON.stringify({
				enabled: true,
				chains: [{ name: "grok", models: ["grok-cli/grok-4.6", "xai/grok-4.6"] }],
				maxFailoversPerRequest: 1,
			}),
		);
		const grokCli = join(agentDir, "npm", "node_modules", "pi-grok-cli");
		mkdirSync(grokCli, { recursive: true });
		writeFileSync(join(grokCli, "package.json"), JSON.stringify({ name: "pi-grok-cli" }));
		const prev = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		try {
			const observer = { provider: "xai" as const, id: "grok-4.6", thinking: "low" as const };
			expect(extraWorkerExtensionPaths(observer)).toEqual([grokCli]);
			const argv = buildWorkerArgv({
				model: observer,
				sessionName: "n",
				kickoffPrompt: "p",
				sessionDir: "/tmp/s",
			});
			expect(argv).toContain("--no-extensions");
			expect(argv.filter((arg, i) => argv[i - 1] === "-e")).toEqual([WORKER_EXTENSION_PATH, grokCli]);
			expect(argv[argv.indexOf("--exclude-tools") + 1]).toBe("image_gen");
		} finally {
			if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = prev;
		}
	});
});
