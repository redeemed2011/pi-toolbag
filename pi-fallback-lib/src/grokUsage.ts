import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { UsageGate } from "./types.js";
import { httpsUrl, readJsonNumber, reportedUsage } from "./usage.js";

const DEFAULT_BASE = "https://cli-chat-proxy.grok.com/v1";
const CACHE_FRESH_MS = 30 * 60_000;
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
  return join(env.HOME || home, ".pi", "grok-cli");
}

type Credential = {
  access: string;
  expires: number;
  baseUrl?: string;
};

type VaultAccount = { id: string; credential?: Credential };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCredential(value: unknown): Credential | undefined {
  if (!isObject(value)) return undefined;
  if (typeof value.access !== "string" || !value.access) return undefined;
  if (typeof value.expires !== "number" || !Number.isFinite(value.expires)) return undefined;
  if (value.baseUrl !== undefined && typeof value.baseUrl !== "string") return undefined;
  return {
    access: value.access,
    expires: value.expires,
    ...(typeof value.baseUrl === "string" ? { baseUrl: value.baseUrl } : {}),
  };
}

export function readVaultAccounts(path: string): { activeAccountId?: string; accounts: VaultAccount[] } | undefined {
  if (!existsSync(path)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
  if (!isObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.accounts)) return undefined;
  const accounts: VaultAccount[] = [];
  for (const item of parsed.accounts) {
    if (!isObject(item) || typeof item.id !== "string" || !item.id) continue;
    const credential = parseCredential(item.credential);
    accounts.push({ id: item.id, ...(credential ? { credential } : {}) });
  }
  const active = typeof parsed.activeAccountId === "string" ? parsed.activeAccountId : undefined;
  return { ...(active ? { activeAccountId: active } : {}), accounts };
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
  if (!isObject(parsed) || !isObject(parsed.accounts)) return undefined;
  const entry = parsed.accounts[accountId];
  if (!isObject(entry) || typeof entry.updatedAt !== "string") return undefined;
  const updated = Date.parse(entry.updatedAt);
  if (!Number.isFinite(updated) || now - updated > CACHE_FRESH_MS || updated > now + 60_000) return undefined;
  if (!isObject(entry.weekly) || typeof entry.weekly.creditUsagePercent !== "number") return undefined;
  if (typeof entry.weekly.billingPeriodEnd !== "string") return undefined;
  const end = Date.parse(entry.weekly.billingPeriodEnd);
  if (!Number.isFinite(end) || end <= now) return undefined;
  return entry.weekly.creditUsagePercent;
}

function baseUrl(env: NodeJS.ProcessEnv, credential?: Credential): string | undefined {
  const raw = credential?.baseUrl || env.PI_GROK_CLI_BASE_URL || env.GROK_CLI_BASE_URL || DEFAULT_BASE;
  const url = httpsUrl(raw.endsWith("/v1") || raw.includes("://") ? raw.replace(/\/+$/, "") : raw);
  if (!url) return undefined;
  return raw.replace(/\/+$/, "");
}

function selectAccount(
  vault: { activeAccountId?: string; accounts: VaultAccount[] },
  sessionAccountId: string | undefined,
): { account: VaultAccount; reason?: string } | { account?: undefined; reason: string } {
  if (sessionAccountId) {
    const selected = vault.accounts.find((account) => account.id === sessionAccountId);
    if (!selected?.credential) return { reason: "no-token" };
    return { account: selected };
  }
  const active = vault.accounts.find(
    (account) => account.id === vault.activeAccountId && account.credential,
  );
  const first = vault.accounts.find((account) => account.credential);
  const account = active ?? first;
  if (!account) return { reason: "no-token" };
  return { account };
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
  const headers: Record<string, string> = { accept: "application/json" };
  if (gate.source.auth === "bearer-env") {
    const name = gate.source.env;
    const token = name ? env[name] : undefined;
    if (!name || !token) return { ok: false, reason: "no-token" };
    headers.authorization = `Bearer ${token}`;
  }
  return fetchNumber(url.toString(), headers, gate, fetchImpl, cache, ttl, now, url.toString());
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
  const vaultPath = input.vaultPath ?? join(dir, "accounts.json");
  const cachePath = input.cachePath ?? join(dir, "quota-cache.json");

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
    if (live.ok) return live;
    const cached = freshWeeklyPercent(cachePath, "account-1", now);
    if (cached !== undefined && reportedUsage(input.gate.metric, cached) !== undefined) {
      return { ok: true, value: cached };
    }
    return live;
  }

  const vault = readVaultAccounts(vaultPath);
  if (!vault) return { ok: false, reason: "no-token" };
  const selected = selectAccount(vault, input.sessionAccountId);
  if (!selected.account?.credential) return { ok: false, reason: selected.reason ?? "no-token" };
  const credential = selected.account.credential;
  const cached = () => freshWeeklyPercent(cachePath, selected.account.id, now);

  if (credential.expires <= now) {
    const stale = cached();
    if (stale !== undefined) return { ok: true, value: stale };
    return { ok: false, reason: "token-expired" };
  }

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
  if (live.ok) return live;
  const fallback = cached();
  if (fallback !== undefined) return { ok: true, value: fallback };
  return live;
}

function grokHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "x-xai-token-auth": "xai-grok-cli",
    accept: "application/json",
  };
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
  const path = gate.source.kind === "http" ? gate.source.path : "config.creditUsagePercent";
  const hit = cache.get(`${cacheKey}:${path}`);
  if (hit && ttl > 0 && now - hit.at < ttl) return { ok: true, value: hit.value };

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
