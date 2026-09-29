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

export interface IdleWait {
  promise: Promise<void>;
  cancel: () => void;
}

export type Sleeper = (ms: number) => IdleWait;

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
}

const defaultSleep: Sleeper = (ms) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timer = undefined;
      resolve();
    }, ms);
  });
  return {
    promise,
    cancel: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

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


async function raceIdle<T>(
  pending: Promise<T>,
  idleMs: number,
  sleep: Sleeper,
): Promise<{ kind: "timeout" } | { kind: "value"; value: T } | { kind: "error"; error: unknown }> {
  const idle = sleep(idleMs);
  const settled = pending.then(
    (value) => ({ kind: "value" as const, value }),
    (error: unknown) => ({ kind: "error" as const, error }),
  );
  const winner = await Promise.race([
    idle.promise.then(() => ({ kind: "timeout" as const })),
    settled,
  ]);
  if (winner.kind === "timeout") {
    abandon(settled);
    return winner;
  }
  idle.cancel();
  return winner;
}

function notifyTimeout(onTimeout: ((message: string) => void) | undefined, text: string): void {
  try {
    onTimeout?.(text);
  } catch {
    // A toast failure must not replace the timeout the agent is awaiting.
  }
}

function endTimeout(
  outer: AssistantMessageEventStream,
  onTimeout: ((message: string) => void) | undefined,
  model: GuardModel,
  partial: AssistantMessage | undefined,
  idleMs: number,
): void {
  const message = timeoutMessage(model, partial, idleMs);
  fail(outer, message);
  notifyTimeout(onTimeout, message.errorMessage ?? timeoutText(model, idleMs));
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
      const raced = await raceIdle(pending, idleMs, sleep);
      if (raced.kind === "timeout") {
        endTimeout(outer, onTimeout, model, partial, idleMs);
        return;
      }
      if (raced.kind === "error") {
        fail(outer, errorMessage(model, partial, raced.error));
        return;
      }
      if (raced.value.done) {
        const finished = await finishResult(inner, partial, model, idleMs, sleep);
        if (finished.timedOut) endTimeout(outer, onTimeout, model, partial, idleMs);
        else if (finished.message.stopReason === "error") fail(outer, finished.message);
        else outer.end(finished.message);
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
): Promise<{ message: AssistantMessage; timedOut: boolean }> {
  if (!inner.result) return { message: partial ?? timeoutMessage(model, undefined, idleMs), timedOut: false };
  const raced = await raceIdle(inner.result(), idleMs, sleep);
  if (raced.kind === "timeout") return { message: timeoutMessage(model, partial, idleMs), timedOut: true };
  if (raced.kind === "error") return { message: errorMessage(model, partial, raced.error), timedOut: false };
  return { message: raced.value, timedOut: false };
}
