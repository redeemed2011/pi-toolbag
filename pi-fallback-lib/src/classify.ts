import type { ErrorClass, FailoverError } from "./types.js";

const AUTH_NEEDLES = ["invalid api key", "authentication", "unauthorized", "forbidden"];
const INVALID_MODEL_NEEDLES = ["invalid model", "model not found"];
const OVERFLOW_NEEDLES = [
  "context_length_exceeded",
  "context window",
  "maximum context length",
  "prompt too long",
  "request_too_large",
  "exceeds context window",
  "maximum prompt length",
  "model_context_window_exceeded",
];
const QUOTA_NEEDLES = [
  "usage balance exhausted",
  "balance exhausted",
  "insufficient_quota",
  "quota exceeded",
  "out of budget",
  "quota",
  "available credits",
  "spending limit",
  "monthly spending",
  "billing",
];
const TRANSIENT_NEEDLES = [
  "timeout",
  "timed out",
  "origin_response_timeout",
  "rate limit",
  "too many requests",
  "overloaded",
  "unavailable",
  "resource_exhausted",
  "econnreset",
  "econnrefused",
  "etimedout",
  "socket hang up",
  "fetch failed",
  "connection reset",
  "connection refused",
];

const LABELED_STATUS = /(?:status|http|error(?:\s+code)?|code)\s*[:=]?\s*([45]\d{2})\b/gi;
const BARE_STATUS = /\b([45]\d{2})\b/g;
const QUOTA_402 = /\b402\b/i;
const TRANSIENT_STATUSES = new Set([408, 409, 425, 429]);


const SAFETY_STOPS = new Set([
  "refusal",
  "sensitive",
  "content_filtered",
  "guardrail_intervened",
  "content_filter",
  "incomplete.content_filter",
  "SAFETY",
  "PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
  "RECITATION",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
  "IMAGE_RECITATION",
]);

const SAFETY_PHRASES = [
  "Output blocked by content filtering policy",
  "The request was rejected due to inappropriate content",
  "guardrail_blocked",
];
function includesAny(text: string, needles: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return needles.some((needle) => lower.includes(needle.toLowerCase()));
}

/** Pull 4xx/5xx out of error text. Prefer labeled forms over a bare number. */
export function parseStatusFromText(text: string): number | undefined {
  LABELED_STATUS.lastIndex = 0;
  const labeled = LABELED_STATUS.exec(text);
  if (labeled?.[1]) return Number(labeled[1]);
  BARE_STATUS.lastIndex = 0;
  const bare = BARE_STATUS.exec(text);
  if (bare?.[1]) return Number(bare[1]);
  return undefined;
}

export function classifyError(error: FailoverError): ErrorClass {
  if (error.stopReason === "aborted") return "aborted";
  if (error.stopReason !== undefined && error.stopReason !== "error") return "other";

  if (error.rawStopReason !== undefined && SAFETY_STOPS.has(error.rawStopReason)) {
    if (error.rawStopReason === "refusal" && error.category === "reasoning_extraction") return "other";
    return "safety";
  }

  const text = error.text ?? "";
  const status = error.status ?? parseStatusFromText(text);
  if (!text.trim() && status === undefined) return "other";

  // 401 is always auth. 403 is not: OpenAI-compatible providers (including xAI)
  // report billing/credits as HTTP 403. Only treat 403 as auth when the body
  // matches auth needles (forbidden, unauthorized, invalid api key, …).
  if (status === 401 || includesAny(text, AUTH_NEEDLES)) return "auth";
  if (status === 404 || includesAny(text, INVALID_MODEL_NEEDLES)) return "invalid-model";
  if (includesAny(text, OVERFLOW_NEEDLES)) return "overflow";
  if (status === 402 || QUOTA_402.test(text) || includesAny(text, QUOTA_NEEDLES)) return "quota";
  if (
    (status !== undefined && TRANSIENT_STATUSES.has(status)) ||
    (status !== undefined && status >= 500 && status <= 599) ||
    includesAny(text, TRANSIENT_NEEDLES)
  ) {
    return "transient";
  }
  if (SAFETY_PHRASES.some((phrase) => text.includes(phrase))) return "safety";
  return "other";
}

export function isFailoverWorthy(c: ErrorClass): c is "quota" | "transient" | "safety" {
  return c === "quota" || c === "transient" || c === "safety";
}

export function isQuotaError(c: ErrorClass): c is "quota" {
  return c === "quota";
}
