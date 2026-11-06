import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { attachFallback } from "pi-fallback-lib";

/** Same transient handling as the ctx observer worker. No tools and no ctx writes. */
export default function ctxGoJudgeFallback(pi: ExtensionAPI): void {
  attachFallback(pi, {
    retryAfterTools: true,
    configPath: join(getAgentDir(), "auto-fallback.json"),
    checkUsage: false,
  });
}
