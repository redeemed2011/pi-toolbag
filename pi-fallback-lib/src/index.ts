export type {
  ModelKey,
  UsageMetric,
  UsageSource,
  UsageGate,
  FallbackChain,
  FallbackConfig,
  FailoverError,
  ErrorClass,
  ParseResult,
  ParseFailReason,
  DecideInput,
  FailoverDecision,
  FallbackEvent,
  AttachOptions,
  AttachHandle,
  FallbackHost,
  FallbackCtx,
} from "./types.js";

export { parseFallbackConfig } from "./parse.js";
export { loadFallbackConfigFile } from "./load.js";
export { classifyError, isFailoverWorthy, isQuotaError, parseStatusFromText } from "./classify.js";
export { decideFailover, findChain, splitModelKey, modelKey } from "./kernel.js";
export { extractLastAssistantError } from "./extract.js";
export { attachFallback, CONTINUE_AFTER_BLOCK, CONTINUE_AFTER_STOP } from "./attach.js";
