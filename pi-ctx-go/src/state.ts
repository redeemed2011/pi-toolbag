import {
  CLAIM_PROMPT,
  DRAFT_PROMPT,
  PROJECT_CLAIM_PROMPT,
  QUESTION_PROMPT,
  RECONCILE_PROMPT,
  judgeErrorPrompt,
  projectErrorPrompt,
  projectRejectionPrompt,
  rejectionPrompt,
  workPrompt,
} from "./prompts.js";
import { twoLines } from "./text.js";

export type GoPhase = "idle" | "draft" | "reconcile" | "questions" | "work" | "claim" | "project" | "paused";

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
  /** A well-formed judge result is waiting. Neither aim nor the project is done. */
  awaitingAccept: boolean;
  /** The operator's Not-done sentence. Cleared only by Accept. */
  obligation: string;
  /** Last session entry id covered by a finished reconcile. An impasse does not move it. */
  reconciledThrough: string | null;
  /** Status reports in a row. The first is sent back to the work. The next unchanged one pauses. */
  statusReports: number;
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
  /** Last entry id in the session. Missing means reconcile cannot be skipped. */
  sessionTip?: string | null;
  /** A live decision says "not built" and no question was recorded at or after it. */
  notBuiltOpen?: boolean;
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
  | { type: "judge"; claim: string; review?: "impasse" }
  | { type: "accept"; summary: string }
  | { type: "claim"; questionId: string }
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
    awaitingAccept: false,
    obligation: "",
    reconciledThrough: null,
    statusReports: 0,
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
      awaitingAccept: state.awaitingAccept,
      obligation: state.obligation,
      reconciledThrough: state.reconciledThrough,
      phase: state.phase === "paused" ? "paused" : "idle",
    },
    actions: [{ type: "notify", level: "info", message: "ctx-go stopped" }],
  };
}

export function onGo(state: GoState, snap: Snap): Step {
  if (!snap.bound) {
    return { state, actions: [{ type: "notify", level: "warning", message: BIND_NEXT }] };
  }
  if (state.awaitingAccept) {
    return {
      state: { ...state, armed: true },
      actions: [{ type: "accept", summary: state.lastVerdict }],
    };
  }
  const next: GoState = {
    ...state,
    armed: true,
    hold: false,
    projectDone: false,
    rejections: state.phase === "paused" ? 0 : state.rejections,
    statusReports: state.phase === "paused" ? 0 : state.statusReports,
    productStamp: state.phase === "paused" ? null : state.productStamp,
    priorVerdict: state.phase === "paused" ? "" : state.priorVerdict,
    phase: destinationReady(state, snap) ? "questions" : "draft",
  };
  if (next.phase !== "questions") return draftAsk(next, snap);
  if (!alreadyReconciled(state, snap)) return prompt({ ...next, phase: "reconcile" }, RECONCILE_PROMPT, snap);
  return workFrom(next, snap);
}

function alreadyReconciled(state: GoState, snap: Snap): boolean {
  const tip = snap.sessionTip ?? null;
  return tip !== null && state.reconciledThrough === tip;
}

function workFrom(state: GoState, snap: Snap): Step {
  if (!questionsOpen(snap) && state.obligation) {
    const base = state.aimMet
      ? projectRejectionPrompt(snap.destinationText ?? "", state.obligation)
      : rejectionPrompt(snap.destinationText ?? "", state.obligation);
    return prompt(
      { ...state, phase: state.aimMet ? "questions" : "work" },
      `${base}\nThe operator said this is not done: ${state.obligation}`,
      snap,
    );
  }
  if (!questionsOpen(snap)) {
    const verdict = state.lastVerdict.trim();
    if (state.aimMet) {
      const text =
        verdict && state.verdictKind === "rejection"
          ? projectRejectionPrompt(snap.destinationText ?? "", verdict)
          : verdict && state.verdictKind === "error"
            ? projectErrorPrompt(snap.destinationText ?? "", verdict)
            : PROJECT_CLAIM_PROMPT;
      return prompt({ ...state, phase: verdict ? "questions" : "project" }, text, snap);
    }
    const text =
      verdict && state.verdictKind === "rejection"
        ? rejectionPrompt(snap.destinationText ?? "", verdict)
        : verdict && state.verdictKind === "error"
          ? judgeErrorPrompt(snap.destinationText ?? "", verdict)
          : workPrompt(snap.destinationText ?? "");
    return prompt({ ...state, phase: "work" }, text, snap);
  }
  return workQuestions(state, snap);
}

