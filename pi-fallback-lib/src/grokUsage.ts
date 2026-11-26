import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UsageGate } from "./types.js";
import { httpsUrl, readJsonNumber, reportedUsage } from "./usage.js";

const kernelBin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fallback-kernel/kernel");

function kernel(command: string, payload: unknown): string {
  const child = spawnSync(kernelBin, [command], { input: JSON.stringify(payload), encoding: "utf8" });
  if (child.status !== 0) throw new Error(child.stderr || "fallback-kernel failed");
  return child.stdout.trim();
}

const LIVE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;

export type UsageRead =
  | { ok: true; value: number }
  | { ok: false; reason: string };

export type UsageFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

type CacheEntry = { at: number; value: number };

const liveCache = new Map<string, CacheEntry>();

export function grokCliDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return path.join(env.HOME || home, ".pi", "grok-cli");
}

type Credential = {
  access: string;
  expires: number;
  baseUrl?: string;
};

type VaultAccount = { id: string; credential?: Credential };

export function readVaultAccounts(path: string): { activeAccountId?: string; accounts: VaultAccount[] } | undefined {
  if (!existsSync(path)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
  const text = kernel("vault", parsed);
  return text === "null" ? undefined : JSON.parse(text) as { activeAccountId?: string; accounts: VaultAccount[] };
}

export function freshWeeklyPercent(
  cachePath: string,
  accountId: string,
  now: number,
): number | undefined {
  if (!existsSync(cachePath)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(cachePath, "utf8"));
  } catch {
    return undefined;
  }
  const text = kernel("weekly", { parsed, accountId, now });
  return text === "null" ? undefined : Number(text);
}

function baseUrl(env: NodeJS.ProcessEnv, credential?: Credential): string | undefined {
  const text = kernel("base", {
    credential: credential?.baseUrl ?? "",
    pi: env.PI_GROK_CLI_BASE_URL ?? "",
    grok: env.GROK_CLI_BASE_URL ?? "",
  });
  return text === "null" ? undefined : text;
}

function selectAccount(
  vault: { activeAccountId?: string; accounts: VaultAccount[] },
  sessionAccountId: string | undefined,
): { account: VaultAccount; reason?: string } | { account?: undefined; reason: string } {
  const index = Number(kernel("account", {
    accounts: vault.accounts,
    active: vault.activeAccountId ?? "",
    session: sessionAccountId ?? "",
  }));
  if (index < 0) return { reason: "no-token" };
  return { account: vault.accounts[index] };
}

export async function readGateUsage(input: {
  gate: UsageGate;
  sessionAccountId?: string;
  now?: number;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: UsageFetch;
  vaultPath?: string;
  cachePath?: string;
  cache?: Map<string, CacheEntry>;
  cacheTtlMs?: number;
}): Promise<UsageRead> {
  const env = input.env ?? process.env;
  const now = input.now ?? Date.now();
  const fetchImpl = input.fetchImpl ?? fetch;
  const cache = input.cache ?? liveCache;
  const ttl = input.cacheTtlMs ?? LIVE_TTL_MS;

  if (input.gate.source.kind === "http") {
    return readHttp(input.gate, env, fetchImpl, cache, ttl, now);
  }
  return readGrok(input, env, now, fetchImpl, cache, ttl);
}

async function readHttp(
  gate: UsageGate,
  env: NodeJS.ProcessEnv,
  fetchImpl: UsageFetch,
  cache: Map<string, CacheEntry>,
  ttl: number,
  now: number,
): Promise<UsageRead> {
  if (gate.source.kind !== "http") return { ok: false, reason: "bad-source" };
  const url = httpsUrl(gate.source.url);
  if (!url) return { ok: false, reason: "insecure-url" };
  const name = gate.source.auth === "bearer-env" ? gate.source.env ?? "" : "";
  const built = JSON.parse(kernel("headers", {
    kind: "http",
    auth: gate.source.auth,
    name,
    token: name ? env[name] ?? "" : "",
  })) as { headers: Record<string, string> | null; reason: string };
  if (built.reason) return { ok: false, reason: built.reason };
  return fetchNumber(url.toString(), built.headers ?? {}, gate, fetchImpl, cache, ttl, now, url.toString());
}

