import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { attachFallback } from "../src/attach.js";
import { classifyError, isFailoverWorthy } from "../src/classify.js";
import { extractLastAssistantError } from "../src/extract.js";
import { decideFailover } from "../src/kernel.js";
import { loadFallbackConfigFile } from "../src/load.js";
import { parseFallbackConfig } from "../src/parse.js";
import type { FallbackConfig, FailoverDecision, FailoverError, ParseResult } from "../src/types.js";
import { Given, Then, When, type World } from "./bdd.js";
import { FakeHost, type ModelStub } from "./fake-host.js";

const LIVE_SHAPE = {
  enabled: true,
  chains: [{ name: "grok", models: ["grok-cli/grok-4.6", "xai/grok-4.6"] }],
  maxFailoversPerRequest: 1,
  requireNoToolCalls: true,
  retryableStatusCodes: [402, 429, 500],
  retryablePatterns: ["timeout", "usage balance exhausted", "402"],
  nonRetryablePatterns: ["invalid api key", "context window"],
  retryInstruction: "continue",
  notify: true,
};

const LIVE_CONFIG: FallbackConfig = {
  enabled: true,
  chains: [{ name: "grok", models: ["grok-cli/grok-4.6", "xai/grok-4.6"] }],
  maxFailoversPerRequest: 1,
};

function parseKeys(raw: string): string[] {
  if (!raw || raw === "none") return [];
  return raw.split(",").map((part) => part.trim()).filter(Boolean);
}

function parseModel(raw: string): ModelStub {
  const slash = raw.indexOf("/");
  return { provider: raw.slice(0, slash), id: raw.slice(slash + 1) };
}

function hostOf(world: World): FakeHost {
  return world.host as FakeHost;
}

function handleOf(world: World): ReturnType<typeof attachFallback> {
  return world.handle as ReturnType<typeof attachFallback>;
}

function errorOf(world: World): FailoverError {
  return world.error as FailoverError;
}

Given("the live-shaped fallback JSON", (world) => {
  world.raw = LIVE_SHAPE;
});

Given(/^the raw config value is the JSON array "(.*)"$/, (world, json) => {
  world.raw = JSON.parse(json);
});

