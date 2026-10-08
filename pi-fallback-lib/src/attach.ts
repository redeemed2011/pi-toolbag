import { classifyError, isFailoverWorthy } from "./classify.js";
import { extractLastAssistantError } from "./extract.js";
import { readGateUsage } from "./grokUsage.js";
import { decideFailover, findChain, modelKey, splitModelKey } from "./kernel.js";
import { loadFallbackConfigFile } from "./load.js";
import type {
  AttachHandle,
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

export const CONTINUE_AFTER_STOP =
  "The previous model stopped. The tool results already in the conversation are done; do not repeat them. Finish the original request.";

export const CONTINUE_AFTER_BLOCK =
  "The previous model was blocked. Do not repeat that approach. The tool results already in the conversation are done; do not repeat them. Finish the request a different way.";

type EpochState = {
  preferred?: ModelKey;
  attempted: Set<ModelKey>;
  remainingBudget: number;
  toolsThisTurn: boolean;
  ignoreModelSelectKey?: ModelKey;
  failoverInFlight: boolean;
  usageHeld: Set<ModelKey>;
  /** The continue retry must stay on the fallback. Cleared by the next prompt. */
  deferReturn: boolean;
  /** Anthropic stop_details.category from this turn's stream. Cleared when the next turn starts. */
  refusalCategory?: string;
}

function currentKey(ctx: FallbackCtx): ModelKey | undefined {
  if (!ctx.model?.provider || !ctx.model.id) return undefined;
  return modelKey(ctx.model.provider, ctx.model.id);
}

function eventRecord(event: unknown): Record<string, unknown> {
  return event !== null && typeof event === "object" ? (event as Record<string, unknown>) : {};
}

function modelFromEvent(value: unknown): { provider: string; id: string } | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const rec = value as Record<string, unknown>;
  if (typeof rec.provider !== "string" || typeof rec.id !== "string") return undefined;
  return { provider: rec.provider, id: rec.id };
}

async function maybeAwait(value: unknown): Promise<void> {
  if (value !== null && typeof value === "object" && "then" in value) {
    await value;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function refusalCategoryFromStream(event: unknown): string | undefined {
  const data = eventRecord(event).data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) return undefined;
  const message = data as Record<string, unknown>;
  if (message.type !== "message_delta") return undefined;
  const delta = message.delta;
  if (delta === null || typeof delta !== "object" || Array.isArray(delta)) return undefined;
  const details = (delta as Record<string, unknown>).stop_details;
  if (details === null || typeof details !== "object" || Array.isArray(details)) return undefined;
  const category = (details as Record<string, unknown>).category;
  return typeof category === "string" && category ? category : undefined;
}

/**
 * ExtensionAPI.sendUserMessage is fire-and-forget. Interactive TUI can
 * keep running; print/json (`pi -p`, observer workers) return from
 * prompt() as soon as this agent_settled handler finishes, then exit 1
 * if the last assistant is still the failed turn. Wait until the
 * continue run starts and settles so the last message is the fallback.
 */
async function waitForContinueTurn(
  ctx: FallbackCtx,
  emit: (event: FallbackEvent, ctx?: FallbackCtx) => void,
): Promise<void> {
  const startDeadline = Date.now() + 30_000;
  while (ctx.isIdle() && Date.now() < startDeadline) {
    await delay(20);
  }
  if (ctx.isIdle()) {
    emit({ type: "skip", reason: "continue-did-not-start" }, ctx);
    return;
  }
  while (!ctx.isIdle()) {
    await delay(50);
  }
}

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
    deferReturn: false,
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
    state.deferReturn = false;
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
    state.deferReturn = false;
    resetEpoch();
  });

  pi.on("tool_execution_start", () => {
    state.toolsThisTurn = true;
  });

  pi.on("provider_stream_event", (event) => {
    const category = refusalCategoryFromStream(event);
    if (category) state.refusalCategory = category;
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    state.refusalCategory = undefined;
    if (options.checkUsage === false) return;
    if (!config?.enabled) return;
    if (state.deferReturn) {
      state.deferReturn = false;
      return;
    }
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

  pi.on("agent_settled", async (_event, ctx) => {
    if (!config || !enabled) return;
    if (state.failoverInFlight) return;
    if (!ctx.isIdle()) {
      emit({ type: "skip", reason: "not-idle" }, ctx);
      return;
    }

    const error = extractLastAssistantError(ctx.sessionManager.getBranch());
    if (!error) {
      state.toolsThisTurn = false;
      return;
    }
    if (state.refusalCategory) error.category = state.refusalCategory;

    if (!options.retryAfterTools && state.toolsThisTurn) {
      emit({ type: "skip", reason: "tools-already-started" }, ctx);
      state.toolsThisTurn = false;
      return;
    }

    const current = currentKey(ctx);
    if (!current) {
      emit({ type: "skip", reason: "no-current-model" }, ctx);
      state.toolsThisTurn = false;
      return;
    }
    if (!state.preferred) state.preferred = current;

    const classification = classifyError(error);
    if (!isFailoverWorthy(classification)) {
      emit({ type: "skip", reason: "not-failover-worthy", classification }, ctx);
      state.toolsThisTurn = false;
      return;
    }

    const bound = Math.max(1, ...config.chains.map((chain) => chain.models.length));
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
        emit({ type: "skip", reason: decision.reason, classification: decision.classification }, ctx);
        state.toolsThisTurn = false;
        return;
      }

      state.attempted = decision.attempted;
      const parsed = splitModelKey(decision.next);
      if (!parsed || !ctx.modelRegistry.find(parsed.provider, parsed.id)) {
        state.attempted.add(decision.next);
        emit({ type: "skip", reason: "not-in-registry", to: decision.next }, ctx);
        continue;
      }

      state.failoverInFlight = true;
      try {
        const switched = await applyModelSwitch(ctx, decision.next);
        if (!switched.ok) {
          state.attempted.add(decision.next);
          emit({ type: "skip", reason: switched.reason, to: decision.next }, ctx);
          continue;
        }

        try {
          if (!ctx.isIdle()) {
            emit({ type: "skip", reason: "not-idle-after-setModel" }, ctx);
            return;
          }
          // ExtensionAPI.sendUserMessage is void and fire-and-forget
          // (session wrapper .catch(emitError)). A throw is only visible
          // when the host is synchronous (tests). Budget decrements after
          // a successful call from this process.
          state.deferReturn = true;
          const sent = pi.sendUserMessage(
            classification === "safety" ? CONTINUE_AFTER_BLOCK : CONTINUE_AFTER_STOP,
          );
          await maybeAwait(sent);
        } catch (err) {
          state.deferReturn = false;
          emit({ type: "skip", reason: "continue-threw", detail: err instanceof Error ? err.message : String(err) }, ctx);
          return;
        }

        state.remainingBudget -= 1;
        state.toolsThisTurn = false;
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
        if (ctx.mode === "print" || ctx.mode === "json") {
          await waitForContinueTurn(ctx, emit);
        }
        return;
      } finally {
        state.failoverInFlight = false;
      }
    }
  });

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
