import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DecideInput, FallbackChain, FailoverDecision, FallbackConfig, ModelKey } from "./types.js";

const kernelBin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fallback-kernel/kernel");

export function splitModelKey(key: string): { provider: string; id: string } | undefined {
  const slash = key.indexOf("/");
  if (slash <= 0 || slash === key.length - 1) return undefined;
  return { provider: key.slice(0, slash), id: key.slice(slash + 1) };
}

export function modelKey(provider: string, id: string): ModelKey {
  return `${provider}/${id}`;
}

export function findChain(config: FallbackConfig, current: ModelKey): FallbackChain | undefined {
  return config.chains.find((chain) => chain.models.includes(current));
}

export function decideFailover(input: DecideInput): FailoverDecision {
  const child = spawnSync(kernelBin, ["decide"], {
    input: JSON.stringify({
      ...input,
      attempted: [...input.attempted],
      blocked: input.blocked ? [...input.blocked] : [],
    }),
    encoding: "utf8",
  });
  if (child.status !== 0) throw new Error(child.stderr || "fallback-kernel failed");
  const parsed = JSON.parse(child.stdout) as FailoverDecision & { attempted?: string[] };
  if (parsed.action === "failover") return { ...parsed, attempted: new Set(parsed.attempted) };
  return parsed;
}
