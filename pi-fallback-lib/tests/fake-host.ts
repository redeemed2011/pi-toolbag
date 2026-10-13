import type { FallbackCtx, FallbackHost } from "../src/types.js";

export type ModelStub = { provider: string; id: string };

type SetModelMode = "ok" | "false" | "throw";

export class FakeHost implements FallbackHost {
  model: ModelStub;
  thinking: string;
  idle = true;
  mode = "tui";
  hasUI = false;
  notifies: string[] = [];
  sent: string[] = [];
  setModelCalls: string[] = [];
  thinkingSets: string[] = [];
  branch: Array<{
    id?: string;
    type?: string;
    message?: { role?: string; stopReason?: string; errorMessage?: string; rawStopReason?: string };
  }> = [];
  registry = new Map<string, ModelStub>();
  setModelMode = new Map<string, SetModelMode>();
  emitSettledDuringSetModel = false;
  throwOnSend = false;
  emitBeforeAgentStartOnSend = false;
  ctx: FallbackCtx;

  private settling = false;
  private settleDepth = 0;
  private deferred: Array<() => Promise<void>> = [];
  /** True once a deferred send records `sent` after the settle handler returned. */
  recordedAfterHandler = false;
  throwOnDeferredSend = false;
  /** Test opt-in: the deferred send re-emits `agent_settled`. */
  reemitSettledOnDeferredSend = false;

  private handlers = new Map<string, Array<(event: unknown, ctx: FallbackCtx) => unknown>>();
  constructor(model: ModelStub, thinking = "low") {
    this.model = { ...model };
    this.thinking = thinking;
    this.ctx = this.buildCtx();
  }

  addModel(model: ModelStub): void {
    this.registry.set(`${model.provider}/${model.id}`, { ...model });
  }

  on(event: string, handler: (event: unknown, ctx: FallbackCtx) => unknown): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  replayResults: unknown[] = [];

  async emit(event: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    this.ctx = this.buildCtx();
    const handlers = this.handlers.get(event) ?? [];
    const ownSettle = event === "agent_settled";
    if (ownSettle) {
      this.settleDepth += 1;
      this.settling = true;
    }
    let result: unknown;
    try {
      for (const handler of handlers) {
        result = await handler({ type: event, ...payload }, this.ctx);
      }
    } finally {
      if (ownSettle) {
        this.settleDepth -= 1;
        this.settling = this.settleDepth > 0;
      }
    }
    if (event === "agent_before_settle") this.replayResults.push(result);
    if (ownSettle && this.settleDepth === 0) {
      const queued = this.deferred.splice(0);
      for (const action of queued) await action();
    }
    return result;
  }

  async setModel(model: unknown): Promise<boolean> {
    const stub = model as ModelStub;
    const key = `${stub.provider}/${stub.id}`;
    this.setModelCalls.push(key);
    const mode = this.setModelMode.get(key) ?? "ok";
    if (mode === "throw") throw new Error(`setModel failed for ${key}`);
    if (mode === "false") return false;
    const previous = { ...this.model };
    this.model = { provider: stub.provider, id: stub.id };
    if (this.emitSettledDuringSetModel) {
      await this.emit("agent_settled");
    }
    await this.emit("model_select", { model: this.model, previousModel: previous, source: "set" });
    return true;
  }

  sendUserMessage(content: string): void | Promise<void> {
    if (this.throwOnSend) throw new Error("sendUserMessage failed");
    if (this.settling) {
      this.deferred.push(async () => {
        if (this.throwOnDeferredSend) throw new Error("deferred send failed");
        this.sent.push(content);
        this.recordedAfterHandler = true;
        this.idle = false;
        this.idle = true;
        if (this.reemitSettledOnDeferredSend) await this.emit("agent_settled");
      });
      return;
    }
    this.sent.push(content);
    if (this.emitBeforeAgentStartOnSend) return this.emit("before_agent_start").then(() => undefined);
  }

  getThinkingLevel(): string {
    return this.thinking;
  }

  setThinkingLevel(level: string): void {
    this.thinking = level;
    this.thinkingSets.push(level);
  }

  setAssistantError(text: string, stopReason = "error", rawStopReason?: string): void {
    this.branch = [
      {
        id: "asst-1",
        type: "message",
        message: {
          role: "assistant",
          stopReason,
          errorMessage: text,
          ...(rawStopReason ? { rawStopReason } : {}),
        },
      },
    ];
  }

  private buildCtx(): FallbackCtx {
    return {
      model: this.model,
      modelRegistry: {
        find: (provider: string, id: string) => this.registry.get(`${provider}/${id}`),
      },
      sessionManager: { getBranch: () => this.branch },
      hasUI: this.hasUI,
      mode: this.mode,
      ui: {
        notify: (message: string) => {
          this.notifies.push(message);
        },
      },
      isIdle: () => this.idle,
    };
  }
}