function workQuestions(state: GoState, snap: Snap): Step {
  const questionId = snap.claimedId ? null : (snap.frontierIds[0] ?? null);
  const seen = questionId
    ? { ...snap, claimedId: questionId, frontierIds: snap.frontierIds.filter((id) => id !== questionId) }
    : snap;
  const step = prompt({ ...state, phase: "questions" }, QUESTION_PROMPT, seen);
  if (!questionId) return step;
  return { state: step.state, actions: [{ type: "claim", questionId }, ...step.actions] };
}

const NOT_BUILT = "ctx-go paused: a not-built decision has no question";

function namedImpasse(text: string): string | null {
  const line = text.split("\n").map((item) => item.trim()).find((item) => item.toLowerCase().startsWith("impasse:"));
  if (!line) return null;
  const reason = line.slice("impasse:".length).trim() || "unspecified";
  return reason.length > 240 ? `${reason.slice(0, 239)}…` : reason;
}

function finishReconcile(state: GoState, snap: Snap): Step {
  return workFrom({ ...state, reconciledThrough: snap.sessionTip ?? state.reconciledThrough }, snap);
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
  return prompt({ ...next, phase: "reconcile" }, RECONCILE_PROMPT, { ...snap, destinationId });
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
  if (state.phase === "reconcile") {
    if (turn.pending) return { state, actions: [] };
    const blocked = blockedPause(state, snap);
    if (blocked) return blocked;
    const impasse = namedImpasse(turn.text);
    if (impasse) {
      const line = turn.text.split("\n").map((item) => item.trim()).find((item) => item.toLowerCase().startsWith("impasse:")) ?? `Impasse: ${impasse}`;
      return {
        state: { ...state, lastClaim: line },
        actions: [{ type: "judge", claim: line, review: "impasse" }],
      };
    }
    if (isStatusReport(turn.text)) return rejectStatus(state, snap);
    if (snap.notBuiltOpen && !questionsOpen(snap)) return pause(state, NOT_BUILT);
    return finishReconcile({ ...state, statusReports: 0 }, snap);
  }
  const changed = fingerprint(snap) !== state.lastFingerprint;
  const held = blockedPause(state, snap);
  if (held) return held;
  if (snap.notBuiltOpen && !questionsOpen(snap)) return pause(state, NOT_BUILT);
  if (questionsOpen(snap)) {
    if (isStatusReport(turn.text)) return rejectStatus({ ...state, phase: "questions" }, snap);
    if (!changed && snap.claimedId) return pause(state, "ctx-go paused: no progress");
    if (turn.pending) return { state, actions: [] };
    return workQuestions({ ...state, statusReports: 0 }, snap);
  }
  if (state.aimMet && state.phase !== "work") {
    if (state.phase !== "project") {
      if (turn.pending) return { state, actions: [] };
      return prompt({ ...state, phase: "project" }, PROJECT_CLAIM_PROMPT, snap);
    }
    const projectClaim = turn.text.trim();
    if (isStatusReport(projectClaim)) return rejectStatus({ ...state, phase: "project" }, snap);
    if (!projectClaim) return pause(state, "ctx-go paused: done-claim was empty");
    return { state: { ...state, lastClaim: projectClaim, statusReports: 0 }, actions: [{ type: "judge", claim: projectClaim }] };
  }
  if (state.phase !== "work" && state.phase !== "claim") {
    if (turn.pending) return { state, actions: [] };
    return prompt({ ...state, phase: "work" }, workPrompt(snap.destinationText ?? ""), snap);
  }
  if (state.phase === "work") {
    if (turn.pending) return { state, actions: [] };
    if (reportsNoQuestions(turn.text)) return pause(state, "ctx-go paused: no progress");
    if (isStatusReport(turn.text)) return rejectStatus(state, snap);
    const claimPhase = state.aimMet ? "project" : "claim";
    const claimText = state.aimMet ? PROJECT_CLAIM_PROMPT : CLAIM_PROMPT;
    return prompt({ ...state, phase: claimPhase, statusReports: 0 }, claimText, snap);
  }
  const claim = turn.text.trim();
  if (isStatusReport(claim)) return rejectStatus({ ...state, phase: state.aimMet ? "project" : "work" }, snap);
  if (!claim) return pause(state, "ctx-go paused: done-claim was empty");
  return {
    state: { ...state, lastClaim: claim },
    actions: [{ type: "judge", claim }],
  };
}

