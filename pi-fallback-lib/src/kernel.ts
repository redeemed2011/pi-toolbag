import { runKernel } from "./kernelBin.js";
import type { DecideInput, FallbackChain, FailoverDecision, FallbackConfig, ModelKey } from "./types.js";

export function splitModelKey(key: string): { provider: string; id: string } | undefined {
  const text = runKernel("split", { key });
  return text === "null" ? undefined : JSON.parse(text) as { provider: string; id: string };
}

export function modelKey(provider: string, id: string): ModelKey {
  return `${provider}/${id}`;
}

export function findChain(config: FallbackConfig, current: ModelKey): FallbackChain | undefined {
  const text = runKernel("chain", { config, current });
  return text === "null" ? undefined : JSON.parse(text) as FallbackChain;
}

export function decideFailover(input: DecideInput): FailoverDecision {
  const parsed = JSON.parse(runKernel("decide", {
    ...input,
    attempted: [...input.attempted],
    blocked: input.blocked ? [...input.blocked] : [],
  })) as FailoverDecision & { attempted?: string[] };
  if (parsed.action === "failover") return { ...parsed, attempted: new Set(parsed.attempted) };
  return parsed;
}
