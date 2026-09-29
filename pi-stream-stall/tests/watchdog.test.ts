import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { parseIdleTimeoutMs } from "../src/timeout.js";
import type { GuardModel, Sleeper, StreamSource } from "../src/watchdog.js";
import { guardStream } from "../src/watchdog.js";
import { WRAPPED, wrapProvider, wrapRegistry } from "../src/wrap.js";

const model: GuardModel = {
  api: "openai-responses",
  provider: "grok-cli",
  id: "grok-4.7",
};

function assistant(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 1,
  };
}

class Controllable implements StreamSource {
  private queue: AssistantMessageEvent[] = [];
  private waiters: Array<(value: IteratorResult<AssistantMessageEvent>) => void> = [];
  private finished = false;
  private final: AssistantMessage | undefined;
  aborted = false;

  push(event: AssistantMessageEvent): void {
    if (event.type === "error") this.final = event.error;
    if (event.type === "done") this.final = event.message;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: event, done: false });
    else this.queue.push(event);
  }

  finish(message?: AssistantMessage): void {
    this.finished = true;
    if (message) this.final = message;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: undefined, done: true });
  }

  next(): Promise<IteratorResult<AssistantMessageEvent>> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve({ value: queued, done: false });
    if (this.finished) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  [Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
    return this;
  }

  result(): Promise<AssistantMessage> {
    if (this.final) return Promise.resolve(this.final);
    return new Promise(() => undefined);
  }

  abort(): void {
    this.aborted = true;
  }
}

function immediateSleep(): Sleeper {
  return () => ({ promise: Promise.resolve(), cancel() {} });
}

function neverSleep(): Sleeper {
  return () => ({ promise: new Promise(() => undefined), cancel() {} });
}

function heldSleep(): { sleep: Sleeper; release: () => void; pending: () => number; cancelled: () => number } {
  const waiters: Array<{ resolve: () => void }> = [];
  let cancelled = 0;
  return {
    sleep: () => {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      const waiter = { resolve };
      waiters.push(waiter);
      return {
        promise,
        cancel: () => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) {
            waiters.splice(index, 1);
            cancelled += 1;
          }
        },
      };
    },
    release: () => {
      waiters.shift()?.resolve();
    },
    pending: () => waiters.length,
    cancelled: () => cancelled,
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("parseIdleTimeoutMs", () => {
  it("uses the flag, then the env, then 180s", () => {
    expect(parseIdleTimeoutMs("1000", "50")).toBe(1000);
    expect(parseIdleTimeoutMs(undefined, "50")).toBe(50);
    expect(parseIdleTimeoutMs(undefined, undefined)).toBe(180_000);
  });

  it("treats 0, off, and false as disabled", () => {
    expect(parseIdleTimeoutMs("0", undefined)).toBe(0);
    expect(parseIdleTimeoutMs("off", undefined)).toBe(0);
    expect(parseIdleTimeoutMs(undefined, "false")).toBe(0);
  });
});

describe("guardStream", () => {
  it("ends a silent stream with a timeout error and does not abort", async () => {
    const inner = new Controllable();
    const events: AssistantMessageEvent[] = [];
    const stream = guardStream(inner, model, 180_000, {
      sleep: immediateSleep(),
      onTimeout: () => {
        throw new Error("toast failed");
      },
    });
    for await (const event of stream) events.push(event);
    const final = await stream.result();

    expect(inner.aborted).toBe(false);
    expect(events.map((event) => event.type)).toEqual(["error"]);
    expect(final.stopReason).toBe("error");
    expect(final.errorMessage).toContain("timeout");
    expect(final.errorMessage).not.toContain("toast failed");
    expect(final.errorMessage).toContain("grok-cli/grok-4.7");
  });

  it("resets the silence timer when an event arrives and keeps partial text", async () => {
    const inner = new Controllable();
    const clock = heldSleep();
    const partial = assistant("partial");
    const stream = guardStream(inner, model, 180_000, { sleep: clock.sleep });

    await flush();
    expect(clock.pending()).toBe(1);
    inner.push({ type: "start", partial });
    await flush();
    expect(clock.cancelled()).toBe(1);
    expect(clock.pending()).toBe(1);

    clock.release();
    const final = await stream.result();
    expect(final.stopReason).toBe("error");
    expect(final.errorMessage).toContain("timeout");
    expect(final.content).toEqual(partial.content);
  });

  it("forwards a stream that finishes", async () => {
    const inner = new Controllable();
    const done = assistant("done");
    done.stopReason = "stop";
    inner.push({ type: "done", reason: "stop", message: done });
    const stream = guardStream(inner, model, 180_000, {
      sleep: neverSleep(),
    });
    const events: AssistantMessageEvent[] = [];
    for await (const event of stream) events.push(event);
    expect(events.map((event) => event.type)).toEqual(["done"]);
    expect(await stream.result()).toEqual(done);
  });

  it("toasts when result() hangs after the iterator finishes", async () => {
    const inner = new Controllable();
    const clock = heldSleep();
    const notes: string[] = [];
    const stream = guardStream(inner, model, 180_000, {
      sleep: clock.sleep,
      onTimeout: (message) => notes.push(message),
    });
    await flush();
    inner.finish();
    await flush();
    expect(notes).toEqual([]);
    expect(clock.pending()).toBe(1);
    clock.release();
    const final = await stream.result();
    expect(notes).toEqual([final.errorMessage]);
    expect(final.errorMessage).toContain("timeout");
  });
});

describe("wrapProvider", () => {
  it("wraps streamSimple once and leaves the caller signal alone", async () => {
    const inner = new Controllable();
    const seen: unknown[] = [];
    const provider = {
      streamSimple(modelArg: GuardModel, _context: unknown, options?: unknown) {
        seen.push(modelArg, options);
        return inner;
      },
    };
    const controller = new AbortController();
    wrapProvider(provider, 50);
    wrapProvider(provider, 50);
    expect(WRAPPED in provider.streamSimple).toBe(true);

    const stream = provider.streamSimple(model, {}, { signal: controller.signal });
    const final = await stream.result();
    expect(controller.signal.aborted).toBe(false);
    expect(seen[1]).toEqual({ signal: controller.signal });
    expect(final.stopReason).toBe("error");
    expect(final.errorMessage).toContain("timeout");
  });

  it("does not wrap when disabled", () => {
    const original = () => undefined;
    const provider = { streamSimple: original };
    wrapProvider(provider, 0);
    expect(provider.streamSimple).toBe(original);
  });

  it("wraps every provider the registry can see", () => {
    const grok = { streamSimple: () => undefined };
    const other = { stream: () => undefined };
    wrapRegistry(
      {
        getAll: () => [{ provider: "grok-cli" }],
        getRegisteredProviderIds: () => ["other"],
        getProvider: (id) => (id === "grok-cli" ? grok : other),
      },
      1000,
    );
    expect(WRAPPED in grok.streamSimple).toBe(true);
    expect(WRAPPED in other.stream).toBe(true);
  });
});