/** The judge already reviewed the impasse. A way through continues. Agreement pauses. An error pauses and is not agreement. */
export function onImpasseJudge(
  state: GoState,
  snap: Snap,
  result: { ok: true; through: boolean; summary: string } | { ok: false; error: string },
): Step {
  if (!result.ok) {
    return pause(
      { ...state, lastVerdict: result.error, verdictKind: "error" },
      `ctx-go paused: ${result.error}`,
    );
  }
  if (result.through) {
    const summary = result.summary.trim() || "a way through";
    return prompt(
      { ...state, phase: "reconcile", lastVerdict: summary, verdictKind: "none" },
      `${RECONCILE_PROMPT}\nThe judge found a way through:\n${summary}\nRecord that item.`,
      snap,
    );
  }
  const reason = result.summary.trim() || "no missed work";
  return pause(
    { ...state, lastVerdict: reason, verdictKind: "none" },
    `ctx-go paused: ${reason}`,
  );
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
    return {
      state: {
        ...state,
        armed: true,
        phase: "paused",
        hold: false,
        awaitingAccept: true,
        lastVerdict: result.summary,
        verdictKind: "none",
      },
      actions: [
        { type: "notify", level: "info", message: "ctx-go waiting for Accept" },
        { type: "accept", summary: result.summary },
        { type: "record", text: record },
      ],
    };
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

/** Accept is the only finish. The first accept marks the destination. The second marks the project. */
export function onAccept(state: GoState, snap: Snap): Step {
  if (!state.awaitingAccept) return { state, actions: [] };
  const summary = state.lastVerdict;
  const cleared = {
    ...state,
    awaitingAccept: false,
    obligation: "",
    lastVerdict: "",
    verdictKind: "none" as const,
    hold: false,
  };
  if (!state.aimMet) {
    const accepted = { ...cleared, armed: true, aimMet: true, projectDone: false };
    return questionsOpen(snap)
      ? workQuestions(accepted, snap)
      : prompt({ ...accepted, phase: "project" }, PROJECT_CLAIM_PROMPT, snap);
  }
  return {
    state: { ...freshState(), approvedDestinationId: state.approvedDestinationId, aimMet: true, projectDone: true },
    actions: [{ type: "notify", level: "info", message: `ctx-go done\n${summary}` }],
  };
}

/** An empty sentence is silence. Silence does not accept and does not clear the wait. */
export function onNotDone(state: GoState, snap: Snap, sentence: string): Step {
  const text = sentence.trim();
  if (!state.awaitingAccept || !text) {
    return { state, actions: [{ type: "accept", summary: state.lastVerdict }] };
  }
  const next = {
    ...state,
    awaitingAccept: false,
    obligation: text,
    armed: true,
    projectDone: false,
    phase: "work" as const,
    verdictKind: "rejection" as const,
    lastVerdict: text,
    hold: false,
  };
  const base = state.aimMet
    ? projectRejectionPrompt(snap.destinationText ?? "", text)
    : rejectionPrompt(snap.destinationText ?? "", text);
  return prompt(next, `${base}\nThe operator said this is not done: ${text}`, snap);
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

const STATUS_REPORT =
  /\bgoal is in place\b|\bnot all proven\b|\bnot proven\b|\bmodel is checking\b|\bi am checking\b|\bi'm checking\b|\bchecking those\b/i;

function isStatusReport(text: string): boolean {
  return STATUS_REPORT.test(text);
}

function rejectStatus(state: GoState, snap: Snap): Step {
  const same = state.lastFingerprint !== null && fingerprint(snap) === state.lastFingerprint;
  const count = same ? state.statusReports + 1 : 0;
  const next = { ...state, statusReports: count };
  if (count >= 2) {
    return pause(next, "ctx-go paused: no progress");
  }
  const again =
    "That report did not do the work. Write the missing product or record the missing question now. Do not say you are checking.";
  if (state.phase === "reconcile") return prompt(next, `${RECONCILE_PROMPT}\n${again}`, snap);
  if (state.phase === "questions") {
    const step = workQuestions(next, snap);
    return {
      state: step.state,
      actions: step.actions.map((action) =>
        action.type === "prompt" ? { ...action, text: `${action.text}\n${again}` } : action,
      ),
    };
  }
  const text =
    state.phase === "project"
      ? state.verdictKind === "rejection"
        ? projectRejectionPrompt(snap.destinationText ?? "", state.lastVerdict)
        : PROJECT_CLAIM_PROMPT
      : state.verdictKind === "rejection"
        ? rejectionPrompt(snap.destinationText ?? "", state.lastVerdict)
        : workPrompt(snap.destinationText ?? "");
  return prompt(next, `${text}\n${again}`, snap);
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
