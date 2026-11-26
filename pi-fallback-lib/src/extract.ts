import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FailoverError } from "./types.js";

const kernelBin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fallback-kernel/kernel");

type BranchEntry = {
  type?: string;
  message?: {
    role?: string;
    stopReason?: string;
    errorMessage?: string;
    rawStopReason?: string;
    provider?: string;
    model?: string;
  };
};

/** Last assistant on the branch. Never fills `status`. Copies `rawStopReason` when the message has one. */
export function extractLastAssistantError(
  branch: ReadonlyArray<BranchEntry>,
): FailoverError | undefined {
  const child = spawnSync(kernelBin, ["extract"], { input: JSON.stringify(branch), encoding: "utf8" });
  if (child.status !== 0) throw new Error(child.stderr || "fallback-kernel failed");
  const parsed = JSON.parse(child.stdout) as FailoverError | null;
  return parsed ?? undefined;
}
