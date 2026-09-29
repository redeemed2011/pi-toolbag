import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { attachFallback, type FallbackCtx, type FallbackEvent } from "pi-fallback-lib";

function notifyFallback(event: FallbackEvent, ctx?: FallbackCtx): void {
  if (!ctx?.hasUI || !ctx.ui?.notify) return;
  if (event.type === "failover") {
    ctx.ui.notify(
      `failover ${event.from} -> ${event.to} reason=${event.reason} budget=${event.budget}`,
      "warning",
    );
    return;
  }
  if (event.type === "usage-switch") {
    ctx.ui.notify(
      `usage ${event.metric} ${event.value} >= ${event.threshold} ${event.from} -> ${event.to}`,
      "warning",
    );
    return;
  }
  if (event.type === "usage-return") {
    const detail =
      event.metric !== undefined && event.value !== undefined && event.threshold !== undefined
        ? ` ${event.metric} ${event.value} threshold=${event.threshold}`
        : "";
    ctx.ui.notify(`usage return ${event.from} -> ${event.to}${detail}`, "info");
    return;
  }
  if (
    event.type === "usage-skip" &&
    (event.reason === "unavailable" || event.reason === "no-target" || event.reason === "not-in-chain")
  ) {
    const model = event.model ?? "model";
    const detail = event.detail ? `: ${event.detail}` : "";
    ctx.ui.notify(`usage check ${event.reason} for ${model}${detail}`, "warning");
  }
}


export default function piAutoFallback(pi: ExtensionAPI): void {
  attachFallback(pi, {
    retryAfterTools: false,
    configPath: join(getAgentDir(), "auto-fallback.json"),
    onEvent: notifyFallback,
  });
}
