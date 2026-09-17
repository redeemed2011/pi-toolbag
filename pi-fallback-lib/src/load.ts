import { existsSync, readFileSync } from "node:fs";
import { parseFallbackConfig } from "./parse.js";
import type { ParseResult } from "./types.js";

/** Read and parse a caller-supplied path. Never guesses ~/.pi/agent. */
export function loadFallbackConfigFile(path: string): ParseResult {
  if (!existsSync(path)) return { ok: false, reason: "missing" };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  return parseFallbackConfig(value);
}
