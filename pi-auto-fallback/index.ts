import { spawnSync } from "node:child_process";
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

const noticeBin = fileURLToPath(new URL("./notice/notice", import.meta.url));

function notifyFallback(event: FallbackEvent, ctx?: FallbackCtx): void {
  if (!ctx?.hasUI || !ctx.ui?.notify) return;
  const child = spawnSync(noticeBin, [], { input: JSON.stringify(event), encoding: "utf8" });
  if (child.status !== 0) throw new Error(child.stderr || "auto-fallback notice failed");
  const text = child.stdout.trim();
  if (text === "null") return;
  const notice = JSON.parse(text) as { text: string; level: "warning" | "info" };
  ctx.ui.notify(notice.text, notice.level);
}

export default function piAutoFallback(pi: ExtensionAPI): void {
  attachFallback(pi, {
    retryAfterTools: true,
    configPath: join(getAgentDir(), "auto-fallback.json"),
    onEvent: notifyFallback,
  });
  bindChildExtensions(pi);
}
