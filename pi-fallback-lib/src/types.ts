/** "provider/id" split on first slash only. */
export type ModelKey = string;

export type UsageMetric = "percent" | "tokens";

/** Named SuperGrok weekly percent, or a caller-chosen HTTPS JSON field. */
export type UsageSource =
  | { kind: "grok-cli" }
  | {
      kind: "http";
      url: string;
      path: string;
      auth: "none" | "bearer-env";
      /** Env var name. The secret stays in the environment. */
      env?: string;
    };

export type UsageGate = {
  /** Exact model keys. Match if current is in this list. */
  models?: ModelKey[];
  /** Provider segment before the first slash. Match every model of that provider. */
  provider?: string;
  metric: UsageMetric;
  /** Switch when the reported value is >= threshold. Percent is rounded like /usage. */
  threshold: number;
  source: UsageSource;
};

export type FallbackChain = {
  name: string;
  models: ModelKey[];
};

export type FallbackConfig = {
  enabled: boolean;
  chains: FallbackChain[];
  maxFailoversPerRequest: number;
  usageGates?: UsageGate[];
};

export type FailoverError = {
  /**
   * Optional HTTP status for kernel unit tests that pass an object directly.
   * Production `extractLastAssistantError` never sets this field (no
   * `after_provider_response`). Attach classifies from the error text and rawStopReason.
   */
  status?: number;
  text: string;
  stopReason?: string;
  /** Provider stop token copied by extract. Absent when the message has none. */
  rawStopReason?: string;
  /** Anthropic stop_details.category when attach saw it on the stream. Not stored on the message. */
  category?: string;
};

export type ErrorClass =
  | "quota"
  | "transient"
  | "safety"
  | "auth"
  | "invalid-model"
  | "overflow"
  | "aborted"
  | "other";

export type DecideInput = {
  config: FallbackConfig;
  current: ModelKey;
  error: FailoverError;
  attempted: ReadonlySet<ModelKey>;
  remainingBudget: number;
  /** Models a usage gate is holding. Skipped as failover targets; not marked attempted. */
  blocked?: ReadonlySet<ModelKey>;
};

export type FailoverDecision =
  | {
      action: "failover";
      next: ModelKey;
      reason: ErrorClass;
      /** attempted ∪ { current } — next is NOT marked attempted until it fails or setModel returns false */
      attempted: Set<ModelKey>;
    }
  | {
      action: "none";
      reason:
        | "disabled"
        | "budget-exhausted"
        | "not-failover-worthy"
        | "not-in-chain"
        | "no-unused-member"
        | "invalid-current";
      classification?: ErrorClass;
    };

export type ParseFailReason =
  | "missing"
  | "invalid-json"
  | "not-object"
  | "no-chains"
  | "invalid-chain"
  | "invalid-model-key"
  | "duplicate-key"
  | "invalid-budget"
  | "invalid-usage-gate";

export type ParseResult =
  | { ok: true; config: FallbackConfig }
  | { ok: false; reason: ParseFailReason };

export type FallbackEvent =
  | {
      type: "skip";
      reason: string;
      classification?: ErrorClass;
      to?: ModelKey;
      detail?: string;
    }
  | {
      type: "failover";
      from: ModelKey;
      to: ModelKey;
      reason: ErrorClass;
      budget: number;
    }
  | { type: "restore"; ok: boolean; to: ModelKey; reason?: string }
  | { type: "stay"; reason: "overflow-will-retry" }
  | { type: "config-error"; reason: ParseFailReason | "missing"; path?: string }
  | {
      type: "host-error";
      where: "getThinkingLevel" | "setThinkingLevel" | "setModel";
      message: string;
      to?: ModelKey;
    }
  | {
      type: "usage-switch";
      from: ModelKey;
      to: ModelKey;
      metric: UsageMetric;
      value: number;
      threshold: number;
    }
  | {
      type: "usage-return";
      from: ModelKey;
      to: ModelKey;
      metric?: UsageMetric;
      value?: number;
      threshold?: number;
    }
  | {
      type: "usage-skip";
      reason: "unavailable" | "not-in-chain" | "no-target" | "usage-held";
      model?: ModelKey;
      to?: ModelKey;
      detail?: string;
    };

export type AttachOptions = {
  retryAfterTools: boolean;
  /** Already-parsed config. Wins over configPath. */
  config?: FallbackConfig;
  /** Absolute path supplied by the caller. Helper never guesses ~/.pi. */
  configPath?: string;
  /** Structured outcomes. The library never writes stdout/stderr or calls notify. */
  onEvent?: (event: FallbackEvent, ctx?: FallbackCtx) => void;
  /**
   * Pre-request usage check. Default true.
   * Offline workers should set false so a billing fetch cannot stall them.
   */
  checkUsage?: boolean;
  /**
   * Test seam. When set, attach does not call the network.
   * `value` is the raw endpoint number; percent rounding happens in the gate.
   */
  readUsage?: (input: {
    model: ModelKey;
    gate: UsageGate;
    ctx: FallbackCtx;
  }) => Promise<{ ok: true; value: number } | { ok: false; reason: string }>;
};

export type AttachHandle = {
  /** Test seam: current epoch snapshot. Not a slash-command. */
  getDebugState(): {
    preferred?: ModelKey;
    attempted: ModelKey[];
    remainingBudget: number;
    toolsThisTurn: boolean;
    enabled: boolean;
  };
};

export type FallbackHost = {
  on(event: string, handler: (event: unknown, ctx: FallbackCtx) => unknown): void;
  setModel(model: unknown): Promise<boolean>;
  sendUserMessage(content: string): void | Promise<void>;
  getThinkingLevel(): string;
  setThinkingLevel(level: string): void;
};

export type FallbackCtx = {
  model?: { provider: string; id: string };
  modelRegistry: { find(provider: string, id: string): unknown };
  sessionManager: {
    getBranch(): ReadonlyArray<{
      type?: string;
      customType?: string;
      data?: unknown;
      message?: {
        role?: string;
        stopReason?: string;
        rawStopReason?: string;
        errorMessage?: string;
      };
    }>;
  };
  hasUI: boolean;
  ui?: { notify?: (message: string, type?: "info" | "warning" | "error") => void };
  isIdle(): boolean;
  /** Pi run mode. Print/json exit after the first settle unless we wait. */
  mode?: string;
};
