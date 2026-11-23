import type { ExtensionAPI, ExtensionContext, SessionBoundaryDraft } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { bridgeBinary, runner, send, type Runner, type SendParams } from "./src/bridge.js";
import { Listener, type Incoming } from "./src/listener.js";

export const CUSTOM_TYPE = "engineering-lead";
const POLL_MS = Number(process.env.PI_ENGINEERING_LEAD_POLL_MS) || 3000;
const MISSING = "The dev-agent-bridge program is not installed (~/.cargo/bin/dev-agent-bridge, or DEV_AGENT_BRIDGE_BIN). Nothing was sent.";

/** One session message for every Engineering Lead message taken together, so none waits behind another in memory. */
export function framed(messages: Incoming[]): { customType: string; content: string; display: true; details: unknown } {
  return {
    customType: CUSTOM_TYPE,
    content: messages.map((message) => message.text).join("\n\n"),
    display: true,
    details: { id: messages[0]?.id, ids: messages.map((message) => message.id), messages: messages.map(({ id, kind, topic }) => ({ id, kind, topic })) },
  };
}

/** Hand Engineering Lead messages to an idle session: they start a turn. It never touches the editor. */
export function deliver(pi: ExtensionAPI, messages: Incoming[]): void {
  if (messages.length === 0) return;
  pi.sendMessage(framed(messages), { deliverAs: "followUp", triggerTurn: true });
}

type TurnEnd = {
  entries: SessionBoundaryDraft[];
  toolResults: unknown[];
  message: { role?: string; stopReason?: string };
};

/** A turn whose assistant finished with no tool call has done its work; anything else is still working or was cut off. */
export function workDone(event: TurnEnd): boolean {
  return event.toolResults.length === 0 && event.message.role === "assistant" && event.message.stopReason === "stop";
}

export default function engineeringLead(pi: ExtensionAPI): void {
  let listener: Listener | undefined;
  let live: ExtensionContext | undefined;
  let run: Runner | undefined;
  const binary = () => {
    const path = bridgeBinary();
    return path ? (run ??= runner(path)) : undefined;
  };

  const startListening = (ctx: ExtensionContext) => {
    const bridge = binary();
    live = ctx;
    if (!bridge || !ctx.hasUI || listener) return;
    listener = new Listener(bridge, ctx.sessionManager.getSessionId(), ctx.cwd, {
      deliver: (messages) => deliver(pi, messages),
      warn: (text) => ctx.ui.notify(text, "warning"),
      ready: () => {
        const now = live ?? ctx;
        return now.isIdle() && !now.hasPendingMessages();
      },
    });
    listener.start(POLL_MS);
  };

  pi.on("session_start", (_event, ctx) => startListening(ctx));
  // A message waits in the inbox while the agent works. When a turn ends with its work done, it joins
  // the session as an entry written at that boundary, and the agent continues on it.
  pi.on("turn_end", async (event, ctx) => {
    live = ctx;
    const turn = event as unknown as TurnEnd;
    if (!listener || !workDone(turn)) return;
    const messages = await listener.take();
    if (messages.length === 0) return;
    return { entries: [...turn.entries, { type: "custom_message", ...framed(messages) }], continue: true };
  });

  pi.on("session_shutdown", async () => {
    const stopping = listener;
    listener = undefined;
    await stopping?.stop();
  });

  pi.registerCommand("engineering-lead", {
    description: "Engineering Lead messages: listen (receive them in this session) | release | status",
    handler: async (args: string, ctx: ExtensionContext) => {
      const bridge = binary();
      if (!bridge) return ctx.ui.notify(MISSING, "error");
      const action = (args ?? "").trim() || "status";
      const session = ctx.sessionManager.getSessionId();
      const argv =
        action === "listen" ? ["listen", "--session", session, "--cwd", ctx.cwd]
        : action === "release" ? ["release", "--session", session]
        : action === "status" ? ["status"]
        : undefined;
      if (!argv) return ctx.ui.notify("Use /engineering-lead listen, release, or status.", "warning");
      const result = await bridge(argv);
      ctx.ui.notify((result.code === 0 ? result.stdout : result.stderr).trim(), result.code === 0 ? "info" : "error");
      if (action === "listen") startListening(ctx);
    },
  });

  pi.registerTool({
    name: "engineering_lead_send",
    label: "Engineering Lead send",
    description:
      "Send one message to Engineering Lead (Sam's Grok Bot on bb-file) through its webhook. kind ask gets exactly one reply; reply answers an ask and needs reply_to; note gets no answer. No acknowledgements, no secrets. At most 20 per hour.",
    promptSnippet: "Message Engineering Lead (bb-file's Grok Bot): ask, reply, or note",
    promptGuidelines: [
      "Use engineering_lead_send to message Engineering Lead directly instead of asking Sam to relay. Answer an Engineering Lead ask once, with kind reply and its id as reply_to. Do not send acknowledgements.",
    ],
    parameters: Type.Object({
      kind: StringEnum(["ask", "reply", "note"] as const),
      topic: Type.String({ description: "One line, one per piece of work, such as brazos-test-hang." }),
      body: Type.String({ description: "Plain text, at most 8000 bytes." }),
      reply_to: Type.Optional(Type.String({ description: "The ask's id. Only for kind reply." })),
      ctx: Type.Optional(Type.Array(Type.String(), { description: "ctx record ids." })),
      commit: Type.Optional(Type.String()),
      file: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      const bridge = binary();
      if (!bridge) throw new Error(MISSING);
      const text = await send(bridge, params as SendParams);
      return { content: [{ type: "text", text }], details: {} };
    },
  });
}
