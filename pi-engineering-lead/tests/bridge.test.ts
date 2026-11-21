import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import engineeringLead, { CUSTOM_TYPE } from "../index.js";
import { bridgeBinary, runner, send, sendArgs } from "../src/bridge.js";
import { Listener, type Incoming } from "../src/listener.js";

const installed = bridgeBinary({}, homedir());
const A = "aaaaaaaa-3899-4f2d-b1d3-f76908734e5b";
const B = "bbbbbbbb-3899-4f2d-b1d3-f76908734e5b";

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "pi-el-"));
  const env = {
    ...process.env,
    DEV_AGENT_BRIDGE_STATE: join(dir, "state"),
    DEV_AGENT_BRIDGE_INBOX: join(dir, "inbox"),
    DEV_AGENT_BRIDGE_LOG: join(dir, "log.jsonl"),
    DEV_AGENT_BRIDGE_SECRETS: join(dir, "missing.json"),
  };
  mkdirSync(join(dir, "inbox"));
  const drop = (id: string, kind: string, body: string) =>
    writeFileSync(
      join(dir, "inbox", `${id}.json`),
      JSON.stringify({ v: 1, id, from: "engineering-lead", to: "dev-agent", topic: "t", kind, reply_to: null, body, refs: {}, sent_at: "2026-11-21T13:20:00-06:00" }),
    );
  return { dir, env, drop };
}

describe.skipIf(!installed)("with the installed dev-agent-bridge", () => {
  it("delivers each inbox message once, only to the session holding the lease", async () => {
    const { env, drop } = sandbox();
    const run = runner(installed!, env);
    const got: Incoming[] = [];
    const warnings: string[] = [];
    const first = new Listener(run, "s1", "/w", { deliver: (m) => got.push(m), warn: (w) => warnings.push(w) });
    const other: Incoming[] = [];
    const second = new Listener(run, "s2", "/x", { deliver: (m) => other.push(m), warn: () => {} });
    drop(A, "ask", "Is the deploy done?");
    expect((await first.poll())?.listener).toBe(true);
    expect((await second.poll())?.listener).toBe(false);
    await first.poll();
    expect(got.map((m) => m.id)).toEqual([A]);
    expect(other).toEqual([]);
    expect(got[0]!.text).toContain("Is the deploy done?");
    expect(got[0]!.text).toContain("engineering_lead_send");
    await first.stop();
    drop(B, "note", "after release");
    const taken = await second.poll();
    expect(taken?.messages.map((m) => m.id)).toEqual([B]);
    expect(other.map((m) => m.id)).toEqual([B]);
    expect(warnings).toEqual([]);
  });

  it("a send that cannot go out explains why and names the next step", async () => {
    const { env } = sandbox();
    await expect(send(runner(installed!, env), { kind: "note", topic: "t", body: "b" })).rejects.toThrow(/secrets file not found[\s\S]*Tell Sam/);
    await expect(send(runner(installed!, env), { kind: "reply", topic: "t", body: "b" })).rejects.toThrow(/reply_to|--reply-to/);
  });

  it("refuses a webhook that is not https before anything is sent", async () => {
    const { dir, env } = sandbox();
    const got: { auth: string; body: string }[] = [];
    const server: Server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        got.push({ auth: String(req.headers.authorization), body: raw });
        res.end("{}");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      // The bridge requires https; an http webhook must be refused before anything is sent.
      const port = (server.address() as { port: number }).port;
      writeFileSync(join(dir, "s.json"), JSON.stringify({ url: `http://127.0.0.1:${port}/hook`, key: "k-9" }));
      await expect(send(runner(installed!, { ...env, DEV_AGENT_BRIDGE_SECRETS: join(dir, "s.json") }), { kind: "note", topic: "t", body: "multi\nline" })).rejects.toThrow(/https/);
      expect(got).toEqual([]);
    } finally {
      server.close();
    }
  });
});

describe("the pi extension", () => {
  afterEach(() => {
    delete process.env.DEV_AGENT_BRIDGE_BIN;
  });

  function fakePi() {
    const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> = {};
    const sent: { message: { customType: string; content: string }; options: unknown }[] = [];
    const tools: Record<string, { execute: (id: string, params: unknown) => Promise<unknown> }> = {};
    const pi = {
      on: (name: string, fn: (event: unknown, ctx: unknown) => unknown) => (handlers[name] = fn),
      registerCommand: () => {},
      registerTool: (tool: { name: string; execute: (id: string, params: unknown) => Promise<unknown> }) => (tools[tool.name] = tool),
      sendMessage: (message: { customType: string; content: string }, options: unknown) => sent.push({ message, options }),
    };
    return { pi, handlers, sent, tools };
  }

  it.skipIf(!installed)("an arriving message goes to sendMessage as a follow-up that may start a turn, and never through the editor", async () => {
    const { dir, env, drop } = sandbox();
    Object.assign(process.env, { ...env, DEV_AGENT_BRIDGE_BIN: installed, PI_ENGINEERING_LEAD_POLL_MS: "50" });
    const { pi, handlers, sent } = fakePi();
    let editorTouched = false;
    const ui = new Proxy({ notify: () => {} } as Record<string, unknown>, {
      get: (target, key) => (key === "notify" ? target.notify : () => (editorTouched = true)),
    });
    engineeringLead(pi as never);
    handlers.session_start!({}, { hasUI: true, cwd: dir, ui, sessionManager: { getSessionId: () => "live" } });
    drop(A, "note", "hello from bb-file");
    for (let i = 0; i < 100 && sent.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
    await handlers.session_shutdown!({}, {});
    expect(sent).toHaveLength(1);
    expect(sent[0]!.message.customType).toBe(CUSTOM_TYPE);
    expect(sent[0]!.message.content).toContain("hello from bb-file");
    expect(sent[0]!.options).toEqual({ deliverAs: "followUp", triggerTurn: true });
    expect(editorTouched).toBe(false);
    expect(existsSync(join(dir, "state", "listener.json"))).toBe(false);
  });

  it("without the program the tool says so and nothing is sent", async () => {
    process.env.DEV_AGENT_BRIDGE_BIN = "/nonexistent/dev-agent-bridge";
    const { pi, tools } = fakePi();
    engineeringLead(pi as never);
    await expect(tools.engineering_lead_send!.execute("1", { kind: "note", topic: "t", body: "b" })).rejects.toThrow(/not installed/);
  });

  it("builds send arguments with the body on stdin, not argv", () => {
    expect(sendArgs({ kind: "reply", topic: "t", body: "secret-free body", reply_to: A, ctx: ["c1", " "], commit: "abc" })).toEqual([
      "send", "--kind", "reply", "--topic", "t", "--body-file", "-", "--reply-to", A, "--ctx", "c1", "--commit", "abc",
    ]);
  });
});
