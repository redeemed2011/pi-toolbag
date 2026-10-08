import type { FailoverError } from "./types.js";

type BranchEntry = {
  type?: string;
  message?: {
    role?: string;
    stopReason?: string;
    errorMessage?: string;
    rawStopReason?: string;
  };
};

/**
 * Last assistant on the branch. Never fills `status`. Copies `rawStopReason`
 * when the message has one.
 */
export function extractLastAssistantError(
  branch: ReadonlyArray<BranchEntry>,
): FailoverError | undefined {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry?.type !== "message") continue;
    const msg = entry.message;
    if (msg?.role !== "assistant") continue;
    if (msg.stopReason === "aborted") {
      return { text: msg.errorMessage ?? "", stopReason: "aborted" };
    }
    if (msg.stopReason !== "error") return undefined;
    const rawStopReason = typeof msg.rawStopReason === "string" && msg.rawStopReason ? msg.rawStopReason : undefined;
    return {
      text: msg.errorMessage ?? "",
      stopReason: "error",
      ...(rawStopReason ? { rawStopReason } : {}),
    };
  }
  return undefined;
}
