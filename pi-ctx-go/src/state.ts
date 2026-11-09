import {
  CLAIM_PROMPT,
  DRAFT_PROMPT,
  PROJECT_CLAIM_PROMPT,
  QUESTION_PROMPT,
  judgeErrorPrompt,
  projectErrorPrompt,
  projectRejectionPrompt,
  rejectionPrompt,
  workPrompt,
} from "./prompts.js";
import { twoLines } from "./text.js";

export type GoPhase = "idle" | "draft" | "questions" | "work" | "claim" | "project" | "paused";

export type VerdictKind = "none" | "rejection" | "error";

export type GoState = {
  armed: boolean;
  phase: GoPhase;
  rejections: number;
  approvedDestinationId: string | null;
  hold: boolean;
  lastFingerprint: string | null;
  lastClaim: string;
  lastVerdict: string;
  priorVerdict: string;
  productStamp: string | null;
  verdictKind: VerdictKind;
  aimMet: boolean;
  projectDone: boolean;
};

export type BlockedQuestion = { id: string; headline: string; blockers: string[] };

export type Snap = {
  bound: boolean;
  destinationId: string | null;
  frontierIds: string[];
  claimedId: string | null;
  askIds: string[];
  askHeadlines: string[];
  blocked: BlockedQuestion[];
  destinationText?: string;
};

export type TurnView = {
  outcome: "completed" | "error" | "aborted";
  toolCount: number;
  pending: boolean;
  text: string;
};

export type Action =
  | { type: "notify"; level: "info" | "warning" | "error"; message: string }
  | { type: "prompt"; text: string }
  | { type: "approve"; text: string }
  | { type: "judge"; claim: string }
  | { type: "record"; text: string };

export type Step = { state: GoState; actions: Action[] };

export function freshState(): GoState {
  return {
    armed: false,
    phase: "idle",
    rejections: 0,
    approvedDestinationId: null,
    hold: false,
    lastFingerprint: null,
    lastClaim: "",
    lastVerdict: "",
    priorVerdict: "",
    productStamp: null,
    verdictKind: "none",
    aimMet: false,
    projectDone: false,
  };
}

export function fingerprint(snap: Snap): string {
  return [snap.destinationId ?? "", snap.claimedId ?? "", snap.frontierIds.join(",")].join("|");
}

const BIND_NEXT = "CTX is not bound. Bind a CTX project, then run /ctx-go again.";
const DRAFT_NEXT = "No destination is approved. The model will draft one, and you will approve it.";

function prompt(state: GoState, text: string, snap: Snap): Step {
  return {
    state: { ...state, lastFingerprint: fingerprint(snap) },
    actions: [{ type: "prompt", text }],
  };
}

function draftAsk(state: GoState, snap: Snap): Step {
  const step = prompt(state, DRAFT_PROMPT, snap);
  return {
    state: step.state,
    actions: [{ type: "notify", level: "info", message: DRAFT_NEXT }, ...step.actions],
  };
}

function destinationReady(state: GoState, snap: Snap): boolean {
  return state.approvedDestinationId !== null && state.approvedDestinationId === snap.destinationId;
}

export function onStop(state: GoState): Step {
  return {
    state: {
      ...freshState(),
      approvedDestinationId: state.approvedDestinationId,
      rejections: state.rejections,
      lastClaim: state.lastClaim,
      lastVerdict: state.lastVerdict,
      priorVerdict: state.priorVerdict,
      productStamp: state.productStamp,
      verdictKind: state.verdictKind,
      aimMet: state.aimMet,
      projectDone: state.projectDone,
      phase: state.phase === "paused" ? "paused" : "idle",
    },
    actions: [{ type: "notify", level: "info", message: "ctx-go stopped" }],
  };
}

