import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ParseResult } from "./types.js";

const kernelBin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fallback-kernel/kernel");

/** Parse a JSON value. Extra live keys are ignored. Fail-closed on invalid shape. */
export function parseFallbackConfig(value: unknown): ParseResult {
  const child = spawnSync(kernelBin, ["parse"], {
    input: JSON.stringify(value === undefined ? null : value),
    encoding: "utf8",
  });
  if (child.status !== 0) throw new Error(child.stderr || "fallback-kernel failed");
  return JSON.parse(child.stdout) as ParseResult;
}
