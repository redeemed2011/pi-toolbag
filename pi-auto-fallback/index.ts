import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { attachFallback } from "pi-fallback-lib";

export default function piAutoFallback(pi: ExtensionAPI): void {
  attachFallback(pi, {
    retryAfterTools: false,
    configPath: join(getAgentDir(), "auto-fallback.json"),
    log: (line) => console.error(`[pi-fallback] ${line}`),
  });
}
