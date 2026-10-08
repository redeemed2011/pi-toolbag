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
    type?: string;
    message?: { role?: string; stopReason?: string; errorMessage?: string; rawStopReason?: string };
  }> = [];
  registry = new Map<string, ModelStub>();
  setModelMode = new Map<string, SetModelMode>();
  emitSettledDuringSetModel = false;
  throwOnSend = false;
  emitBeforeAgentStartOnSend = false;
  ctx: FallbackCtx;

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

  async emit(event: string, payload: Record<string, unknown> = {}): Promise<void> {
    this.ctx = this.buildCtx();
    const handlers = this.handlers.get(event) ?? [];
    for (const handler of handlers) {
      await handler({ type: event, ...payload }, this.ctx);
    }
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
    this.sent.push(content);
    if (this.emitBeforeAgentStartOnSend) return this.emit("before_agent_start");
    if (this.mode === "print" || this.mode === "json") {
      this.idle = false;
      setTimeout(() => {
        this.idle = true;
      }, 5);
    }
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
