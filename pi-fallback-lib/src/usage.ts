import { splitModelKey } from "./kernel.js";
import type { ModelKey, UsageGate, UsageMetric } from "./types.js";

/** Percent matches the rounded figure `/usage` and `/grok-cli-usage` show. */
export function reportedUsage(metric: UsageMetric, value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  if (metric === "percent") {
    if (value < 0 || value > 100.5) return undefined;
    return Math.round(Math.min(100, value));
  }
  if (value < 0) return undefined;
  return value;
}

export const USAGE_RECOVER_POINTS = 20;

export function thresholdCrossed(gate: UsageGate, value: number): boolean {
  const reported = reportedUsage(gate.metric, value);
  if (reported === undefined) return false;
  return reported >= gate.threshold;
}

/** Percent returns only at least 20 points under the cap. Tokens have no point scale. */
export function usageRecovered(gate: UsageGate, value: number): boolean {
  const reported = reportedUsage(gate.metric, value);
  if (reported === undefined) return false;
  if (gate.metric === "percent") return reported <= gate.threshold - USAGE_RECOVER_POINTS;
  return reported < gate.threshold;
}

export function matchingGate(gates: readonly UsageGate[], model: ModelKey): UsageGate | undefined {
  const parsed = splitModelKey(model);
  if (!parsed) return undefined;
  return gates.find((gate) => {
    const modelMatch = gate.models === undefined || gate.models.includes(model);
    const providerMatch = gate.provider === undefined || gate.provider === parsed.provider;
    return modelMatch && providerMatch && (gate.models !== undefined || gate.provider !== undefined);
  });
}

/** Dot path into a JSON object. Arrays and missing fields are unread. */
export function readJsonNumber(payload: unknown, path: string): number | undefined {
  if (!path || path.startsWith(".") || path.endsWith(".") || path.includes("..")) return undefined;
  let current: unknown = payload;
  for (const part of path.split(".")) {
    if (!part || current === null || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : undefined;
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function httpsUrl(raw: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  if (url.username || url.password) return undefined;
  return url;
}

export function isEnvName(value: string): boolean {
  return ENV_NAME.test(value);
}
