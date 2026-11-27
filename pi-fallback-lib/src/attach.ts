import { classifyError, isFailoverWorthy } from "./classify.js";
import { runKernel } from "./kernelBin.js";

function attachKernel(payload: unknown, command = "attach"): string {
  return runKernel(command, payload);
}
import { extractLastAssistantError } from "./extract.js";
import { readGateUsage } from "./grokUsage.js";
import { decideFailover, findChain, modelKey, splitModelKey } from "./kernel.js";
import { loadFallbackConfigFile } from "./load.js";
import type {
  AttachHandle,
  BeforeAgentStartEventLike,
  AttachOptions,
  ErrorClass,
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
    const model = parsed ? ctx.modelRegistry.find(parsed.provider, parsed.id) : undefined;
    const early = JSON.parse(attachKernel({
      parsed: Boolean(parsed), found: Boolean(model), called: false, setOK: false, threw: false, sameIgnore: false,
    }, "model-switch")) as { ok: boolean; reason?: string };
    if (!early.ok) return { ok: false, reason: early.reason ?? "invalid-current" };

    let thinking: string | undefined;
    try {
      thinking = pi.getThinkingLevel();
    } catch (err) {
      emit({ type: "host-error", where: "getThinkingLevel", message: err instanceof Error ? err.message : String(err) }, ctx);
    }

    state.ignoreModelSelectKey = nextKey;
    let setOK = false;
    let threw = false;
    let thrown: unknown;
    try {
      setOK = await pi.setModel(model!);
    } catch (err) {
      threw = true;
      thrown = err;
    }
    const book = JSON.parse(attachKernel({
      parsed: true,
      found: true,
      called: true,
      setOK,
      threw,
      sameIgnore: state.ignoreModelSelectKey === nextKey,
    }, "model-switch")) as { ok: boolean; reason?: string; clearIgnore?: boolean };
    if (!book.ok && book.clearIgnore) state.ignoreModelSelectKey = undefined;
    if (threw) {
      const err = thrown;
      emit({ type: "host-error", where: "setModel", message: err instanceof Error ? err.message : String(err), to: nextKey }, ctx);
    }
    if (!book.ok) return { ok: false, reason: book.reason ?? "no-auth" };

    if (thinking !== undefined) {
      try {
        pi.setThinkingLevel(thinking);
      } catch (err) {
        emit({ type: "host-error", where: "setThinkingLevel", message: err instanceof Error ? err.message : String(err) }, ctx);
      }
    }
    if (book.clearIgnore) state.ignoreModelSelectKey = undefined;
    return { ok: true };
  };

  const sessionAccountId = (ctx: FallbackCtx): string | undefined => {
    const text = attachKernel(ctx.sessionManager.getBranch(), "session");
    return text === "null" ? undefined : text;
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
    const gate = preferred && config?.usageGates?.length ? matchingGate(config.usageGates, preferred) : undefined;
    const reading = preferred && gate ? await readUsage(preferred, gate, ctx) : undefined;
    const kind = attachKernel({
      hasPreferred: Boolean(preferred),
      hasGates: Boolean(config?.usageGates?.length),
      hasGate: Boolean(gate),
      readingOK: Boolean(reading?.ok),
      recovered: Boolean(gate && reading?.ok && usageRecovered(gate, reading.value)),
    }, "preferred");
    if (kind === "ungated" || !preferred) return { kind: "ungated" };
    if (kind === "unavailable") {
      state.usageHeld.add(preferred);
      return { kind: "blocked", reason: "unavailable", detail: reading && !reading.ok ? reading.reason : undefined };
    }
    if (kind === "usage-held") {
      state.usageHeld.add(preferred);
      return { kind: "blocked", reason: "usage-held" };
    }
    state.usageHeld.delete(preferred);
    if (!gate || !reading?.ok) return { kind: "ungated" };
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
    const book = JSON.parse(attachKernel({
      key,
      source: typeof rec.source === "string" ? rec.source : "",
      ignore: state.ignoreModelSelectKey ?? "",
      hasPreferred: Boolean(state.preferred),
    }, "select")) as { action: string; preferred?: string; reset?: boolean };
    state.ignoreModelSelectKey = undefined;
    if (book.action === "ignore") return;
    if (book.action === "restore") {
      state.preferred = book.preferred;
      return;
    }
    if (book.action === "restore-keep") return;
    state.preferred = book.preferred ?? key;
    if (book.reset) {
      state.usageHeld = new Set();
      resetEpoch();
    }
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
    const current = currentKey(ctx);
    const start = attachKernel({
      messageType: (event as BeforeAgentStartEventLike).messageType ?? "",
      checkUsage: options.checkUsage !== false,
      enabled: Boolean(config?.enabled),
      inFlight: state.failoverInFlight,
      hasCurrent: Boolean(current),
    }, "before");
    if (start === "return" || !current || !config) return;
    if (!state.preferred) state.preferred = current;
    if (current !== state.preferred && (await returnToPreferred(ctx, current))) return;

    const gates = config.usageGates;
    if (!gates?.length) return;
    const gate = matchingGate(gates, current);
    if (!gate) return;

    const reading = await readUsage(current, gate, ctx);
    const crossed = reading.ok && thresholdCrossed(gate, reading.value);
    const chain = reading.ok && crossed ? findChain(config, current) : undefined;
    const readingKind = attachKernel({
      ok: reading.ok,
      crossed,
      inChain: Boolean(chain),
    }, "reading");
    if (readingKind === "unavailable") {
      emit({ type: "usage-skip", reason: "unavailable", model: current, detail: reading.ok ? undefined : reading.reason }, ctx);
      return;
    }
    if (readingKind === "clear") {
      state.usageHeld.delete(current);
      return;
    }
    state.usageHeld.add(current);
    if (readingKind === "not-in-chain" || !chain) {
      emit({ type: "usage-skip", reason: "not-in-chain", model: current }, ctx);
      return;
    }

    if (!reading.ok) return;
    const reported = reportedUsage(gate.metric, reading.value) ?? reading.value;
    for (const key of chain.models) {
      const nextGate = key === current || state.usageHeld.has(key) ? undefined : matchingGate(gates, key);
      const nextReading = nextGate ? await readUsage(key, nextGate, ctx) : undefined;
      const candidate = attachKernel({
        sameOrHeld: key === current || state.usageHeld.has(key),
        hasGate: Boolean(nextGate),
        readingOK: Boolean(nextReading?.ok),
        crossed: Boolean(nextGate && nextReading?.ok && thresholdCrossed(nextGate, nextReading.value)),
      }, "candidate");
      if (candidate === "skip") continue;
      if (candidate === "hold") {
        if (nextReading?.ok) state.usageHeld.add(key);
        continue;
      }
      if (candidate === "clear") state.usageHeld.delete(key);
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
    const rec = eventRecord(event);
    const reason = typeof rec.reason === "string" ? rec.reason : "";
    const willRetry = rec.willRetry === true;
    const started = attachKernel({
      enabled: Boolean(config && enabled),
      reason,
      willRetry,
    }, "compact");
    if (started === "return") return;
    if (started === "stay-retry") {
      emit({ type: "stay", reason: "overflow-will-retry" }, ctx);
      return;
    }
    const entry = newestCompaction(ctx.sessionManager.getBranch(), rec.compactionEntry);
    const resumed = attachKernel({ op: "resume", reason, resume: resumeInPlace(entry) }, "compact");
    if (resumed === "stay-resume") {
      emit({ type: "stay", reason: "resume-in-place" }, ctx);
      return;
    }
    const current = currentKey(ctx);
    if (state.preferred && current !== state.preferred) {
      const probe = options.checkUsage === false ? undefined : await readPreferredGate(ctx);
      const choice = attachKernel({
        op: "switch",
        checkUsage: options.checkUsage !== false,
        held: state.usageHeld.has(state.preferred),
        blocked: probe?.kind === "blocked",
      }, "compact");
      if (choice === "usage-held") {
        emit({ type: "usage-skip", reason: "usage-held", model: state.preferred }, ctx);
      } else if (choice === "blocked" && probe?.kind === "blocked") {
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
    resetEpoch();
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
      emit({ type: "skip", reason: gate.reason ?? "", ...(gate.classification ? { classification: gate.classification as ErrorClass } : {}) }, ctx);
      return;
    }
    if (gate.action !== "continue" || !gate.current || !config || !error) return;
    const current = gate.current;
    state.preferred ??= gate.preferred ?? current;
    const replayTarget = gate.replayTarget;

    const bound = Number(attachKernel({ lengths: config.chains.map((chain) => chain.models.length) }, "bound"));
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
