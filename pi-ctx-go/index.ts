import type { ExtensionAPI, ExtensionContext, SessionBoundaryDraft } from "@earendil-works/pi-coding-agent";
import { approveDestination } from "./src/approve.js";
import { readClock, writeClock } from "./src/clock.js";
import { runJudge, thinkingLevel, type JudgeModel } from "./src/judge.js";
import { buildPacket, parseVerdict, productStamp } from "./src/packet.js";
import { closedQuestions, readSnap, type BoundSnap } from "./src/snap.js";
import {
  freshState,
  onApproved,
  onDraftRejected,
  onGo,
  onJudge,
  onStop,
  onTurn,
  type Action,
  type GoState,
} from "./src/state.js";
import { messageText, twoLines } from "./src/text.js";
import type { Entry } from "../pi-ctx/src/types.js";

type GoCtx = ExtensionContext & {
  waitForIdle?: () => Promise<void>;
  sessionManager: {
    getBranch?: () => Entry[];
    getSessionId?: () => string;
    getSessionFile?: () => string | undefined;
  };
  ui: {
    select(title: string, options: string[]): Promise<string | undefined>;
    notify(message: string, level?: "info" | "warning" | "error"): void;
  };
};

type Continue = {
  entries: SessionBoundaryDraft[];
  continue?: true;
};

const YES = "Approve destination";
const NO = "Ask for another draft";

function branchOf(ctx: GoCtx): { branch: Entry[]; sessionId: string } {
  return {
    branch: ctx.sessionManager.getBranch?.() ?? [],
    sessionId: ctx.sessionManager.getSessionId?.() ?? "",
  };
}

function notify(ctx: GoCtx, actions: Action[]): void {
  for (const action of actions) {
    if (action.type === "notify" && ctx.hasUI) ctx.ui.notify(action.message, action.level);
  }
}

function continued(eventEntries: SessionBoundaryDraft[], actions: Action[]): Continue | undefined {
  const entries = [...eventEntries];
  let prompt = false;
  for (const action of actions) {
    if (action.type !== "prompt" && action.type !== "record") continue;
    entries.push({ type: "custom_message", customType: "ctx-go", content: action.text, display: true });
    if (action.type === "prompt") prompt = true;
  }
  if (entries.length === eventEntries.length) return undefined;
  return prompt ? { entries, continue: true } : { entries };
}

type JudgeOverride = { provider?: string; id?: string; thinking?: JudgeModel["thinking"] };

function modelOf(ctx: GoCtx, override: JudgeOverride | null): JudgeModel | null {
  const provider = override?.provider ?? ctx.model?.provider;
  const id = override?.id ?? ctx.model?.id;
  if (!provider || !id) return null;
  const thinking = override?.thinking ?? ctx.thinkingLevel;
  return thinking ? { provider, id, thinking } : { provider, id };
}

function remember(ctx: GoCtx, next: GoState): GoState {
  const file = ctx.sessionManager.getSessionFile?.();
  if (!file) return next;
  try {
    writeClock(file, next);
  } catch {
    if (ctx.hasUI) ctx.ui.notify("ctx-go could not store its clock", "warning");
  }
  return next;
}

