import type { ExtensionAPI, ExtensionContext, SessionBoundaryDraft } from "@earendil-works/pi-coding-agent";
import { approveDestination } from "./src/approve.js";
import { readClock, writeClock } from "./src/clock.js";
import { runConflictRead } from "./src/conflict-read.js";
import { IMPASSE_ASK, runJudge, thinkingLevel, type JudgeModel } from "./src/judge.js";
import { buildImpassePacket, buildPacket, judgedDone, parseImpasse, productStamp } from "./src/packet.js";
import { closedQuestions, prepareClaim, readSnap, type BoundSnap } from "./src/snap.js";
import { CTX_CLAIM } from "../pi-ctx/src/types.js";
import {
  freshState,
  onApproved,
  onDraftRejected,
  onGo,
  onImpasseJudge,
  onAccept,
  onJudge,
  onNotDone,
  onStop,
  onTurn,
  type Action,
  type GoState,
  type Step,
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
    input(title: string, placeholder?: string): Promise<string | undefined>;
    notify(message: string, level?: "info" | "warning" | "error"): void;
    setStatus?(key: string, text: string | undefined): void;
    setWidget?(key: string, content: string[] | undefined): void;
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

const BUSY_KEY = "ctx-go";

function notify(ctx: GoCtx, actions: Action[]): void {
  for (const action of actions) {
    if (action.type === "notify" && ctx.hasUI) ctx.ui.notify(action.message, action.level);
  }
}

function showBusy(ctx: GoCtx, text: string | undefined): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus?.(BUSY_KEY, text);
  if (text) ctx.ui.setWidget?.(BUSY_KEY, [text]);
  else ctx.ui.setWidget?.(BUSY_KEY, undefined);
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

  async function settle(goCtx: GoCtx, step: Step, snap: BoundSnap): Promise<Step> {
    const accept = step.actions.find((action) => action.type === "accept");
    if (!accept || accept.type !== "accept" || !goCtx.hasUI) return step;
    const picked = await goCtx.ui.select(`Accept this judge result?\n${accept.summary}`, ["Accept", "Not done"]);
    const records = step.actions.filter((action) => action.type === "record");
    if (picked === "Accept") {
      const next = onAccept(step.state, snap);
      return { state: next.state, actions: [...next.actions, ...records] };
    }
    if (picked !== "Not done") return step;
    const sentence = await goCtx.ui.input("What is not done?", "One sentence");
    if (!sentence?.trim()) return step;
    const next = onNotDone(step.state, snap, sentence);
    return { state: next.state, actions: [...next.actions, ...records] };
  }

  function wroteClaim(ctx: GoCtx, actions: Action[]): boolean {
    const claim = actions.find((action) => action.type === "claim");
    if (!claim || claim.type !== "claim") return true;
    const { branch, sessionId } = branchOf(ctx);
    const wrote = prepareClaim(branch, sessionId, ctx.cwd, claim.questionId);
    if (!wrote.ok) {
      state = remember(ctx, { ...state, phase: "paused", hold: false });
      if (ctx.hasUI) ctx.ui.notify(`ctx-go paused: ${wrote.error}`, "warning");
      return false;
    }
    if (!wrote.noop) pi.appendEntry(CTX_CLAIM, { claimed_question_id: wrote.claimedId });
    return true;
  }

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
      let gated: Step | null = null;
      try {
        gated = await runConflictRead({
          state,
          live: snap.live,
          model: modelOf(goCtx, override),
          cwd: goCtx.cwd,
          tell: (message) => {
            if (!goCtx.hasUI) return;
            goCtx.ui.notify(message, "info");
            showBusy(goCtx, message);
          },
        });
      } finally {
        showBusy(goCtx, undefined);
      }
      if (gated) {
        state = remember(goCtx, gated.state);
        notify(goCtx, gated.actions);
        if (gated.actions.length > 0) return;
      }
      const opened = onGo(state, snap);
      const step = await settle(goCtx, opened, snap);
      state = remember(goCtx, step.state);
      notify(goCtx, step.actions);
      if (!wroteClaim(goCtx, step.actions)) return;
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
    if (!wroteClaim(goCtx, step.actions)) return;

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
      const judged = judge.review === "impasse"
        ? await judgeImpasse(goCtx, snap, state, judge.claim, override)
        : await judgeNow(goCtx, snap, state, judge.claim, override);
      const settled = await settle(goCtx, judged, snap);
      state = remember(goCtx, settled.state);
      notify(goCtx, settled.actions);
      if (!wroteClaim(goCtx, settled.actions)) return;
      if (goCtx.hasPendingMessages()) return;
      return continued(event.entries, settled.actions);
    }

    if (goCtx.hasPendingMessages()) return;
    return continued(event.entries, step.actions);
  });
}

function impasseOpen(snap: BoundSnap): string {
  const lines = [
    ...snap.frontierIds.map((id) => `open ${id}`),
    ...snap.askIds.map((id, index) => `ask ${id} ${snap.askHeadlines[index] ?? ""}`),
    ...snap.blocked.map((item) => `blocked ${item.id} ${item.headline}`),
  ];
  return lines.join("\n");
}

async function judgeImpasse(ctx: GoCtx, snap: BoundSnap, state: GoState, claim: string, override: JudgeOverride | null) {
  if (!snap.live) return onImpasseJudge(state, snap, { ok: false, error: "not bound" });
  const packet = buildImpassePacket({
    destination: snap.destinationText ?? "",
    constraints: snap.live.constraints
      .filter((item) => snap.live?.live.has(item.id))
      .map((item) => ({ headline: item.headline, body: item.directive || item.body })),
    claim,
    open: impasseOpen(snap),
  });
  if (!packet.ok) return onImpasseJudge(state, snap, packet);
  const model = modelOf(ctx, override);
  if (!model) return onImpasseJudge(state, snap, { ok: false, error: "no model" });
  const ran = await runJudge(model, packet.text, ctx.cwd, IMPASSE_ASK);
  const verdict = ran.ok ? parseImpasse(ran.text) : ran;
  return onImpasseJudge(state, snap, verdict);
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
    obligation: state.obligation,
  });
  if (!packet.ok) return onJudge(state, snap, packet);
  const model = modelOf(ctx, override);
  if (!model) return onJudge(state, snap, { ok: false, error: "no model" });
  const ran = await runJudge(model, packet.text, ctx.cwd);
  const verdict = ran.ok ? judgedDone(ran.text, snap.destinationText ?? "", claim) : ran;
  return onJudge(state, snap, verdict, productStamp(ctx.cwd, claim));
}
