import { runKernel } from "./kernelBin.js";
import type { ModelKey, UsageGate, UsageMetric } from "./types.js";

function usage(payload: unknown): string {
  return runKernel("usage", payload);
}

function numberOrUndefined(payload: unknown): number | undefined {
  const text = usage(payload);
  return text === "null" ? undefined : Number(text);
}

/** Percent matches the rounded figure `/usage` and `/grok-cli-usage` show. */
export function reportedUsage(metric: UsageMetric, value: number): number | undefined {
  return numberOrUndefined({ op: "reported", metric, value: Number.isFinite(value) ? value : null });
}

export const USAGE_RECOVER_POINTS = 20;

export function thresholdCrossed(gate: UsageGate, value: number): boolean {
  return usage({ op: "threshold", gate, value: Number.isFinite(value) ? value : null }) === "true";
}

/** Percent returns only at least 20 points under the cap. Tokens have no point scale. */
export function usageRecovered(gate: UsageGate, value: number): boolean {
  return usage({ op: "recovered", gate, value: Number.isFinite(value) ? value : null }) === "true";
}

export function matchingGate(gates: readonly UsageGate[], model: ModelKey): UsageGate | undefined {
  const index = Number(usage({ op: "match", gates, model }));
  return index < 0 ? undefined : gates[index];
}

/** Dot path into a JSON object. Arrays and missing fields are unread. */
export function readJsonNumber(payload: unknown, path: string): number | undefined {
  return numberOrUndefined({ op: "json", payload, path });
}

export function httpsUrl(raw: string): URL | undefined {
  if (usage({ op: "https", url: raw }) !== "true") return undefined;
  return new URL(raw);
}

export function isEnvName(value: string): boolean {
  return usage({ op: "env", name: value }) === "true";
}
