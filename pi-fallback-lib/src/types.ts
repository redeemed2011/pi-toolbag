/** "provider/id" split on first slash only. */
export type ModelKey = string;

export type FallbackChain = {
  name: string;
  models: ModelKey[];
};

export type FallbackConfig = {
  enabled: boolean;
  chains: FallbackChain[];
  maxFailoversPerRequest: number;
};

export type FailoverError = {
  /**
   * Optional HTTP status for kernel unit tests that pass an object directly.
   * Production `extractLastAssistantError` never sets this field (no
   * `after_provider_response`). Attach classifies from `errorMessage` text only.
   */
  status?: number;
  text: string;
  stopReason?: string;
};

export type ErrorClass =
  | "quota"
  | "transient"
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
  | "invalid-budget";

export type ParseResult =
  | { ok: true; config: FallbackConfig }
  | { ok: false; reason: ParseFailReason };

export type AttachOptions = {
  retryAfterTools: boolean;
  /** Already-parsed config. Wins over configPath. */
  config?: FallbackConfig;
  /** Absolute path supplied by the caller. Helper never guesses ~/.pi. */
  configPath?: string;
  log?: (line: string) => void;
  /** Default true. When ctx.hasUI, also ctx.ui.notify. */
  notify?: boolean;
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
  sendUserMessage(content: string): void;
  getThinkingLevel(): string;
  setThinkingLevel(level: string): void;
};

export type FallbackCtx = {
  model?: { provider: string; id: string };
  modelRegistry: { find(provider: string, id: string): unknown };
  sessionManager: {
    getBranch(): ReadonlyArray<{
      type?: string;
      message?: {
        role?: string;
        stopReason?: string;
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
