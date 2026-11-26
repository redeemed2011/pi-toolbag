import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AssistantMessage, AssistantMessageEvent, AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

const stallBin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../stall-timeout/stall-timeout");

function stallStep(op: "pump" | "finish", payload: Record<string, unknown>): string {
  const child = spawnSync(stallBin, ["step"], {
    input: JSON.stringify({ op, ...payload }),
    encoding: "utf8",
  });
  if (child.status !== 0) throw new Error(child.stderr || "stall-timeout failed");
  return child.stdout.trim();
}

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
  const child = spawnSync(stallBin, ["text"], {
    input: JSON.stringify({ provider: model.provider, id: model.id, idleMs }),
    encoding: "utf8",
  });
  if (child.status !== 0) throw new Error(child.stderr || "stall-timeout failed");
  return child.stdout.trim();
}

export function timeoutMessage(model: GuardModel, partial: AssistantMessage | undefined, idleMs: number): AssistantMessage {
  const child = spawnSync(stallBin, ["message"], {
    input: JSON.stringify({
      api: model.api,
      provider: model.provider,
      id: model.id,
      idleMs,
      partial: partial ?? null,
      timestamp: Date.now(),
    }),
    encoding: "utf8",
  });
  if (child.status !== 0) throw new Error(child.stderr || "stall-timeout failed");
  return JSON.parse(child.stdout) as AssistantMessage;
}

function partialFrom(event: AssistantMessageEvent): AssistantMessage | undefined {
  const child = spawnSync(stallBin, ["partial"], {
    input: JSON.stringify({ event }),
    encoding: "utf8",
  });
  if (child.status !== 0) throw new Error(child.stderr || "stall-timeout failed");
  const text = child.stdout.trim();
  return text === "null" ? undefined : JSON.parse(text) as AssistantMessage;
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
      const event = raced.kind === "value" && !raced.value.done ? raced.value.value : undefined;
      const step = stallStep("pump", {
        kind: raced.kind,
        iteratorDone: raced.kind === "value" && raced.value.done,
        eventType: event?.type ?? "",
      });
      if (step === "timeout") {
        endTimeout(outer, onTimeout, model, partial, idleMs);
        return;
      }
      if (step === "fail-error") {
        fail(outer, errorMessage(model, partial, raced.kind === "error" ? raced.error : undefined));
        return;
      }
      if (step === "finish") {
        const finished = await finishResult(inner, partial, model, idleMs, sleep);
        const done = stallStep("finish", {
          hasResult: true,
          kind: finished.timedOut ? "timeout" : "value",
          stopReason: finished.message.stopReason,
        });
        if (done === "timeout") endTimeout(outer, onTimeout, model, partial, idleMs);
        else if (done === "fail-message") fail(outer, finished.message);
        else outer.end(finished.message);
        return;
      }
      if (!event) return;
      partial = partialFrom(event) ?? partial;
      outer.push(event);
      if (step === "stop") return;
    }
  } catch (error) {
    fail(outer, errorMessage(model, partial, error));
  }
}

function errorMessage(model: GuardModel, partial: AssistantMessage | undefined, error: unknown): AssistantMessage {
  const text = error instanceof Error ? error.message : String(error);
  const child = spawnSync(stallBin, ["failure"], {
    input: JSON.stringify({
      message: partial ?? timeoutMessage(model, undefined, 0),
      text,
      timestamp: Date.now(),
    }),
    encoding: "utf8",
  });
  if (child.status !== 0) throw new Error(child.stderr || "stall-timeout failed");
  return JSON.parse(child.stdout) as AssistantMessage;
}

async function finishResult(
  inner: StreamSource,
  partial: AssistantMessage | undefined,
  model: GuardModel,
  idleMs: number,
  sleep: Sleeper,
): Promise<{ message: AssistantMessage; timedOut: boolean }> {
  if (stallStep("finish", { hasResult: Boolean(inner.result) }) === "missing") {
    return { message: partial ?? timeoutMessage(model, undefined, idleMs), timedOut: false };
  }
  const raced = await raceIdle(inner.result!(), idleMs, sleep);
  const step = stallStep("finish", {
    hasResult: true,
    kind: raced.kind,
    stopReason: raced.kind === "value" ? raced.value.stopReason : "",
  });
  if (step === "timeout") return { message: timeoutMessage(model, partial, idleMs), timedOut: true };
  if (step === "fail-error") return { message: errorMessage(model, partial, raced.kind === "error" ? raced.error : undefined), timedOut: false };
  if (raced.kind !== "value") return { message: timeoutMessage(model, partial, idleMs), timedOut: false };
  return { message: raced.value, timedOut: false };
}