export default function ctxGo(pi: ExtensionAPI): void {
  let state: GoState = freshState();
  let override: JudgeOverride | null = null;

  pi.on("session_start", (_event, ctx) => {
    const goCtx = ctx as GoCtx;
    const file = goCtx.sessionManager.getSessionFile?.();
    state = file ? readClock(file) : freshState();
  });

  pi.registerCommand("ctx-stop", {
    description: "Stop the ctx-go loop. The agent cannot call this.",
    handler: async (_args, ctx) => {
      const goCtx = ctx as GoCtx;
      const step = onStop(state);
      state = remember(goCtx, step.state);
      notify(goCtx, step.actions);
    },
  });

  pi.registerCommand("ctx-judge", {
    description: "Set the judge model: /ctx-judge provider/id [thinking], or /ctx-judge clear",
    handler: async (args, ctx) => {
      const goCtx = ctx as GoCtx;
      const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0 || parts[0] === "clear") {
        override = null;
        if (goCtx.hasUI) goCtx.ui.notify("ctx-judge using the session model", "info");
        return;
      }
      if (parts[0] === "thinking") {
        const level = thinkingLevel(parts[1] ?? "");
        if (!level) {
          if (goCtx.hasUI) goCtx.ui.notify("usage: /ctx-judge thinking <level>", "warning");
          return;
        }
        override = { ...override, thinking: level };
        if (goCtx.hasUI) goCtx.ui.notify(`ctx-judge thinking ${level}`, "info");
        return;
      }
      const spec = parts[0] ?? "";
      const slash = spec.indexOf("/");
      const provider = slash > 0 ? spec.slice(0, slash) : "";
      const id = slash > 0 ? spec.slice(slash + 1) : "";
      const level = parts[1] ? thinkingLevel(parts[1]) : undefined;
      if (!provider || !id || (parts[1] !== undefined && !level)) {
        if (goCtx.hasUI) goCtx.ui.notify("usage: /ctx-judge provider/id [thinking]", "warning");
        return;
      }
      override = level ? { ...override, provider, id, thinking: level } : { ...override, provider, id };
      if (goCtx.hasUI) goCtx.ui.notify(`ctx-judge ${provider}/${id}`, "info");
    },
  });

  pi.registerCommand("ctx-go", {
    description: "Keep working the bound CTX project until the project is done.",
    handler: async (_args, ctx) => {
      const goCtx = ctx as GoCtx;
      if (goCtx.waitForIdle) await goCtx.waitForIdle();
      const snap = readSnap(branchOf(goCtx).branch, branchOf(goCtx).sessionId);
      const step = onGo(state, snap);
      state = remember(goCtx, step.state);
      notify(goCtx, step.actions);
      const next = step.actions.find((action) => action.type === "prompt");
      if (!next || next.type !== "prompt") return;
      pi.sendMessage({ customType: "ctx-go", content: next.text, display: true }, { triggerTurn: true });
    },
  });

  pi.on("turn_end", async (event, ctx) => {
    const goCtx = ctx as GoCtx;
    if (!state.armed) return;
    const { branch, sessionId } = branchOf(goCtx);
    const snap = readSnap(branch, sessionId);
    const step = onTurn(state, snap, {
      outcome: event.outcome,
      toolCount: event.toolResults.length,
      pending: goCtx.hasPendingMessages(),
      text: messageText(event.message),
    });
    state = remember(goCtx, step.state);
    notify(goCtx, step.actions);

    const approve = step.actions.find((action) => action.type === "approve");
    if (approve && approve.type === "approve") {
      if (!goCtx.hasUI || !snap.projectId) {
        if (goCtx.hasUI) goCtx.ui.notify("ctx-go paused: cannot ask for destination approval", "warning");
        return;
      }
      const shown = twoLines(approve.text);
      const picked = await goCtx.ui.select(`Destination:\n${shown}`, [YES, NO]);
      const fresh = readSnap(branchOf(goCtx).branch, sessionId);
      if (picked !== YES) {
        const rejected = onDraftRejected(state, fresh);
        state = remember(goCtx, rejected.state);
        if (goCtx.hasPendingMessages()) return;
        return continued(event.entries, rejected.actions);
      }
      if (!fresh.projectId) {
        if (goCtx.hasUI) goCtx.ui.notify("ctx-go paused: CTX is not bound", "error");
        return;
      }
      const wrote = approveDestination({
        projectId: fresh.projectId,
        sessionId,
        existing: fresh.records,
        draft: shown,
      });
      if (!wrote.ok) {
        if (goCtx.hasUI) goCtx.ui.notify(`ctx-go paused: ${wrote.error}`, "error");
        return;
      }
      const after = readSnap(branchOf(goCtx).branch, sessionId);
      const approved = onApproved(state, after, wrote.id);
      state = remember(goCtx, approved.state);
      if (goCtx.hasPendingMessages()) return;
      return continued(event.entries, approved.actions);
    }

    const judge = step.actions.find((action) => action.type === "judge");
    if (judge && judge.type === "judge") {
      const judged = await judgeNow(goCtx, snap, state, judge.claim, override);
      state = remember(goCtx, judged.state);
      notify(goCtx, judged.actions);
      if (goCtx.hasPendingMessages()) return;
      return continued(event.entries, judged.actions);
    }

    if (goCtx.hasPendingMessages()) return;
    return continued(event.entries, step.actions);
  });
}

async function judgeNow(ctx: GoCtx, snap: BoundSnap, state: GoState, claim: string, override: JudgeOverride | null) {
  if (!snap.live) return onJudge(state, snap, { ok: false, error: "not bound" });
  const packet = buildPacket({
    cwd: ctx.cwd,
    destination: snap.destinationText,
    constraints: snap.live.constraints
      .filter((item) => snap.live?.live.has(item.id))
      .map((item) => ({ id: item.id, headline: item.headline, body: item.directive || item.body })),
    closed: closedQuestions(snap.live),
    claim,
  });
  if (!packet.ok) return onJudge(state, snap, packet);
  const model = modelOf(ctx, override);
  if (!model) return onJudge(state, snap, { ok: false, error: "no model" });
  const ran = await runJudge(model, packet.text, ctx.cwd);
  const verdict = ran.ok ? parseVerdict(ran.text) : ran;
  return onJudge(state, snap, verdict, productStamp(ctx.cwd, claim));
}
