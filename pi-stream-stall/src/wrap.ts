import type { GuardModel, GuardOptions } from "./watchdog.js";
import { guardStream } from "./watchdog.js";

export const WRAPPED = Symbol.for("pi-stream-stall.wrapped");

type StreamMethod = (model: GuardModel, context: unknown, options?: unknown) => unknown;

export interface WrapTarget {
  stream?: StreamMethod;
  streamSimple?: StreamMethod;
}

export interface ProviderRegistry {
  getAll(): readonly { provider: string }[];
  getRegisteredProviderIds(): readonly string[];
  getProvider(id: string): unknown;
}

function replaceMethod(target: WrapTarget, key: "stream" | "streamSimple", value: StreamMethod): void {
  try {
    target[key] = value;
    return;
  } catch {
    // fall through
  }
  Object.defineProperty(target, key, { value, writable: true, configurable: true });
}

export function wrapProvider(provider: WrapTarget, idleMs: number, options: GuardOptions = {}): void {
  if (!(idleMs > 0)) return;
  for (const key of ["stream", "streamSimple"] as const) {
    const original = provider[key];
    if (typeof original !== "function") continue;
    if (WRAPPED in original) continue;
    const wrapped: StreamMethod = function (this: unknown, model, context, streamOptions) {
      const inner = original.call(this, model, context, streamOptions) as Parameters<typeof guardStream>[0];
      return guardStream(inner, model, idleMs, options);
    };
    Object.defineProperty(wrapped, WRAPPED, { value: true });
    replaceMethod(provider, key, wrapped);
  }
}

export function wrapRegistry(registry: ProviderRegistry, idleMs: number, options: GuardOptions = {}): void {
  if (!(idleMs > 0)) return;
  const ids = new Set<string>();
  for (const model of registry.getAll()) ids.add(model.provider);
  for (const id of registry.getRegisteredProviderIds()) ids.add(id);
  for (const id of ids) {
    const provider = registry.getProvider(id);
    if (provider && typeof provider === "object") wrapProvider(provider as WrapTarget, idleMs, options);
  }
}
