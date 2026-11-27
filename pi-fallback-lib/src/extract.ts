import { runKernel } from "./kernelBin.js";
import type { FailoverError } from "./types.js";

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
  const parsed = JSON.parse(runKernel("extract", branch)) as FailoverError | null;
  return parsed ?? undefined;
}
