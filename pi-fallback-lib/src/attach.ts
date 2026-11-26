import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyError, isFailoverWorthy } from "./classify.js";

const kernelBin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fallback-kernel/kernel");

function attachKernel(payload: unknown, command = "attach"): string {
  const child = spawnSync(kernelBin, [command], { input: JSON.stringify(payload), encoding: "utf8" });
  if (child.status !== 0) throw new Error(child.stderr || "fallback-kernel failed");
  return child.stdout.trim();
}
import { extractLastAssistantError } from "./extract.js";
import { readGateUsage } from "./grokUsage.js";
import { decideFailover, findChain, modelKey, splitModelKey } from "./kernel.js";
import { loadFallbackConfigFile } from "./load.js";
import type {
  AttachHandle,
  BeforeAgentStartEventLike,
  AttachOptions,
  FallbackConfig,
  FallbackCtx,
  FallbackEvent,
  FallbackHost,
  ModelKey,
  UsageGate,
  UsageMetric,
} from "./types.js";
import { matchingGate, reportedUsage, thresholdCrossed, usageRecovered } from "./usage.js";

type EpochState = {
  preferred?: ModelKey;
  attempted: Set<ModelKey>;
  remainingBudget: number;
  toolsThisTurn: boolean;
  ignoreModelSelectKey?: ModelKey;
  failoverInFlight: boolean;
  usageHeld: Set<ModelKey>;
  /** Anthropic stop_details.category from this turn's stream. Cleared when the next turn starts. */
  refusalCategory?: string;
}

function eventRecord(event: unknown): Record<string, unknown> {
  return event !== null && typeof event === "object" ? (event as Record<string, unknown>) : {};
}

function currentKey(ctx: FallbackCtx): ModelKey | undefined {
  const text = attachKernel({ op: "current", provider: ctx.model?.provider ?? "", id: ctx.model?.id ?? "" });
  return text === "null" ? undefined : text;
}

function assistantEntryId(event: unknown): string | undefined {
  const text = attachKernel({ op: "entry", event });
  return text === "null" ? undefined : text;
}

function modelFromEvent(value: unknown): { provider: string; id: string } | undefined {
  const text = attachKernel({ op: "model", value });
  return text === "null" ? undefined : JSON.parse(text) as { provider: string; id: string };
}

function refusalCategoryFromStream(event: unknown): string | undefined {
  const text = attachKernel({ op: "refusal", event });
  return text === "null" ? undefined : text;
}

function resumeInPlace(entry: unknown): boolean {
  return attachKernel({ op: "resume", entry }) === "true";
}

function newestCompaction(branch: ReadonlyArray<{ type?: string }>, fallback: unknown): unknown {
  return JSON.parse(attachKernel({ op: "compaction", branch, fallback }));
}

// Quota, transient, and safety failover run at agent_before_settle.
// setModel, omit the failed assistant, and continue so the request is
// replayed with no new user message. agent_settled only clears turn state.