Given(/^the raw config value is the JSON object "(.*)"$/, (world, json) => {
  world.raw = JSON.parse(json.replace(/\\"/g, '"'));
});

Given("a missing config path", (world) => {
  world.configPath = join(tmpdir(), "pi-fallback-missing", "nope.json");
});

Given(/^a config file containing "(.*)"$/, (world, contents) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-fallback-cfg-"));
  const path = join(dir, "auto-fallback.json");
  writeFileSync(path, contents);
  world.configPath = path;
});

When("I parse the config", (world) => {
  world.parse = parseFallbackConfig(world.raw);
});

When("I load the config file", (world) => {
  world.parse = loadFallbackConfigFile(world.configPath as string);
});

Then("parse succeeds", (world) => {
  const parsed = world.parse as ParseResult;
  expect(parsed.ok).toBe(true);
});

Then(/^parse fails with "(.*)"$/, (world, reason) => {
  const parsed = world.parse as ParseResult;
  expect(parsed.ok).toBe(false);
  if (!parsed.ok) expect(parsed.reason).toBe(reason);
});

Then("enabled is true", (world) => {
  const parsed = world.parse as ParseResult;
  expect(parsed.ok && parsed.config.enabled).toBe(true);
});

Then("enabled is false", (world) => {
  const parsed = world.parse as ParseResult;
  expect(parsed.ok && parsed.config.enabled).toBe(false);
});

Then(/^max failovers is (\d+)$/, (world, value) => {
  const parsed = world.parse as ParseResult;
  expect(parsed.ok && parsed.config.maxFailoversPerRequest).toBe(Number(value));
});

Then(/^the chain named "(.*)" has models "(.*)"$/, (world, name, models) => {
  const parsed = world.parse as ParseResult;
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  const chain = parsed.config.chains.find((item) => item.name === name);
  expect(chain?.models).toEqual(parseKeys(models));
});

Given(/^an error with text "(.*)" and stop reason "(.*)"$/, (world, text, stopReason) => {
  world.error = { text, stopReason };
});

Given(/^an error with empty text and status (\d+)$/, (world, status) => {
  world.error = { text: "", status: Number(status), stopReason: "error" };
});

Given(/^an error with text "(.*)" and status (\d+)$/, (world, text, status) => {
  world.error = { text, status: Number(status), stopReason: "error" };
});

Given("an error with empty text and no status", (world) => {
  world.error = { text: "", stopReason: "error" };
});

When("I classify the error", (world) => {
  world.class = classifyError(errorOf(world));
});

Then(/^the class is "(.*)"$/, (world, expected) => {
  expect(world.class).toBe(expected);
});

Then(/^failover worthy is (true|false)$/, (world, value) => {
  expect(isFailoverWorthy(world.class as never)).toBe(value === "true");
});

Given("the live grok chain config with budget 1", (world) => {
  world.config = { ...LIVE_CONFIG, chains: LIVE_CONFIG.chains.map((c) => ({ ...c, models: [...c.models] })) };
});

Given("a disabled fallback config", (world) => {
  world.config = { enabled: false, chains: LIVE_CONFIG.chains, maxFailoversPerRequest: 1 };
});

Given("a three-model chain with budget 2", (world) => {
  world.config = {
    enabled: true,
    maxFailoversPerRequest: 2,
    chains: [{ name: "t", models: ["a/one", "b/two", "c/three"] }],
  };
});

Given("a slash-id chain config", (world) => {
  world.config = {
    enabled: true,
    maxFailoversPerRequest: 1,
    chains: [{ name: "slash", models: ["openrouter/z-ai/glm-5.3", "xai/grok-4.6"] }],
  };
});

Given(/^the current model is "(.*)"$/, (world, key) => {
  world.current = key;
});

Given(/^remaining budget is (\d+)$/, (world, value) => {
  world.budget = Number(value);
});

Given("attempted keys are none", (world) => {
  world.attempted = new Set();
});

Given(/^attempted keys are "(.*)"$/, (world, keys) => {
  world.attempted = new Set(parseKeys(keys));
});

When("I decide failover", (world) => {
  world.decision = decideFailover({
    config: world.config as FallbackConfig,
    current: world.current as string,
    error: errorOf(world),
    attempted: (world.attempted as Set<string>) ?? new Set(),
    remainingBudget: world.budget as number,
  });
});

Then(/^the decision is failover to "(.*)" because "(.*)"$/, (world, next, reason) => {
  const decision = world.decision as FailoverDecision;
  expect(decision).toEqual(expect.objectContaining({ action: "failover", next, reason }));
});

Then(/^the decision is none because "(.*)"$/, (world, reason) => {
  const decision = world.decision as FailoverDecision;
  expect(decision.action).toBe("none");
  if (decision.action === "none") expect(decision.reason).toBe(reason);
});

Given(/^a branch whose last assistant error is "(.*)"$/, (world, text) => {
  world.branch = [{ type: "message", message: { role: "assistant", stopReason: "error", errorMessage: text } }];
});

Given("a branch whose last assistant was aborted", (world) => {
  world.branch = [{ type: "message", message: { role: "assistant", stopReason: "aborted", errorMessage: "nope" } }];
});

Given("a branch whose last assistant completed", (world) => {
  world.branch = [{ type: "message", message: { role: "assistant", stopReason: "stop" } }];
});

When("I extract the last assistant error", (world) => {
  world.extracted = extractLastAssistantError(world.branch as never);
});

Then(/^the extracted text is "(.*)"$/, (world, text) => {
  expect((world.extracted as FailoverError | undefined)?.text).toBe(text);
});

Then("the extracted status is unset", (world) => {
  expect((world.extracted as FailoverError | undefined)?.status).toBeUndefined();
});

Then(/^classifying the extracted error yields "(.*)"$/, (world, expected) => {
  const extracted = world.extracted as FailoverError;
  expect(classifyError(extracted)).toBe(expected);
});

Then(/^the extracted stop reason is "(.*)"$/, (world, reason) => {
  expect((world.extracted as FailoverError | undefined)?.stopReason).toBe(reason);
});

Then("there is no extracted error", (world) => {
  expect(world.extracted).toBeUndefined();
});

Given(/^a fake host on "(.*)" with thinking "(.*)"$/, (world, key, thinking) => {
  const model = parseModel(key);
  const host = new FakeHost(model, thinking);
  host.addModel(model);
  world.host = host;
});

Given(/^the registry includes "(.*)" and "(.*)"$/, (world, a, b) => {
  hostOf(world).addModel(parseModel(a));
  hostOf(world).addModel(parseModel(b));
});

Given(/^a three-model registry "(.*)"$/, (world, keys) => {
  const host = hostOf(world);
  for (const key of parseKeys(keys)) host.addModel(parseModel(key));
});

Given("a three-model grok chain with budget 1", (world) => {
  world.config = {
    enabled: true,
    maxFailoversPerRequest: 1,
    chains: [{ name: "grok", models: ["grok-cli/grok-4.6", "xai/grok-4.6", "openrouter/other"] }],
  };
});

Given("attach with retryAfterTools false", (world) => {
  world.events = [];
  world.handle = attachFallback(hostOf(world), {
    retryAfterTools: false,
    config: world.config as FallbackConfig,
    onEvent: (event) => (world.events as object[]).push(event),
  });
});

Given("attach with retryAfterTools true", (world) => {
  world.events = [];
  world.handle = attachFallback(hostOf(world), {
    retryAfterTools: true,
    config: world.config as FallbackConfig,
    onEvent: (event) => (world.events as object[]).push(event),
  });
});

Given("attach with a missing config file", (world) => {
  world.handle = attachFallback(hostOf(world), {
    retryAfterTools: false,
    configPath: join(tmpdir(), "pi-fallback-nope", "auto-fallback.json"),
  });
});

Given("a session start", async (world) => {
  await hostOf(world).emit("session_start", { reason: "startup" });
});

Given("a tool has started", async (world) => {
  await hostOf(world).emit("tool_execution_start", { toolName: "bash" });
});

Given(/^the last assistant error is "(.*)"$/, (world, text) => {
  hostOf(world).setAssistantError(text);
});
Given("the last assistant was aborted", (world) => {
  hostOf(world).setAssistantError("", "aborted");
});

Given(/^setModel for "(.*)" returns false$/, (world, key) => {
  hostOf(world).setModelMode.set(key, "false");
});

Given(/^setModel for "(.*)" throws$/, (world, key) => {
  hostOf(world).setModelMode.set(key, "throw");
});

Given("setModel re-enters agent_settled", (world) => {
  hostOf(world).emitSettledDuringSetModel = true;
});

Given("sendUserMessage throws", (world) => {
  hostOf(world).throwOnSend = true;
});

When("the agent settles", async (world) => {
  await hostOf(world).emit("agent_settled");
});

When(/^the user selects model "(.*)" with source "(.*)"$/, async (world, key, source) => {
  const model = parseModel(key);
  hostOf(world).model = model;
  await hostOf(world).emit("model_select", { model, source });
});

When(/^a chapter-break compact happens with reason "(.*)"$/, async (world, reason) => {
  await hostOf(world).emit("session_compact", { reason, willRetry: false });
});

When("overflow compact willRetry is true", async (world) => {
  await hostOf(world).emit("session_compact", { reason: "overflow", willRetry: true });
});

When("overflow compact willRetry is false", async (world) => {
  await hostOf(world).emit("session_compact", { reason: "overflow", willRetry: false });
});

Given("the host has UI", (world) => {
  hostOf(world).hasUI = true;
});

Given("the host is not idle", (world) => {
  hostOf(world).idle = false;
});

Given("the host is print mode", (world) => {
  hostOf(world).mode = "print";
});

Then(/^setModel was called with "(.*)"$/, (world, key) => {
  expect(hostOf(world).setModelCalls).toContain(key);
});

Then("setModel was not called", (world) => {
  expect(hostOf(world).setModelCalls).toEqual([]);
});

Then("continue was sent once", (world) => {
  expect(hostOf(world).sent).toEqual(["continue"]);
});

Then("continue was not sent", (world) => {
  expect(hostOf(world).sent).toEqual([]);
});

Then(/^continue count is (\d+)$/, (world, n) => {
  expect(hostOf(world).sent).toHaveLength(Number(n));
});

Then(/^preferred is still "(.*)"$/, (world, key) => {
  expect(handleOf(world).getDebugState().preferred).toBe(key);
});

Then(/^preferred is "(.*)"$/, (world, key) => {
  expect(handleOf(world).getDebugState().preferred).toBe(key);
});

Then(/^thinking was reapplied as "(.*)"$/, (world, level) => {
  expect(hostOf(world).thinkingSets).toContain(level);
});

Then(/^the remaining failover budget is (\d+)$/, (world, n) => {
  expect(handleOf(world).getDebugState().remainingBudget).toBe(Number(n));
});

Then(/^the current model is "(.*)"$/, (world, key) => {
  const host = hostOf(world);
  expect(`${host.model.provider}/${host.model.id}`).toBe(key);
});

Then("toolsThisTurn is false", (world) => {
  expect(handleOf(world).getDebugState().toolsThisTurn).toBe(false);
});

Then(/^a skip event has reason "(.*)" and class "(.*)"$/, (world, reason, classification) => {
  const events = world.events as Array<{ type: string; reason?: string; classification?: string }>;
  expect(events.some((e) => e.type === "skip" && e.reason === reason && e.classification === classification)).toBe(true);
});
Then("a failover event was emitted", (world) => {
  const events = world.events as Array<{ type: string }>;
  expect(events.some((e) => e.type === "failover")).toBe(true);
});
Then("no warning was notified", (world) => {
  expect(hostOf(world).notifies).toEqual([]);
});

Then("the host is idle", (world) => {
  expect(hostOf(world).idle).toBe(true);
});