async function readGrok(
  input: {
    gate: UsageGate;
    sessionAccountId?: string;
    vaultPath?: string;
    cachePath?: string;
  },
  env: NodeJS.ProcessEnv,
  now: number,
  fetchImpl: UsageFetch,
  cache: Map<string, CacheEntry>,
  ttl: number,
): Promise<UsageRead> {
  const dir = grokCliDir(env);
  const vaultPath = input.vaultPath ?? path.join(dir, "accounts.json");
  const cachePath = input.cachePath ?? path.join(dir, "quota-cache.json");

  if (env.GROK_CLI_OAUTH_TOKEN) {
    const root = baseUrl(env);
    if (!root) return { ok: false, reason: "insecure-url" };
    const live = await fetchNumber(
      `${root}/billing?format=credits`,
      grokHeaders(env.GROK_CLI_OAUTH_TOKEN),
      input.gate,
      fetchImpl,
      cache,
      ttl,
      now,
      `env:${root}`,
    );
    const cached = freshWeeklyPercent(cachePath, "account-1", now);
    if (afterFailedFetch(live.ok, cached, true, input.gate.metric) === "cache") {
      return { ok: true, value: cached as number };
    }
    return live;
  }

  const vault = readVaultAccounts(vaultPath);
  if (!vault) return { ok: false, reason: "no-token" };
  const selected = selectAccount(vault, input.sessionAccountId);
  if (!selected.account?.credential) return { ok: false, reason: selected.reason ?? "no-token" };
  const credential = selected.account.credential;
  const cached = () => freshWeeklyPercent(cachePath, selected.account.id, now);
  const stale = credential.expires <= now ? cached() : undefined;
  const choice = kernel("token", { expires: credential.expires, now, cached: stale !== undefined });
  if (choice === "cache") return { ok: true, value: stale as number };
  if (choice === "token-expired") return { ok: false, reason: "token-expired" };

  const root = baseUrl(env, credential);
  if (!root) return { ok: false, reason: "insecure-url" };
  const live = await fetchNumber(
    `${root}/billing?format=credits`,
    grokHeaders(credential.access),
    input.gate,
    fetchImpl,
    cache,
    ttl,
    now,
    `${selected.account.id}:${root}`,
  );
  const fallback = cached();
  if (afterFailedFetch(live.ok, fallback, false, input.gate.metric) === "cache") {
    return { ok: true, value: fallback as number };
  }
  return live;
}

function afterFailedFetch(
  ok: boolean,
  value: number | undefined,
  requireUsable: boolean,
  metric: UsageGate["metric"],
): string {
  return kernel("after", {
    ok,
    hasValue: value !== undefined,
    requireUsable,
    usable: value !== undefined && reportedUsage(metric, value) !== undefined,
  });
}

function grokHeaders(token: string): Record<string, string> {
  return (JSON.parse(kernel("headers", { kind: "grok", token })) as { headers: Record<string, string> }).headers;
}

async function fetchNumber(
  url: string,
  headers: Record<string, string>,
  gate: UsageGate,
  fetchImpl: UsageFetch,
  cache: Map<string, CacheEntry>,
  ttl: number,
  now: number,
  cacheKey: string,
): Promise<UsageRead> {
  const looked = JSON.parse(kernel("usage", {
    op: "cache",
    kind: gate.source.kind,
    path: gate.source.kind === "http" ? gate.source.path : "",
    cacheKey,
    now,
    ttl,
  })) as { path: string; key: string; fresh: boolean };
  const path = looked.path;
  const cached = cache.get(looked.key);
  const fresh = cached
    ? (JSON.parse(kernel("usage", {
      op: "cache",
      kind: gate.source.kind,
      path: gate.source.kind === "http" ? gate.source.path : "",
      cacheKey,
      at: cached.at,
      now,
      ttl,
    })) as { fresh: boolean }).fresh
    : false;
  if (cached && fresh) return { ok: true, value: cached.value };

  let response: { ok: boolean; status: number; json(): Promise<unknown> };
  try {
    response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    return { ok: false, reason: "fetch-failed" };
  }
  if (!response.ok) return { ok: false, reason: `http-${response.status}` };
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, reason: "bad-payload" };
  }
  const value = readJsonNumber(payload, path);
  if (value === undefined || reportedUsage(gate.metric, value) === undefined) {
    return { ok: false, reason: "bad-payload" };
  }
  cache.set(`${cacheKey}:${path}`, { at: now, value });
  return { ok: true, value };
}
