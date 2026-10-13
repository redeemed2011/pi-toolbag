import { realpathSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import piAutoFallback from "../index.ts";

const packageDir = join(getAgentDir(), "npm", "node_modules", "pi-subagents");
const sharedPath = join(packageDir, "src", "shared", "required-child-extensions.js");

type Entry = { id: string; path: string; requireForAllRunners?: true };
type SharedApi = {
  registerRequiredChildExtensions(input: {
    sessionId: string;
    extensions: readonly { id: string; path: string }[];
  }): { dispose(): void };
  resolveRequiredChildExtensions(sessionId: string | undefined): readonly Entry[];
};

const shared = (await import(pathToFileURL(realpathSync(sharedPath)).href)) as SharedApi;
const extensionPath = realpathSync(fileURLToPath(new URL("../index.ts", import.meta.url)));

type Handler = (event: unknown, ctx: unknown) => unknown;

function host() {
  const handlers = new Map<string, Handler[]>();
  const notes: string[] = [];
  const pi = {
    on(event: string, handler: Handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => undefined;
    },
  };
  return { handlers, notes, pi };
}

function ctx(sessionId: string, notes: string[]) {
  return {
    hasUI: true,
    ui: {
      notify(message: string) {
        notes.push(message);
      },
    },
    sessionManager: {
      getSessionId() {
        return sessionId;
      },
    },
  };
}

async function emit(handlers: Map<string, Handler[]>, event: string, context: unknown): Promise<void> {
  for (const handler of handlers.get(event) ?? []) await handler({ type: event, reason: "startup" }, context);
}

describe("required child extensions", () => {
  let foreign: { dispose(): void } | undefined;
  let open: { handlers: Map<string, Handler[]>; notes: string[]; sessionId: string } | undefined;

  afterEach(async () => {
    if (open) await emit(open.handlers, "session_shutdown", ctx(open.sessionId, open.notes));
    open = undefined;
    foreign?.dispose();
    foreign = undefined;
  });

  it("registers this source file for the session and drops it on shutdown", async () => {
    const sessionId = `auto-fallback-${randomUUID()}`;
    const { handlers, notes, pi } = host();
    open = { handlers, notes, sessionId };
    piAutoFallback(pi as never);
    await emit(handlers, "session_start", ctx(sessionId, notes));
    expect(shared.resolveRequiredChildExtensions(sessionId)).toEqual([
      { id: "pi-auto-fallback", path: extensionPath },
    ]);
    expect(notes).toEqual([]);
    await emit(handlers, "session_start", ctx(sessionId, notes));
    expect(shared.resolveRequiredChildExtensions(sessionId)).toEqual([
      { id: "pi-auto-fallback", path: extensionPath },
    ]);
    await emit(handlers, "session_shutdown", ctx(sessionId, notes));
    expect(shared.resolveRequiredChildExtensions(sessionId)).toEqual([]);
  });

  it("replaces the previous session registration without refusing external runners", async () => {
    const first = `auto-fallback-${randomUUID()}`;
    const second = `auto-fallback-${randomUUID()}`;
    const { handlers, notes, pi } = host();
    open = { handlers, notes, sessionId: second };
    piAutoFallback(pi as never);
    await emit(handlers, "session_start", ctx(first, notes));
    await emit(handlers, "session_start", ctx(second, notes));
    expect(shared.resolveRequiredChildExtensions(first)).toEqual([]);
    const snapshot = shared.resolveRequiredChildExtensions(second);
    expect(snapshot).toEqual([{ id: "pi-auto-fallback", path: extensionPath }]);
    expect(snapshot.some((entry) => entry.requireForAllRunners)).toBe(false);
  });

  it("leaves another session registration in place", async () => {
    const sessionId = `auto-fallback-${randomUUID()}`;
    foreign = shared.registerRequiredChildExtensions({
      sessionId,
      extensions: [{ id: "other-host", path: extensionPath }],
    });
    const { handlers, notes, pi } = host();
    open = { handlers, notes, sessionId };
    piAutoFallback(pi as never);
    await emit(handlers, "session_start", ctx(sessionId, notes));
    expect(shared.resolveRequiredChildExtensions(sessionId)).toEqual([
      { id: "other-host", path: extensionPath },
    ]);
    expect(notes).toEqual([
      "pi-auto-fallback: child sessions will not fail over; another extension already registered required child extensions",
    ]);
    await emit(handlers, "session_start", ctx(sessionId, notes));
    expect(notes).toHaveLength(1);
  });
});
