import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { Occupancy } from "./types.js";
import { isOccupancy } from "./types.js";

export type ConfiguredModel = {
	provider: string;
	id: string;
	thinking?: ModelThinkingLevel;
};

export type Config = {
	chunkTokens: number;
	chunkOverlapTokens: number;
	observerConcurrency: number;
	compactAtContextTokens: number;
	tailTokens: number;
	injectTokens: number;
	resumeAfterMidRunCompaction: boolean;
	passive: boolean;
	debugLog: boolean;
	gatedEdgeSiblingHeadlines: 0 | 2;
	occupancy: Occupancy;
	models: {
		/** Set only when `ctx.models.observer` is in settings. Unset = inherit the live session. */
		observer?: ConfiguredModel;
		/** Nested bind-consent promoter. Unset = same fallbacks as observer. Thinking forced xhigh/high. */
		promoter?: ConfiguredModel;
	};
	/** Pi `defaultProvider` / `defaultModel` / `defaultThinkingLevel` from settings.json. */
	sessionDefault?: ConfiguredModel;
};

/** Used only when inherit has no live model and settings have no Pi default. */
export const LAST_RESORT_OBSERVER: ConfiguredModel = {
	provider: "openrouter",
	id: "z-ai/glm-5.3",
	thinking: "low",
};

export const DEFAULTS: Config = {
	chunkTokens: 5_000,
	chunkOverlapTokens: 0,
	observerConcurrency: 4,
	compactAtContextTokens: 150_000,
	tailTokens: 20_000,
	injectTokens: 8_000,
	resumeAfterMidRunCompaction: true,
	passive: false,
	debugLog: false,
	gatedEdgeSiblingHeadlines: 0,
	occupancy: "gated-edge",
	models: {},
};

const THINKING_LEVELS: readonly ModelThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
] as const;

const SETTINGS_KEY = "ctx";

function positiveInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function isThinkingLevel(value: unknown): value is ModelThinkingLevel {
	return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseModel(raw: unknown, fallback: ConfiguredModel): ConfiguredModel {
	if (!isRecord(raw)) return fallback;
	const provider = nonEmptyString(raw.provider) ?? fallback.provider;
	const id = nonEmptyString(raw.id) ?? fallback.id;
	const thinking = isThinkingLevel(raw.thinking) ? raw.thinking : fallback.thinking;
	return { provider, id, thinking };
}

function overlay(ns: Record<string, unknown>, base: Config): Partial<Config> {
	const next: Partial<Config> = {};
	const chunkTokens = positiveInteger(ns.chunkTokens);
	if (chunkTokens !== undefined) next.chunkTokens = chunkTokens;
	if (ns.chunkOverlapTokens === 0) next.chunkOverlapTokens = 0;
	const chunkOverlap = positiveInteger(ns.chunkOverlapTokens);
	if (chunkOverlap !== undefined) next.chunkOverlapTokens = chunkOverlap;
	const observerConcurrency = positiveInteger(ns.observerConcurrency);
	if (observerConcurrency !== undefined) next.observerConcurrency = observerConcurrency;
	const compactAt = positiveInteger(ns.compactAtContextTokens);
	if (compactAt !== undefined) next.compactAtContextTokens = compactAt;
	const tailTokens = positiveInteger(ns.tailTokens);
	if (tailTokens !== undefined) next.tailTokens = tailTokens;
	const injectTokens = positiveInteger(ns.injectTokens);
	if (injectTokens !== undefined) next.injectTokens = injectTokens;
	if (ns.gatedEdgeSiblingHeadlines === 0 || ns.gatedEdgeSiblingHeadlines === 2) {
		next.gatedEdgeSiblingHeadlines = ns.gatedEdgeSiblingHeadlines;
	}
	if (isOccupancy(ns.occupancy)) next.occupancy = ns.occupancy;
	if (typeof ns.passive === "boolean") next.passive = ns.passive;
	if (typeof ns.debugLog === "boolean") next.debugLog = ns.debugLog;
	if (typeof ns.resumeAfterMidRunCompaction === "boolean") {
		next.resumeAfterMidRunCompaction = ns.resumeAfterMidRunCompaction;
	}
	if (isRecord(ns.models)) {
		next.models = { ...base.models };
		if ("observer" in ns.models) {
			next.models.observer = parseModel(ns.models.observer, base.models.observer ?? LAST_RESORT_OBSERVER);
		}
		if ("promoter" in ns.models) {
			next.models.promoter = parseModel(ns.models.promoter, base.models.promoter ?? LAST_RESORT_OBSERVER);
		}
	}
	return next;
}

function parsePiDefaultModel(json: Record<string, unknown>): ConfiguredModel | undefined {
	const provider = nonEmptyString(json.defaultProvider);
	const id = nonEmptyString(json.defaultModel);
	if (!provider || !id) return undefined;
	const thinking = isThinkingLevel(json.defaultThinkingLevel) ? json.defaultThinkingLevel : undefined;
	return { provider, id, thinking };
}

function readSettingsFile(
	path: string,
	base: Config,
): { overlay: Partial<Config>; sessionDefault?: ConfiguredModel } {
	if (!existsSync(path)) return { overlay: {} };
	try {
		const json: unknown = JSON.parse(readFileSync(path, "utf-8"));
		if (!isRecord(json)) return { overlay: {} };
		const ns = json[SETTINGS_KEY];
		const overlayNs = isRecord(ns) ? overlay(ns, base) : {};
		return { overlay: overlayNs, sessionDefault: parsePiDefaultModel(json) };
	} catch {
		return { overlay: {} };
	}
}

function applyEnv(config: Config, env: NodeJS.ProcessEnv): Config {
	if (env.PI_CTX_PASSIVE === "1") config.passive = true;
	if (env.PI_CTX_DEBUG === "1") config.debugLog = true;
	return config;
}

export type SessionModelSource = {
	getModel?: () => { provider?: string; id?: string } | undefined;
	getThinkingLevel?: () => string;
};

/** Explicit `ctx.models.observer` → live session model → Pi settings default → last resort. */
export function resolveObserverModel(config: Config, session?: SessionModelSource): ConfiguredModel {
	if (config.models.observer) return config.models.observer;
	const live = session?.getModel?.();
	const provider = nonEmptyString(live?.provider);
	const id = nonEmptyString(live?.id);
	if (provider && id) {
		const thinkingRaw = session?.getThinkingLevel?.();
		const thinking = isThinkingLevel(thinkingRaw) ? thinkingRaw : undefined;
		return { provider, id, thinking };
	}
	if (config.sessionDefault) return config.sessionDefault;
	return LAST_RESORT_OBSERVER;
}

function forcePromoterThinking(model: ConfiguredModel): ConfiguredModel {
	const t = model.thinking;
	const thinking = t === "xhigh" || t === "high" ? t : "xhigh";
	return { ...model, thinking };
}

/** Like observer fallbacks; thinking forced to xhigh (or high if settings say high). */
export function resolvePromoterModel(config: Config, session?: SessionModelSource): ConfiguredModel {
	if (config.models.promoter) return forcePromoterThinking(config.models.promoter);
	return forcePromoterThinking(resolveObserverModel(config, session));
}

/** Defaults → `~/.pi/agent/settings.json` `ctx` → `<cwd>/.pi/settings.json` `ctx` → env. */
export function loadConfig(cwd: string, env: NodeJS.ProcessEnv = process.env): Config {
	const globalPath = join(getAgentDir(), "settings.json");
	const projectPath = join(cwd, ".pi", "settings.json");
	const globalRead = readSettingsFile(globalPath, DEFAULTS);
	const afterGlobal: Config = {
		...DEFAULTS,
		...globalRead.overlay,
		models: { ...(globalRead.overlay.models ?? DEFAULTS.models) },
		sessionDefault: globalRead.sessionDefault,
	};
	const projectRead = readSettingsFile(projectPath, afterGlobal);
	const merged: Config = {
		...afterGlobal,
		...projectRead.overlay,
		models: {
			observer: projectRead.overlay.models?.observer ?? afterGlobal.models.observer,
			promoter: projectRead.overlay.models?.promoter ?? afterGlobal.models.promoter,
		},
		sessionDefault: projectRead.sessionDefault ?? afterGlobal.sessionDefault,
	};
	return applyEnv(merged, env);
}