export function onGo(state: GoState, snap: Snap): Step {
  if (!snap.bound) {
    return { state, actions: [{ type: "notify", level: "warning", message: BIND_NEXT }] };
  }
  const next: GoState = {
    ...state,
    armed: true,
    hold: false,
    projectDone: false,
    rejections: state.phase === "paused" ? 0 : state.rejections,
    productStamp: state.phase === "paused" ? null : state.productStamp,
    priorVerdict: state.phase === "paused" ? "" : state.priorVerdict,
    phase: destinationReady(state, snap) ? "questions" : "draft",
  };
  if (next.phase === "questions") {
    if (!questionsOpen(snap)) {
      const verdict = next.lastVerdict.trim();
      if (next.aimMet) {
        const text =
          verdict && next.verdictKind === "rejection"
            ? projectRejectionPrompt(snap.destinationText ?? "", verdict)
            : verdict && next.verdictKind === "error"
              ? projectErrorPrompt(snap.destinationText ?? "", verdict)
              : PROJECT_CLAIM_PROMPT;
        return prompt({ ...next, phase: verdict ? "questions" : "project" }, text, snap);
      }
      const text =
        verdict && next.verdictKind === "rejection"
          ? rejectionPrompt(snap.destinationText ?? "", verdict)
          : verdict && next.verdictKind === "error"
            ? judgeErrorPrompt(snap.destinationText ?? "", verdict)
            : workPrompt(snap.destinationText ?? "");
      return prompt({ ...next, phase: "work" }, text, snap);
    }
    return prompt(next, QUESTION_PROMPT, snap);
  }
  return draftAsk(next, snap);
}

export function onApproved(state: GoState, snap: Snap, destinationId: string): Step {
  const next: GoState = {
    ...state,
    armed: true,
    phase: "questions",
    approvedDestinationId: destinationId,
    aimMet: false,
    projectDone: false,
  };
  return prompt(next, QUESTION_PROMPT, { ...snap, destinationId });
}

export function onDraftRejected(state: GoState, snap: Snap): Step {
  return draftAsk({ ...state, phase: "draft" }, snap);
}

function pause(state: GoState, message: string, hard = false): Step {
  return {
    state: { ...state, phase: hard ? "paused" : state.phase, hold: !hard },
    actions: [{ type: "notify", level: "warning", message }],
  };
}

function claimBlocked(snap: Snap): boolean {
  return snap.claimedId !== null && snap.blocked.some((item) => item.id === snap.claimedId);
}

function questionsOpen(snap: Snap): boolean {
  if (snap.frontierIds.length > 0) return true;
  return snap.claimedId !== null && !snap.askIds.includes(snap.claimedId) && !claimBlocked(snap);
}

function askPause(state: GoState, snap: Snap): Step {
  const lines = snap.askHeadlines.map((headline, i) => `${snap.askIds[i]} ${headline}`);
  return pause(state, `Ask the operator:\n${lines.join("\n")}`);
}

function blockedPause(state: GoState, snap: Snap): Step | null {
  if (snap.askIds.length > 0) return askPause(state, snap);
  if (questionsOpen(snap)) return null;
  if (snap.blocked.length > 0) {
    const lines = snap.blocked.map((item) => `${item.id} ${item.headline} blocked by ${item.blockers.join(", ")}`);
    return pause(state, `Blocked questions:\n${lines.join("\n")}`);
  }
  return null;
}

export function onTurn(state: GoState, snap: Snap, turn: TurnView): Step {
  if (!state.armed || !snap.bound) return { state, actions: [] };
  if (state.phase === "paused") return { state, actions: [] };
  if (state.hold) state = { ...state, hold: false };
  if (turn.outcome !== "completed") {
    return pause(state, `ctx-go paused: turn ${turn.outcome}`);
  }
  if (turn.toolCount > 0) return { state, actions: [] };
  const say = (next: GoState, text: string): Step => {
    const step = prompt(next, text, snap);
    if (turn.pending) return { state: step.state, actions: [] };
    return step;
  };
  if (!destinationReady(state, snap)) {
    if (state.phase !== "draft") {
      if (turn.pending) return { state, actions: [] };
      return draftAsk({ ...state, phase: "draft", approvedDestinationId: null, aimMet: false, projectDone: false }, snap);
    }
    const draft = twoLines(turn.text);
    if (!draft) return pause(state, "ctx-go paused: draft made no progress");
    return { state: { ...state, phase: "draft" }, actions: [{ type: "approve", text: draft }] };
  }
  const changed = fingerprint(snap) !== state.lastFingerprint;
  const held = blockedPause(state, snap);
  if (held) return held;
  if (questionsOpen(snap)) {
    if (!changed) return pause(state, "ctx-go paused: no progress");
    return say({ ...state, phase: "questions" }, QUESTION_PROMPT);
  }
  if (state.aimMet) {
    if (state.phase !== "project") {
      if (turn.pending) return { state, actions: [] };
      return prompt({ ...state, phase: "project" }, PROJECT_CLAIM_PROMPT, snap);
    }
    const projectClaim = turn.text.trim();
    if (!projectClaim) return pause(state, "ctx-go paused: done-claim was empty");
    return { state: { ...state, lastClaim: projectClaim }, actions: [{ type: "judge", claim: projectClaim }] };
  }
  if (state.phase !== "work" && state.phase !== "claim") {
    if (turn.pending) return { state, actions: [] };
    return prompt({ ...state, phase: "work" }, workPrompt(snap.destinationText ?? ""), snap);
  }
  if (state.phase === "work") {
    if (turn.pending) return { state, actions: [] };
    if (reportsNoQuestions(turn.text)) return pause(state, "ctx-go paused: no progress");
    return prompt({ ...state, phase: "claim" }, CLAIM_PROMPT, snap);
  }
  const claim = turn.text.trim();
  if (!claim) return pause(state, "ctx-go paused: done-claim was empty");
  return {
    state: { ...state, lastClaim: claim },
    actions: [{ type: "judge", claim }],
  };
}

