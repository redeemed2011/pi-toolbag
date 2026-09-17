import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULTS, LAST_RESORT_OBSERVER, loadConfig, resolveObserverModel } from "../src/config.js";

const ENV_AGENT_DIR = "PI_CODING_AGENT_DIR";

function writeJson(path: string, value: unknown): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value)}\n`, "utf-8");
}

describe("loadConfig settings layering", () => {
	const prevAgent = process.env[ENV_AGENT_DIR];
	const prevPassive = process.env.PI_CTX_PASSIVE;
	const prevDebug = process.env.PI_CTX_DEBUG;
	let agentDir: string;
	let cwd: string;

	beforeEach(() => {
		agentDir = mkdtempSync(join(tmpdir(), "ctx-agent-"));
		cwd = mkdtempSync(join(tmpdir(), "ctx-cwd-"));
		process.env[ENV_AGENT_DIR] = agentDir;
		delete process.env.PI_CTX_PASSIVE;
		delete process.env.PI_CTX_DEBUG;
	});

	afterEach(() => {
		if (prevAgent === undefined) delete process.env[ENV_AGENT_DIR];
		else process.env[ENV_AGENT_DIR] = prevAgent;
		if (prevPassive === undefined) delete process.env.PI_CTX_PASSIVE;
		else process.env.PI_CTX_PASSIVE = prevPassive;
		if (prevDebug === undefined) delete process.env.PI_CTX_DEBUG;
		else process.env.PI_CTX_DEBUG = prevDebug;
	});

	it("uses hardcoded defaults when neither settings file exists", () => {
		expect(loadConfig(cwd)).toEqual(DEFAULTS);
	});

	it("reads ctx.models.observer from ~/.pi/agent/settings.json via PI_CODING_AGENT_DIR", () => {
		writeJson(join(agentDir, "settings.json"), {
			ctx: {
				models: { observer: { provider: "xai", id: "grok-4.6", thinking: "low" } },
			},
		});
		expect(loadConfig(cwd).models.observer).toEqual({
			provider: "xai",
			id: "grok-4.6",
			thinking: "low",
		});
	});

	it("project .pi/settings.json overrides global ctx", () => {
		writeJson(join(agentDir, "settings.json"), {
			ctx: {
				models: { observer: { provider: "xai", id: "grok-4.6", thinking: "low" } },
				chunkTokens: 9000,
			},
		});
		writeJson(join(cwd, ".pi", "settings.json"), {
			ctx: {
				models: { observer: { provider: "grok-cli", id: "grok-4.6", thinking: "low" } },
			},
		});
		const config = loadConfig(cwd);
		expect(config.models.observer).toEqual({
			provider: "grok-cli",
			id: "grok-4.6",
			thinking: "low",
		});
		expect(config.chunkTokens).toBe(9000);
	});

	it("ignores other namespaces and malformed files", () => {
		writeJson(join(agentDir, "settings.json"), {
			"observational-memory": {
				models: { observer: { provider: "xai", id: "grok-4.6" } },
			},
			ctx: "nope",
		});
		expect(loadConfig(cwd).models.observer).toEqual(DEFAULTS.models.observer);
		writeFileSync(join(agentDir, "settings.json"), "{", "utf-8");
		expect(loadConfig(cwd).models.observer).toEqual(DEFAULTS.models.observer);
	});

	it("PI_CTX_PASSIVE wins over settings", () => {
		writeJson(join(agentDir, "settings.json"), { ctx: { passive: false } });
		expect(loadConfig(cwd, { ...process.env, PI_CTX_PASSIVE: "1" }).passive).toBe(true);
	});

	it("overlays occupancy and debug from global ctx", () => {
		writeJson(join(agentDir, "settings.json"), {
			ctx: { occupancy: "claim-strip", debugLog: true, gatedEdgeSiblingHeadlines: 2 },
		});
		const config = loadConfig(cwd);
		expect(config.occupancy).toBe("claim-strip");
		expect(config.debugLog).toBe(true);
		expect(config.gatedEdgeSiblingHeadlines).toBe(2);
		expect(config.models.observer).toEqual(DEFAULTS.models.observer);
	});

	it("blank observer fields keep the last-resort model", () => {
		writeJson(join(agentDir, "settings.json"), {
			ctx: { models: { observer: { provider: "  ", id: "" } } },
		});
		expect(loadConfig(cwd).models.observer).toEqual(LAST_RESORT_OBSERVER);
	});

	it("reads Pi defaultProvider/defaultModel as sessionDefault when ctx.models.observer is unset", () => {
		writeJson(join(agentDir, "settings.json"), {
			defaultProvider: "grok-cli",
			defaultModel: "grok-4.6",
			defaultThinkingLevel: "high",
		});
		const config = loadConfig(cwd);
		expect(config.models.observer).toBeUndefined();
		expect(config.sessionDefault).toEqual({
			provider: "grok-cli",
			id: "grok-4.6",
			thinking: "high",
		});
		expect(resolveObserverModel(config)).toEqual({
			provider: "grok-cli",
			id: "grok-4.6",
			thinking: "high",
		});
	});

	it("live session model wins over Pi settings default; explicit ctx.models.observer wins both", () => {
		const sessionDefault = { provider: "grok-cli", id: "grok-4.6", thinking: "high" as const };
		const live = {
			getModel: () => ({ provider: "xai", id: "grok-4.6" }),
			getThinkingLevel: () => "low",
		};
		expect(resolveObserverModel({ ...DEFAULTS, sessionDefault }, live)).toEqual({
			provider: "xai",
			id: "grok-4.6",
			thinking: "low",
		});
		expect(
			resolveObserverModel(
				{
					...DEFAULTS,
					sessionDefault,
					models: { observer: { provider: "openrouter", id: "z-ai/glm-5.3", thinking: "low" } },
				},
				live,
			),
		).toEqual({ provider: "openrouter", id: "z-ai/glm-5.3", thinking: "low" });
	});
});
