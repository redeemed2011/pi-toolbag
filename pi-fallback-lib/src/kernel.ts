import { classifyError, isFailoverWorthy } from "./classify.js";
import type { DecideInput, FallbackChain, FailoverDecision, FallbackConfig, ModelKey } from "./types.js";

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
  const { config, current, error, remainingBudget } = input;
  if (!config.enabled) return { action: "none", reason: "disabled" };
  if (!splitModelKey(current)) return { action: "none", reason: "invalid-current" };
  if (remainingBudget <= 0) return { action: "none", reason: "budget-exhausted" };

  const classification = classifyError(error);
  if (!isFailoverWorthy(classification)) {
    return { action: "none", reason: "not-failover-worthy", classification };
  }

  const chain = findChain(config, current);
  if (!chain) return { action: "none", reason: "not-in-chain", classification };

  const attempted = new Set(input.attempted);
  attempted.add(current);
  for (const key of chain.models) {
    if (!attempted.has(key)) {
      return { action: "failover", next: key, reason: classification, attempted };
    }
  }
  return { action: "none", reason: "no-unused-member", classification };
}
