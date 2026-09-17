import { splitModelKey } from "./kernel.js";
import type { FallbackChain, FallbackConfig, ParseFailReason, ParseResult } from "./types.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseModelKey(raw: unknown): { ok: true; key: string } | { ok: false; reason: "invalid-model-key" } {
  if (typeof raw !== "string" || !splitModelKey(raw)) {
    return { ok: false, reason: "invalid-model-key" };
  }
  return { ok: true, key: raw };
}

function parseBudget(raw: unknown): { ok: true; value: number } | { ok: false } {
  if (raw === undefined) return { ok: true, value: 1 };
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 20) {
    return { ok: false };
  }
  return { ok: true, value: raw };
}

function parseChains(
  raw: unknown,
  requireNonEmpty: boolean,
): { ok: true; chains: FallbackChain[] } | { ok: false; reason: ParseFailReason } {
  if (raw === undefined || raw === null) {
    if (requireNonEmpty) return { ok: false, reason: "no-chains" };
    return { ok: true, chains: [] };
  }
  if (!Array.isArray(raw)) return { ok: false, reason: "no-chains" };
  if (requireNonEmpty && raw.length === 0) return { ok: false, reason: "no-chains" };

  const chains: FallbackChain[] = [];
  const names = new Set<string>();
  const keys = new Set<string>();

  for (const [index, item] of raw.entries()) {
    if (!isPlainObject(item)) return { ok: false, reason: "invalid-chain" };
    if (!Array.isArray(item.models) || item.models.length < 2) {
      return { ok: false, reason: "invalid-chain" };
    }
    const models: string[] = [];
    for (const model of item.models) {
      const parsed = parseModelKey(model);
      if (!parsed.ok) return parsed;
      if (keys.has(parsed.key)) return { ok: false, reason: "duplicate-key" };
      keys.add(parsed.key);
      models.push(parsed.key);
    }
    const name =
      item.name === undefined || item.name === null
        ? `chain-${index}`
        : typeof item.name === "string" && item.name.length > 0
          ? item.name
          : null;
    if (name === null) return { ok: false, reason: "invalid-chain" };
    if (names.has(name)) return { ok: false, reason: "invalid-chain" };
    names.add(name);
    chains.push({ name, models });
  }

  return { ok: true, chains };
}

/** Parse a JSON value. Extra live keys are ignored. Fail-closed on invalid shape. */
export function parseFallbackConfig(value: unknown): ParseResult {
  if (!isPlainObject(value)) return { ok: false, reason: "not-object" };

  if ("enabled" in value && typeof value.enabled !== "boolean") {
    return { ok: false, reason: "not-object" };
  }
  const enabled = value.enabled !== false;

  const budget = parseBudget(value.maxFailoversPerRequest);
  if (!budget.ok) return { ok: false, reason: "invalid-budget" };

  const chains = parseChains(value.chains, enabled);
  if (!chains.ok) return chains;

  const config: FallbackConfig = {
    enabled,
    chains: chains.chains,
    maxFailoversPerRequest: budget.value,
  };
  return { ok: true, config };
}