const JUDGE_CAP = 10;

export function onJudge(
  state: GoState,
  snap: Snap,
  result: { ok: true; done: boolean; summary: string } | { ok: false; error: string },
  products = "",
): Step {
  if (!result.ok) {
    return withRecord(
      pause({ ...state, phase: "questions", lastVerdict: result.error, verdictKind: "error" }, `ctx-go paused: judge ${result.error}`),
      report("Fail", result.error, state.lastClaim),
    );
  }
  if (result.done) {
    const record = report("Pass", result.summary, state.lastClaim);
    if (state.aimMet) {
      return {
        state: { ...freshState(), approvedDestinationId: state.approvedDestinationId, aimMet: true, projectDone: true },
        actions: [
          { type: "notify", level: "info", message: `ctx-go done\n${result.summary}` },
          { type: "record", text: record },
        ],
      };
    }
    const accepted = {
      ...state,
      armed: true,
      aimMet: true,
      projectDone: false,
      lastVerdict: "",
      verdictKind: "none" as const,
      hold: false,
    };
    const step = questionsOpen(snap)
      ? prompt({ ...accepted, phase: "questions" }, QUESTION_PROMPT, snap)
      : prompt({ ...accepted, phase: "project" }, PROJECT_CLAIM_PROMPT, snap);
    return withRecord(step, record);
  }
  const rejections = state.rejections + 1;
  const summary = result.summary || "not done";
  const moved = state.productStamp !== null && products !== state.productStamp;
  const rejected = {
    ...state,
    rejections,
    lastVerdict: summary,
    priorVerdict: summary,
    productStamp: products,
    verdictKind: "rejection" as const,
  };
  if (rejections >= JUDGE_CAP) {
    const message = `${resultLine("Fail", summary)}\nctx-go paused after ${JUDGE_CAP} judge calls\nWorker: ${state.lastClaim}\nJudge: ${summary}`;
    return withRecord(pause(rejected, message, true), message);
  }
  if (rejections >= 2 && !moved) {
    const message = `${resultLine("Fail", summary)}\nctx-go paused: no product change\nWorker: ${state.lastClaim}\nJudge: ${state.priorVerdict}\nJudge: ${summary}`;
    return withRecord(pause(rejected, message, true), message);
  }
  const next = { ...rejected, phase: state.aimMet ? ("questions" as const) : ("work" as const) };
  const text = state.aimMet
    ? projectRejectionPrompt(snap.destinationText ?? "", summary)
    : rejectionPrompt(snap.destinationText ?? "", summary);
  return withRecord(prompt(next, text, snap), report("Fail", summary, state.lastClaim));
}

function resultLine(kind: "Pass" | "Fail", why: string): string {
  const sentence = why.trim().split(/(?<=[.!?])\s/)[0] || "no reason given";
  return `${kind}: ${sentence}`;
}

function report(kind: "Pass" | "Fail", why: string, claim: string): string {
  return `${resultLine(kind, why)}\nWorker: ${claim}\nJudge: ${why}`;
}

function withRecord(step: Step, text: string): Step {
  return { state: step.state, actions: [...step.actions, { type: "record", text }] };
}

function reportsNoQuestions(text: string): boolean {
  const lower = text.toLowerCase();
  const saysEmpty =
    lower.includes("no open question") ||
    lower.includes("frontier is empty") ||
    lower.includes("no question to settle") ||
    lower.includes("nothing is claimed");
  return saysEmpty && !lower.includes("destination is met");
}
