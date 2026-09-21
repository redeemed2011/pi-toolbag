import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { attachFallback, type FallbackCtx, type FallbackEvent } from "pi-fallback-lib";

function notifyFallback(event: FallbackEvent, ctx?: FallbackCtx): void {
  if (event.type !== "failover" || !ctx?.hasUI || !ctx.ui?.notify) return;
  ctx.ui.notify(
    `failover ${event.from} -> ${event.to} reason=${event.reason} budget=${event.budget}`,
    "warning",
  );
}

export default function piAutoFallback(pi: ExtensionAPI): void {
  attachFallback(pi, {
    retryAfterTools: false,
    configPath: join(getAgentDir(), "auto-fallback.json"),
    onEvent: notifyFallback,
  });
}
