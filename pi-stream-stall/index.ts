import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseIdleTimeoutMs } from "./src/timeout.js";
import { wrapRegistry } from "./src/wrap.js";

function install(pi: ExtensionAPI, ctx: ExtensionContext): void {
  const idleMs = parseIdleTimeoutMs(pi.getFlag("stream-stall-timeout-ms"), process.env.PI_STREAM_STALL_TIMEOUT_MS);
  wrapRegistry(ctx.modelRegistry, idleMs, {
    onTimeout: (message) => {
      if (ctx.hasUI) ctx.ui.notify(message, "warning");
    },
  });
}

export default function piStreamStall(pi: ExtensionAPI): void {
  pi.registerFlag("stream-stall-timeout-ms", {
    description: "End a silent provider stream after this many milliseconds. 0 disables.",
    type: "string",
  });

  pi.on("session_start", (_event, ctx) => {
    install(pi, ctx);
  });
  pi.on("before_agent_start", (_event, ctx) => {
    install(pi, ctx);
  });
}
