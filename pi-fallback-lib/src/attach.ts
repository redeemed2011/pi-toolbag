import { classifyError, isFailoverWorthy } from "./classify.js";
import { extractLastAssistantError } from "./extract.js";
import { decideFailover, modelKey, splitModelKey } from "./kernel.js";
import { loadFallbackConfigFile } from "./load.js";
import type {
  AttachHandle,
  AttachOptions,
  FallbackConfig,
  FallbackCtx,
  FallbackEvent,
  FallbackHost,
  ModelKey,
} from "./types.js";

export const CONTINUE_USER_MESSAGE = "continue" as const;

type EpochState = {
  preferred?: ModelKey;
  attempted: Set<ModelKey>;
  remainingBudget: number;
  toolsThisTurn: boolean;
  ignoreModelSelectKey?: ModelKey;
  failoverInFlight: boolean;
};

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
  };

  const resetEpoch = (): void => {
    state.attempted = new Set();
    state.remainingBudget = config?.maxFailoversPerRequest ?? 0;
    state.toolsThisTurn = false;
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

  pi.on("session_start", (_event, ctx) => {
    resetEpoch();
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
    resetEpoch();
  });

  pi.on("tool_execution_start", () => {
    state.toolsThisTurn = true;
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
        const switched = await applyModelSwitch(ctx, state.preferred);
        if (!switched.ok) {
          emit({ type: "restore", ok: false, to: state.preferred, reason: switched.reason }, ctx);
        } else {
          emit({ type: "restore", ok: true, to: state.preferred }, ctx);
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
          const sent = pi.sendUserMessage(CONTINUE_USER_MESSAGE);
          await maybeAwait(sent);
        } catch (err) {
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
