const AUTH = ["invalid api key", "authentication", "unauthorized", "forbidden"];
const INVALID = ["invalid model", "model not found"];
const OVERFLOW = ["context_length_exceeded", "context window", "maximum context length", "prompt too long", "request_too_large", "exceeds context window", "maximum prompt length", "model_context_window_exceeded"];
const QUOTA = ["usage balance exhausted", "balance exhausted", "insufficient_quota", "quota exceeded", "out of budget", "quota", "available credits", "spending limit", "monthly spending", "billing"];
const TRANSIENT = ["timeout", "timed out", "origin_response_timeout", "rate limit", "too many requests", "overloaded", "unavailable", "resource_exhausted", "econnreset", "econnrefused", "etimedout", "socket hang up", "fetch failed", "connection reset", "connection refused", "server_busy", "servers are currently busy", "currently experiencing high demand", "at capacity", "provider returned an error", "provider returned error", "server error"];
const LABELED = /(?:status|http|error(?:\s+code)?|code)\s*[:=]?\s*([45]\d{2})\b/gi;
const BARE = /\b([45]\d{2})\b/g;
const QUOTA_402 = /\b402\b/i;
const TRANSIENT_STATUSES = new Set([408, 409, 425, 429]);
const SAFETY = new Set(["refusal", "sensitive", "content_filtered", "guardrail_intervened", "content_filter", "incomplete.content_filter", "SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT", "IMAGE_RECITATION"]);
const PHRASES = ["Output blocked by content filtering policy", "The request was rejected due to inappropriate content", "guardrail_blocked"];
const includesAny = (text, needles) => needles.some((needle) => text.toLowerCase().includes(needle.toLowerCase()));
function parseStatus(text) {
  LABELED.lastIndex = 0;
  const labeled = LABELED.exec(text);
  if (labeled?.[1]) return Number(labeled[1]);
  BARE.lastIndex = 0;
  const bare = BARE.exec(text);
  if (bare?.[1]) return Number(bare[1]);
  return undefined;
}
export function classifyError(error) {
  if (error.stopReason === "aborted") return "aborted";
  if (error.stopReason !== undefined && error.stopReason !== "error") return "other";
  if (error.rawStopReason !== undefined && SAFETY.has(error.rawStopReason)) {
    if (error.rawStopReason === "refusal" && error.category === "reasoning_extraction") return "other";
    return "safety";
  }
  const text = error.text ?? "";
  const status = error.status ?? parseStatus(text);
  if (!text.trim() && status === undefined) return "other";
  if (status === 401 || includesAny(text, AUTH)) return "auth";
  if (status === 404 || includesAny(text, INVALID)) return "invalid-model";
  if (includesAny(text, OVERFLOW)) return "overflow";
  if (status === 402 || QUOTA_402.test(text) || includesAny(text, QUOTA)) return "quota";
  if ((status !== undefined && TRANSIENT_STATUSES.has(status)) || (status !== undefined && status >= 500 && status <= 599) || includesAny(text, TRANSIENT)) return "transient";
  if (PHRASES.some((phrase) => text.includes(phrase))) return "safety";
  return "other";
}
function worthy(c) { return c === "quota" || c === "transient" || c === "safety"; }
function split(key) { const slash = key.indexOf("/"); return slash > 0 && slash < key.length - 1; }
export function decideFailover(input) {
  const { config, current, error, remainingBudget } = input;
  if (!config.enabled) return { action: "none", reason: "disabled" };
  if (!split(current)) return { action: "none", reason: "invalid-current" };
  if (remainingBudget <= 0) return { action: "none", reason: "budget-exhausted" };
  const classification = classifyError(error);
  if (!worthy(classification)) return { action: "none", reason: "not-failover-worthy", classification };
  const chain = config.chains.find((item) => item.models.includes(current));
  if (!chain) return { action: "none", reason: "not-in-chain", classification };
  const attempted = new Set(input.attempted);
  attempted.add(current);
  const blocked = new Set(input.blocked ?? []);
  for (const key of chain.models) {
    if (!attempted.has(key) && !blocked.has(key)) return { action: "failover", next: key, reason: classification, attempted: [...attempted] };
  }
  return { action: "none", reason: "no-unused-member", classification };
}
const input = JSON.parse(process.argv[2]);
if (process.argv[3] === "classify") process.stdout.write(classifyError(input));
else process.stdout.write(JSON.stringify(decideFailover(input)));
