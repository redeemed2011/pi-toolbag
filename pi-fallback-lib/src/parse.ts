import { runKernel } from "./kernelBin.js";
import type { ParseResult } from "./types.js";

/** Parse a JSON value. Extra live keys are ignored. Fail-closed on invalid shape. */
export function parseFallbackConfig(value: unknown): ParseResult {
  return JSON.parse(runKernel("parse", value)) as ParseResult;
}
