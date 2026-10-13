import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { attachFallback, type FallbackCtx, type FallbackEvent } from "pi-fallback-lib";

const CHILD_EXTENSION_ID = "pi-auto-fallback";

type RequiredChildApi = {
  registerRequiredChildExtensions(input: {
    sessionId: string;
    extensions: readonly { id: string; path: string }[];
  }): { dispose(): void };
};

function extensionSourcePath(): string {
  return fileURLToPath(import.meta.url);
}

function alreadyRegistered(error: unknown): boolean {
  return error instanceof Error && error.message.includes("already registered");
}

let requiredChildApi: Promise<RequiredChildApi | undefined> | undefined;

function loadRequiredChildApi(): Promise<RequiredChildApi | undefined> {
  if (requiredChildApi) return requiredChildApi;
  requiredChildApi = importRequiredChildApi().catch(() => {
    requiredChildApi = undefined;
    return undefined;
  });
  return requiredChildApi;
}

async function importRequiredChildApi(): Promise<RequiredChildApi | undefined> {
  const packageJson = join(getAgentDir(), "npm", "node_modules", "pi-subagents", "package.json");
  if (!existsSync(packageJson)) return undefined;
  const resolved = createRequire(packageJson).resolve("pi-subagents/required-child-extensions");
  return (await import(pathToFileURL(resolved).href)) as RequiredChildApi;
}

function bindChildExtensions(pi: ExtensionAPI): void {
  let registration: { dispose(): void } | undefined;
  let boundSessionId: string | undefined;
  let warned = false;

  const warn = (ctx: ExtensionContext, message: string): void => {
    if (warned || !ctx.hasUI) return;
    warned = true;
    ctx.ui.notify(message, "warning");
  };

  const clear = (): void => {
    registration?.dispose();
    registration = undefined;
    boundSessionId = undefined;
  };

  pi.on("session_shutdown", () => {
    clear();
  });

  pi.on("session_start", async (_event, ctx) => {
    try {
      const sessionId = ctx.sessionManager.getSessionId();
      if (registration && boundSessionId === sessionId) return;
      if (!sessionId) return;
      const api = await loadRequiredChildApi();
      if (!api) return;
      if (boundSessionId !== sessionId) clear();
      // Native Pi children only. requireForAllRunners would refuse external runners.
      registration = api.registerRequiredChildExtensions({
        sessionId,
        extensions: [{ id: CHILD_EXTENSION_ID, path: extensionSourcePath() }],
      });
      boundSessionId = sessionId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (alreadyRegistered(error)) {
        warn(
          ctx,
          "pi-auto-fallback: child sessions will not fail over; another extension already registered required child extensions",
        );
        return;
      }
      clear();
      warn(ctx, `pi-auto-fallback: child sessions will not fail over; ${message}`);
    }
  });
}

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
    retryAfterTools: true,
    configPath: join(getAgentDir(), "auto-fallback.json"),
    onEvent: notifyFallback,
  });
  bindChildExtensions(pi);
}
