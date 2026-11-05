import { CLAIM_PROMPT, DRAFT_PROMPT, QUESTION_PROMPT } from "./prompts.js";
import { twoLines } from "./text.js";

export type GoPhase = "idle" | "draft" | "questions" | "claim" | "paused";

export type GoState = {
  armed: boolean;
  phase: GoPhase;
  rejections: number;
  approvedDestinationId: string | null;
  hold: boolean;
  lastFingerprint: string | null;
  lastClaim: string;
  lastVerdict: string;
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
  | { type: "judge"; claim: string };

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
  };
}

export function fingerprint(snap: Snap): string {
  return [snap.destinationId ?? "", snap.claimedId ?? "", snap.frontierIds.join(",")].join("|");
}

function prompt(state: GoState, text: string, snap: Snap): Step {
  return {
    state: { ...state, lastFingerprint: fingerprint(snap) },
    actions: [{ type: "prompt", text }],
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
      phase: state.phase === "paused" ? "paused" : "idle",
    },
    actions: [{ type: "notify", level: "info", message: "ctx-go stopped" }],
  };
}

export function onGo(state: GoState, snap: Snap): Step {
  if (!snap.bound) {
    return { state, actions: [{ type: "notify", level: "warning", message: "ctx-go needs a bound CTX project" }] };
  }
  const next: GoState = {
    ...state,
    armed: true,
    hold: false,
    rejections: state.phase === "paused" ? 0 : state.rejections,
    lastClaim: state.phase === "paused" ? "" : state.lastClaim,
    lastVerdict: state.phase === "paused" ? "" : state.lastVerdict,
    phase: destinationReady(state, snap) ? "questions" : "draft",
  };
  const text = next.phase === "questions" ? QUESTION_PROMPT : DRAFT_PROMPT;
  return prompt(next, text, snap);
}

export function onApproved(state: GoState, snap: Snap, destinationId: string): Step {
  const next: GoState = { ...state, armed: true, phase: "questions", approvedDestinationId: destinationId };
  return prompt(next, QUESTION_PROMPT, { ...snap, destinationId });
}

export function onDraftRejected(state: GoState, snap: Snap): Step {
  return prompt({ ...state, phase: "draft" }, DRAFT_PROMPT, snap);
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
      return prompt({ ...state, phase: "draft", approvedDestinationId: null }, DRAFT_PROMPT, snap);
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
  if (state.phase !== "claim") {
    if (turn.pending) return { state, actions: [] };
    return prompt({ ...state, phase: "claim" }, CLAIM_PROMPT, snap);
  }
  const claim = turn.text.trim();
  if (!claim) return pause(state, "ctx-go paused: done-claim was empty");
  return {
    state: { ...state, lastClaim: claim },
    actions: [{ type: "judge", claim }],
  };
}

export function onJudge(
  state: GoState,
  snap: Snap,
  result: { ok: true; done: boolean; summary: string } | { ok: false; error: string },
): Step {
  if (!result.ok) return pause({ ...state, phase: "questions" }, `ctx-go paused: judge ${result.error}`);
  if (result.done) {
    return {
      state: { ...freshState(), approvedDestinationId: state.approvedDestinationId },
      actions: [{ type: "notify", level: "info", message: `ctx-go done\n${result.summary}` }],
    };
  }
  const rejections = state.rejections + 1;
  const summary = result.summary || "not done";
  if (rejections >= 2) {
    return pause(
      { ...state, rejections, lastVerdict: summary },
      `ctx-go paused after two rejections\nWorker: ${state.lastClaim}\nJudge: ${summary}`,
      true,
    );
  }
  return prompt({ ...state, phase: "questions", rejections, lastVerdict: summary }, QUESTION_PROMPT, snap);
}
