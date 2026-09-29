import type { AssistantMessage, AssistantMessageEvent, AssistantMessageEventStream, Usage } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

export interface GuardModel {
  api: AssistantMessage["api"];
  provider: AssistantMessage["provider"];
  id: string;
}

export interface StreamSource {
  [Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent>;
  result?: () => Promise<AssistantMessage>;
}

export type Sleeper = (ms: number) => Promise<void>;

export interface GuardOptions {
  sleep?: Sleeper;
  onTimeout?: (message: string) => void;
}

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const defaultSleep: Sleeper = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function timeoutText(model: GuardModel, idleMs: number): string {
  return `Provider stream timeout (${model.provider}/${model.id}): no data for ${idleMs}ms`;
}

export function timeoutMessage(model: GuardModel, partial: AssistantMessage | undefined, idleMs: number): AssistantMessage {
  const errorMessage = timeoutText(model, idleMs);
  if (partial) {
    return { ...partial, stopReason: "error", errorMessage, timestamp: Date.now() };
  }
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: ZERO_USAGE,
    stopReason: "error",
    errorMessage,
    timestamp: Date.now(),
  };
}

function partialFrom(event: AssistantMessageEvent): AssistantMessage | undefined {
  if (event.type === "error") return event.error;
  if (event.type === "done") return event.message;
  if ("partial" in event) return event.partial;
  return undefined;
}

function abandon(pending: Promise<unknown>): void {
  pending.then(
    () => undefined,
    () => undefined,
  );
}

type Raced<T> = { kind: "timeout" } | { kind: "value"; value: IteratorResult<T> } | { kind: "error"; error: unknown };

async function raceNext<T>(pending: Promise<IteratorResult<T>>, idleMs: number, sleep: Sleeper): Promise<Raced<T>> {
  let timedOut = false;
  const timeout = sleep(idleMs).then(() => {
    timedOut = true;
    return "timeout" as const;
  });
  const settled = pending.then(
    (value) => ({ kind: "value" as const, value }),
    (error: unknown) => ({ kind: "error" as const, error }),
  );
  const winner = await Promise.race([timeout, settled]);
  if (winner === "timeout") {
    abandon(settled);
    return { kind: "timeout" };
  }
  if (timedOut) abandon(settled);
  return winner;
}

function fail(outer: AssistantMessageEventStream, message: AssistantMessage): void {
  outer.push({ type: "error", reason: "error", error: message });
  outer.end(message);
}

/**
 * Forward `inner` until it goes silent. On silence, end `outer` with stopReason
 * error and the word timeout in the message. Does not abort the inner read.
 */
export function guardStream(
  inner: StreamSource,
  model: GuardModel,
  idleMs: number,
  options: GuardOptions = {},
): AssistantMessageEventStream {
  const outer = createAssistantMessageEventStream();
  const sleep = options.sleep ?? defaultSleep;
  void pump(inner, outer, model, idleMs, sleep, options.onTimeout);
  return outer;
}

async function pump(
  inner: StreamSource,
  outer: AssistantMessageEventStream,
  model: GuardModel,
  idleMs: number,
  sleep: Sleeper,
  onTimeout: ((message: string) => void) | undefined,
): Promise<void> {
  const iterator = inner[Symbol.asyncIterator]();
  let partial: AssistantMessage | undefined;
  try {
    while (true) {
      const pending = iterator.next();
      const raced = await raceNext(pending, idleMs, sleep);
      if (raced.kind === "timeout") {
        const message = timeoutMessage(model, partial, idleMs);
        onTimeout?.(message.errorMessage ?? timeoutText(model, idleMs));
        fail(outer, message);
        return;
      }
      if (raced.kind === "error") {
        fail(outer, errorMessage(model, partial, raced.error));
        return;
      }
      if (raced.value.done) {
        const final = await finishResult(inner, partial, model, idleMs, sleep);
        if (final.stopReason === "error") fail(outer, final);
        else outer.end(final);
        return;
      }
      const event = raced.value.value;
      partial = partialFrom(event) ?? partial;
      outer.push(event);
      if (event.type === "error" || event.type === "done") return;
    }
  } catch (error) {
    fail(outer, errorMessage(model, partial, error));
  }
}

function errorMessage(model: GuardModel, partial: AssistantMessage | undefined, error: unknown): AssistantMessage {
  const text = error instanceof Error ? error.message : String(error);
  return {
    ...(partial ?? timeoutMessage(model, undefined, 0)),
    stopReason: "error",
    errorMessage: text,
    timestamp: Date.now(),
  };
}

async function finishResult(
  inner: StreamSource,
  partial: AssistantMessage | undefined,
  model: GuardModel,
  idleMs: number,
  sleep: Sleeper,
): Promise<AssistantMessage> {
  if (!inner.result) return partial ?? timeoutMessage(model, undefined, idleMs);
  const pending = inner.result();
  const raced = await Promise.race([
    pending.then(
      (value) => ({ kind: "value" as const, value }),
      (error: unknown) => ({ kind: "error" as const, error }),
    ),
    sleep(idleMs).then(() => ({ kind: "timeout" as const })),
  ]);
  if (raced.kind === "timeout") {
    abandon(pending);
    return timeoutMessage(model, partial, idleMs);
  }
  if (raced.kind === "error") return errorMessage(model, partial, raced.error);
  return raced.value;
}