export function attachFallback(pi: FallbackHost, options: AttachOptions): AttachHandle {
  const emit = (event: FallbackEvent, ctx?: FallbackCtx): void => {
    options.onEvent?.(event, ctx);
  };
  let config: FallbackConfig | undefined;
  let enabled = false;

  if (options.config) {
    config = options.config;
    enabled = config.enabled;
  } else if (options.configPath) {
    const loaded = loadFallbackConfigFile(options.configPath);
    if (!loaded.ok) {
      emit({ type: "config-error", reason: loaded.reason, path: options.configPath });
    } else {
      config = loaded.config;
      enabled = config.enabled;
    }
  } else {
    emit({ type: "config-error", reason: "missing" });
  }

  const state: EpochState = {
    attempted: new Set(),
    remainingBudget: config?.maxFailoversPerRequest ?? 0,
    toolsThisTurn: false,
    failoverInFlight: false,
    usageHeld: new Set(),
  };

  const resetEpoch = (): void => {
    state.attempted = new Set();
    state.remainingBudget = config?.maxFailoversPerRequest ?? 0;
    state.toolsThisTurn = false;
    state.refusalCategory = undefined;
  };

  const snapshotPreferred = (ctx: FallbackCtx): void => {
    const key = currentKey(ctx);
    if (key) state.preferred = key;
  };

  const applyModelSwitch = async (
    ctx: FallbackCtx,
    nextKey: ModelKey,
  ): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const parsed = splitModelKey(nextKey);
    if (!parsed) return { ok: false, reason: "invalid-current" };
    const model = ctx.modelRegistry.find(parsed.provider, parsed.id);
    if (!model) return { ok: false, reason: "not-in-registry" };

    let thinking: string | undefined;
    try {
      thinking = pi.getThinkingLevel();
    } catch (err) {
      emit({ type: "host-error", where: "getThinkingLevel", message: err instanceof Error ? err.message : String(err) }, ctx);
    }

    state.ignoreModelSelectKey = nextKey;
    try {
      const ok = await pi.setModel(model);
      if (!ok) {
        if (state.ignoreModelSelectKey === nextKey) state.ignoreModelSelectKey = undefined;
        return { ok: false, reason: "no-auth" };
      }
    } catch (err) {
      if (state.ignoreModelSelectKey === nextKey) state.ignoreModelSelectKey = undefined;
      emit({ type: "host-error", where: "setModel", message: err instanceof Error ? err.message : String(err), to: nextKey }, ctx);
      return { ok: false, reason: "setModel-threw" };
    }

    if (thinking !== undefined) {
      try {
        pi.setThinkingLevel(thinking);
      } catch (err) {
        emit({ type: "host-error", where: "setThinkingLevel", message: err instanceof Error ? err.message : String(err) }, ctx);
      }
    }
    if (state.ignoreModelSelectKey === nextKey) state.ignoreModelSelectKey = undefined;
    return { ok: true };
  };

  const sessionAccountId = (ctx: FallbackCtx): string | undefined => {
    const branch = ctx.sessionManager.getBranch();
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (entry?.type !== "custom" || entry.customType !== "grok-cli-active-account-v1") continue;
      const data = entry.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) continue;
      const id = (data as Record<string, unknown>).accountId;
      if (typeof id === "string" && id) return id;
    }
    return undefined;
  };

  const readUsage = (model: ModelKey, gate: UsageGate, ctx: FallbackCtx) => {
    if (options.readUsage) return options.readUsage({ model, gate, ctx });
    return readGateUsage({ gate, sessionAccountId: sessionAccountId(ctx) });
  };


  const readPreferredGate = async (
    ctx: FallbackCtx,
  ): Promise<
    | { kind: "ungated" }
    | { kind: "blocked"; reason: "unavailable" | "usage-held"; detail?: string }
    | { kind: "recovered"; metric: UsageMetric; value: number; threshold: number }
  > => {
    const preferred = state.preferred;
    if (!preferred || !config?.usageGates?.length) return { kind: "ungated" };
    const gate = matchingGate(config.usageGates, preferred);
    if (!gate) return { kind: "ungated" };
    const reading = await readUsage(preferred, gate, ctx);
    if (!reading.ok) {
      state.usageHeld.add(preferred);
      return { kind: "blocked", reason: "unavailable", detail: reading.reason };
    }
    if (!usageRecovered(gate, reading.value)) {
      state.usageHeld.add(preferred);
      return { kind: "blocked", reason: "usage-held" };
    }
    state.usageHeld.delete(preferred);
    return {
      kind: "recovered",
      metric: gate.metric,
      value: reportedUsage(gate.metric, reading.value) ?? reading.value,
      threshold: gate.threshold,
    };
  };

  const returnToPreferred = async (ctx: FallbackCtx, current: ModelKey): Promise<boolean> => {
    const preferred = state.preferred;
    if (!preferred || preferred === current || !config) return false;
    const probe = await readPreferredGate(ctx);
    if (probe.kind === "blocked") {
      emit({ type: "usage-skip", reason: probe.reason, model: preferred, detail: probe.detail }, ctx);
      return false;
    }
    const switched = await applyModelSwitch(ctx, preferred);
    if (!switched.ok) {
      emit({ type: "skip", reason: switched.reason, to: preferred }, ctx);
      return false;
    }
    resetEpoch();
    emit(
      {
        type: "usage-return",
        from: current,
        to: preferred,
        ...(probe.kind === "recovered"
          ? { metric: probe.metric, value: probe.value, threshold: probe.threshold }
          : {}),
      },
      ctx,
    );
    return true;
  };

  pi.on("session_start", (_event, ctx) => {
    resetEpoch();
    state.usageHeld = new Set();
    snapshotPreferred(ctx);
  });

  pi.on("model_select", (event, _ctx) => {
    const rec = eventRecord(event);
    const model = modelFromEvent(rec.model);
    if (!model) return;
    const key = modelKey(model.provider, model.id);
    const source = rec.source;
    if (state.ignoreModelSelectKey && key === state.ignoreModelSelectKey && source === "set") {
      state.ignoreModelSelectKey = undefined;
      return;
    }
    state.ignoreModelSelectKey = undefined;
    if (source === "restore") {
      if (!state.preferred) state.preferred = key;
      return;
    }
    state.preferred = key;
    state.usageHeld = new Set();
    resetEpoch();
  });

  pi.on("tool_execution_start", () => {
    state.toolsThisTurn = true;
  });

  pi.on("provider_stream_event", (event) => {
    const category = refusalCategoryFromStream(event);
    if (category) state.refusalCategory = category;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    state.refusalCategory = undefined;
    if ((event as BeforeAgentStartEventLike).messageType === "custom") return;
    if (options.checkUsage === false) return;
    if (!config?.enabled) return;
    if (state.failoverInFlight) return;
    const current = currentKey(ctx);
    if (!current) return;
    if (!state.preferred) state.preferred = current;
    if (current !== state.preferred && (await returnToPreferred(ctx, current))) return;

    const gates = config.usageGates;
    if (!gates?.length) return;
    const gate = matchingGate(gates, current);
    if (!gate) return;

    const reading = await readUsage(current, gate, ctx);
    if (!reading.ok) {
      emit({ type: "usage-skip", reason: "unavailable", model: current, detail: reading.reason }, ctx);
      return;
    }
    if (!thresholdCrossed(gate, reading.value)) {
      state.usageHeld.delete(current);
      return;
    }
    state.usageHeld.add(current);

    const chain = findChain(config, current);
    if (!chain) {
      emit({ type: "usage-skip", reason: "not-in-chain", model: current }, ctx);
      return;
    }

    const reported = reportedUsage(gate.metric, reading.value) ?? reading.value;
    for (const key of chain.models) {
      if (key === current || state.usageHeld.has(key)) continue;
      const nextGate = matchingGate(gates, key);
      if (nextGate) {
        const nextReading = await readUsage(key, nextGate, ctx);
        if (!nextReading.ok || thresholdCrossed(nextGate, nextReading.value)) {
          if (nextReading.ok) state.usageHeld.add(key);
          continue;
        }
        state.usageHeld.delete(key);
      }
      const switched = await applyModelSwitch(ctx, key);
      if (!switched.ok) {
        emit({ type: "skip", reason: switched.reason, to: key }, ctx);
        continue;
      }
      emit(
        {
          type: "usage-switch",
          from: current,
          to: key,
          metric: gate.metric,
          value: reported,
          threshold: gate.threshold,
        },
        ctx,
      );
      return;
    }
    emit({ type: "usage-skip", reason: "no-target", model: current }, ctx);
  });
  pi.on("session_compact", async (event, ctx) => {
    if (!config || !enabled) return;
    const rec = eventRecord(event);
    const reason = rec.reason;
    const willRetry = rec.willRetry === true;
    if (reason === "overflow" && willRetry) {
      emit({ type: "stay", reason: "overflow-will-retry" }, ctx);
      return;
    }
    if (reason === "manual" || reason === "threshold" || (reason === "overflow" && !willRetry)) {
      const entry = newestCompaction(ctx.sessionManager.getBranch(), rec.compactionEntry);
      if (reason === "manual" && resumeInPlace(entry)) {
        emit({ type: "stay", reason: "resume-in-place" }, ctx);
        return;
      }
      const current = currentKey(ctx);
      if (state.preferred && current !== state.preferred) {
        if (options.checkUsage === false) {
          if (state.usageHeld.has(state.preferred)) {
            emit({ type: "usage-skip", reason: "usage-held", model: state.preferred }, ctx);
          } else {
            const switched = await applyModelSwitch(ctx, state.preferred);
            if (!switched.ok) {
              emit({ type: "restore", ok: false, to: state.preferred, reason: switched.reason }, ctx);
            } else {
              emit({ type: "restore", ok: true, to: state.preferred }, ctx);
            }
          }
        } else {
          const probe = await readPreferredGate(ctx);
          if (probe.kind === "blocked") {
            emit({ type: "usage-skip", reason: probe.reason, model: state.preferred, detail: probe.detail }, ctx);
          } else {
            const switched = await applyModelSwitch(ctx, state.preferred);
            if (!switched.ok) {
              emit({ type: "restore", ok: false, to: state.preferred, reason: switched.reason }, ctx);
            } else {
              emit({ type: "restore", ok: true, to: state.preferred }, ctx);
            }
          }
        }
      }
      resetEpoch();
    }
  });

  const onFailover = async (
    ctx: FallbackCtx,
    event: unknown,
    mode: "replay" | "safety",
  ): Promise<{ continue: true; entries: [{ type: "context_edit"; targetId: string; replacement: null }] } | undefined> => {
    const error = extractLastAssistantError(ctx.sessionManager.getBranch());
    if (error && state.refusalCategory) error.category = state.refusalCategory;
    const classification = error ? classifyError(error) : undefined;
    const virtual = currentKey(ctx);
    const physical = error?.provider && error.model ? modelKey(error.provider, error.model) : undefined;
    const gate = JSON.parse(attachKernel({
      enabled: Boolean(config && enabled),
      inFlight: state.failoverInFlight,
      mode,
      idle: ctx.isIdle(),
      hasError: Boolean(error),
      classification,
      worthy: classification ? isFailoverWorthy(classification) : false,
      retryAfterTools: options.retryAfterTools,
      toolsThisTurn: state.toolsThisTurn,
      virtual: virtual ?? "",
      physical: physical ?? "",
      replayTarget: mode === "replay" ? assistantEntryId(event) ?? "" : "kept",
    }, "settle")) as {
      action: "return" | "skip" | "continue";
      reason?: string;
      classification?: string;
      clearTools: boolean;
      current?: string;
      preferred?: string;
      replayTarget?: string;
    };
    if (gate.clearTools) state.toolsThisTurn = false;
    if (gate.action === "skip") {
      emit({ type: "skip", reason: gate.reason ?? "", ...(gate.classification ? { classification: gate.classification } : {}) }, ctx);
      return;
    }
    if (gate.action !== "continue" || !gate.current) return;
    const current = gate.current;
    state.preferred ??= gate.preferred ?? current;
    const replayTarget = gate.replayTarget;

    const bound = Number(attachKernel({ lengths: (config?.chains ?? []).map((chain) => chain.models.length) }, "bound"));
    for (let i = 0; i < bound; i++) {
      const decision = decideFailover({
        config,
        current,
        error,
        attempted: state.attempted,
        remainingBudget: state.remainingBudget,
        blocked: state.usageHeld,
      });
      if (decision.action === "none") {
        const book = JSON.parse(attachKernel({ kind: "none" }, "switch")) as { clearTools?: boolean };
        if (book.clearTools) state.toolsThisTurn = false;
        emit({ type: "skip", reason: decision.reason, classification: decision.classification }, ctx);
        return;
      }

      state.attempted = decision.attempted;
      const parsed = splitModelKey(decision.next);
      const found = Boolean(parsed && ctx.modelRegistry.find(parsed.provider, parsed.id));
      if (!found) {
        const book = JSON.parse(attachKernel({ kind: "missing" }, "switch")) as { remember?: boolean; reason?: string };
        if (book.remember) state.attempted.add(decision.next);
        emit({ type: "skip", reason: book.reason ?? "not-in-registry", to: decision.next }, ctx);
        continue;
      }

      state.failoverInFlight = true;
      try {
        const switched = await applyModelSwitch(ctx, decision.next);
        if (!switched.ok) {
          const book = JSON.parse(attachKernel({ kind: "rejected" }, "switch")) as { remember?: boolean };
          if (book.remember) state.attempted.add(decision.next);
          emit({ type: "skip", reason: switched.reason, to: decision.next }, ctx);
          continue;
        }

        const book = JSON.parse(attachKernel({
          kind: mode === "replay" && replayTarget ? "replay" : "continue",
          budget: state.remainingBudget,
        }, "switch")) as { action?: string; budget?: number; clearTools?: boolean };
        if (book.action === "replay" && replayTarget) {
          state.remainingBudget = book.budget ?? state.remainingBudget - 1;
          if (book.clearTools) state.toolsThisTurn = false;
          emit(
            {
              type: "failover",
              from: current,
              to: decision.next,
              reason: decision.reason,
              budget: state.remainingBudget,
            },
            ctx,
          );
          return {
            continue: true,
            entries: [{ type: "context_edit", targetId: replayTarget, replacement: null }],
          };
        }
      } finally {
        state.failoverInFlight = false;
      }
    }
  };

  pi.on("agent_before_settle", (event, ctx) => onFailover(ctx, event, "replay"));

  pi.on("agent_settled", (event, ctx) => onFailover(ctx, event, "safety"));

  return {
    getDebugState() {
      return {
        preferred: state.preferred,
        attempted: [...state.attempted],
        remainingBudget: state.remainingBudget,
        toolsThisTurn: state.toolsThisTurn,
        enabled,
      };
    },
  };
}
