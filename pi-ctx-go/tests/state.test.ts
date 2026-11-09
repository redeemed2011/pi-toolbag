import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readClock, writeClock } from "../src/clock.js";
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
} from "../src/prompts.js";
import { freshState, onApproved, onGo, onJudge, onStop, onTurn, type Snap } from "../src/state.js";

function snap(partial: Partial<Snap> = {}): Snap {
  return {
    bound: true,
    destinationId: "d1",
    frontierIds: ["q1"],
    claimedId: null,
    askIds: [],
    askHeadlines: [],
    blocked: [],
    ...partial,
  };
}

const doneTurn = { outcome: "completed" as const, toolCount: 0, pending: false, text: "shipped src/out.md" };

describe("ctx-go loop", () => {
  it("does nothing until CTX is bound", () => {
    const step = onGo(freshState(), snap({ bound: false }));
    expect(step.state.armed).toBe(false);
    expect(step.actions).toEqual([
      { type: "notify", level: "warning", message: "CTX is not bound. Bind a CTX project, then run /ctx-go again." },
    ]);
  });

  it("starts by asking for a draft, then for approval", () => {
    const started = onGo(freshState(), snap({ destinationId: null }));
    expect(started.state.phase).toBe("draft");
    expect(started.actions[0]).toMatchObject({
      type: "notify",
      message: "No destination is approved. The model will draft one, and you will approve it.",
    });
    expect(started.actions[1]).toMatchObject({ type: "prompt", text: DRAFT_PROMPT });
    const drafted = onTurn(started.state, snap({ destinationId: null }), { ...doneTurn, text: "Ship the marker.\nKeep it short.\nIgnore." });
    expect(drafted.actions[0]).toMatchObject({ type: "approve", text: "Ship the marker.\nKeep it short." });
    const wrapped = onTurn(started.state, snap({ destinationId: null }), {
      ...doneTurn,
      text: "The CTX destination draft is one line and has not been recorded:\n\nFrom a local web app, the operator directs the work.",
    });
    expect(wrapped.actions[0]).toMatchObject({
      type: "approve",
      text: "From a local web app, the operator directs the work.",
    });
  });

  it("works questions only after the approved destination is the injected one", () => {
    const approved = onApproved({ ...freshState(), armed: true, phase: "draft" }, snap(), "d1");
    expect(approved.state.approvedDestinationId).toBe("d1");
    expect(approved.actions[0]).toMatchObject({ type: "prompt", text: RECONCILE_PROMPT });
    const worked = onTurn(approved.state, snap(), doneTurn);
    expect(worked.actions[0]).toEqual({ type: "claim", questionId: "q1" });
    expect(worked.actions[1]).toMatchObject({ type: "prompt", text: QUESTION_PROMPT });
  });

  it("does not continue a tool turn, and the next unchanged turn pauses", () => {
    const started = onApproved({ ...freshState(), armed: true }, snap(), "d1");
    const ready = onTurn(started.state, snap(), doneTurn);
    expect(ready.state.phase).toBe("questions");
    const claimed = snap({ frontierIds: [], claimedId: "q1" });
    const tools = onTurn(ready.state, claimed, { ...doneTurn, toolCount: 2, text: "" });
    expect(tools.actions).toEqual([]);
    expect(tools.state.phase).toBe("questions");
    const stalled = onTurn(tools.state, claimed, doneTurn);
    expect(stalled.state.hold).toBe(true);
    expect(stalled.actions).toEqual([{ type: "notify", level: "warning", message: "ctx-go paused: no progress" }]);
  });

  it("continues when the frontier changes, and pauses on an operator mark", () => {
    const started = onApproved({ ...freshState(), armed: true }, snap(), "d1");
    const moved = onTurn(started.state, snap({ frontierIds: [], destinationText: "Build the app." }), doneTurn);
    expect(moved.state.phase).toBe("work");
    expect(moved.actions[0]).toMatchObject({ type: "prompt", text: workPrompt("Build the app.") });
    expect(workPrompt("Build the app.")).not.toContain("Claim the destination is met");
    const marked = onTurn(started.state, snap({ frontierIds: [], askIds: ["q9"], askHeadlines: ["confirm"] }), doneTurn);
    expect(marked.actions[0]).toMatchObject({ type: "notify" });
    expect(String((marked.actions[0] as { message: string }).message)).toContain("q9");
  });

  it("judges only from the claim phase, and the second rejection pauses", () => {
    const empty = snap({ frontierIds: [], destinationText: "Build the app.", sessionTip: "tip" });
    let state = onApproved({ ...freshState(), armed: true }, empty, "d1").state;
    state = onTurn(state, empty, doneTurn).state;
    expect(state.phase).toBe("work");
    const asked = onTurn(state, empty, { ...doneTurn, text: "Built the local web app." });
    expect(asked.actions[0]).toMatchObject({ type: "prompt", text: CLAIM_PROMPT });
    state = asked.state;
    expect(state.phase).toBe("claim");
    const claim = onTurn(state, empty, doneTurn);
    expect(claim.actions[0]).toMatchObject({ type: "judge" });
    const once = onJudge(claim.state, empty, { ok: true, done: false, summary: "missing product" });
    expect(once.state.rejections).toBe(1);
    expect(once.state.phase).toBe("work");
    expect(once.actions[0]).toMatchObject({ type: "prompt", text: rejectionPrompt("Build the app.", "missing product") });
    const listed = onTurn(once.state, empty, {
      ...doneTurn,
      text: "The CTX frontier is empty. There are no open questions. There is no question to settle.",
    });
    expect(listed.actions).toEqual([{ type: "notify", level: "warning", message: "ctx-go paused: no progress" }]);
    expect(listed.actions.some((action) => action.type === "judge")).toBe(false);
    const again = onJudge(
      { ...once.state, phase: "claim", lastClaim: "did the thing" },
      snap({ frontierIds: [] }),
      { ok: true, done: false, summary: "still no" },
    );
    expect(again.state.phase).toBe("paused");
    expect(again.state.rejections).toBe(2);
    expect(again.state.lastVerdict).toBe("still no");
    expect(again.actions[0]).toMatchObject({
      message: "Fail: still no\nctx-go paused: no product change\nWorker: did the thing\nJudge: missing product\nJudge: still no",
    });
    expect(again.state.verdictKind).toBe("rejection");
    expect(again.actions.some((action) => action.type === "record" && action.text.includes("Worker: did the thing") && action.text.includes("Judge: still no"))).toBe(true);
    const resumed = onGo(again.state, empty);
    expect(resumed.state.rejections).toBe(0);
    expect(resumed.state.lastVerdict).toBe("still no");
    expect(resumed.state.armed).toBe(true);
    const open = snap({ frontierIds: [], destinationText: "Build the app.", sessionTip: "tip" });
    const againOpen = onGo(again.state, open);
    expect(againOpen.state.rejections).toBe(0);
    expect(againOpen.state.lastVerdict).toBe("still no");
    expect(againOpen.actions[0]).toMatchObject({ type: "prompt", text: rejectionPrompt("Build the app.", "still no") });
  });

  it("a destination acceptance stays armed and a later project claim can finish", () => {
    const empty = snap({ frontierIds: [], destinationText: "Build the app." });
    const state = {
      ...freshState(),
      armed: true,
      phase: "claim" as const,
      approvedDestinationId: "d1",
      lastClaim: "the aim is met",
      lastVerdict: "old",
      verdictKind: "rejection" as const,
      rejections: 1,
    };
    const accepted = onJudge(state, empty, { ok: true, done: true, summary: "met" });
    expect(accepted.state.armed).toBe(true);
    expect(accepted.state.aimMet).toBe(true);
    expect(accepted.state.projectDone).toBe(false);
    expect(accepted.state.rejections).toBe(1);
    expect(accepted.state.phase).toBe("project");
    expect(accepted.actions[0]).toMatchObject({ type: "prompt", text: PROJECT_CLAIM_PROMPT });
    expect(accepted.actions.some((action) => action.type === "notify" && action.message.startsWith("ctx-go done"))).toBe(false);
    expect(accepted.actions.some((action) => action.type === "record" && action.text.startsWith("Pass: met") && action.text.includes("Judge: met"))).toBe(true);
    const openWork = onJudge(state, snap({ frontierIds: ["fork"], destinationText: "Build the app." }), { ok: true, done: true, summary: "met" });
    expect(openWork.state.projectDone).toBe(false);
    expect(openWork.state.phase).toBe("questions");
    expect(openWork.actions[0]).toEqual({ type: "claim", questionId: "fork" });
    expect(openWork.actions[1]).toMatchObject({ type: "prompt", text: QUESTION_PROMPT });
    const claimed = onTurn(accepted.state, empty, { ...doneTurn, text: "Done. `proj/src/app.ts`" });
    expect(claimed.actions[0]).toMatchObject({ type: "judge" });
    const finished = onJudge(claimed.state, empty, { ok: true, done: true, summary: "project met" });
    expect(finished.state.armed).toBe(false);
    expect(finished.state.projectDone).toBe(true);
    expect(finished.state.aimMet).toBe(true);
    expect(finished.actions[0]).toMatchObject({ type: "notify", message: "ctx-go done\nproject met" });
    expect(finished.actions[1]).toMatchObject({ type: "record", text: "Pass: project met\nWorker: Done. `proj/src/app.ts`\nJudge: project met" });
    const stopped = onGo(finished.state, empty);
    expect(stopped.state.armed).toBe(true);
    expect(stopped.state.projectDone).toBe(false);
    expect(stopped.state.phase).toBe("reconcile");
    expect(stopped.actions[0]).toMatchObject({ type: "prompt", text: RECONCILE_PROMPT });
    expect(stopped.actions.some((action) => action.type === "notify" && action.message.includes("already done"))).toBe(false);
    const rejected = onJudge(
      { ...claimed.state, rejections: 0 },
      empty,
      { ok: true, done: false, summary: "composer still owed" },
    );
    expect(rejected.state.armed).toBe(true);
    expect(rejected.state.phase).toBe("questions");
    expect(rejected.actions[0]).toMatchObject({
      type: "prompt",
      text: projectRejectionPrompt("Build the app.", "composer still owed"),
    });
    const erred = onJudge(claimed.state, empty, { ok: false, error: "no verdict" });
    const resumed = onGo({ ...erred.state, reconciledThrough: "tip" }, { ...empty, sessionTip: "tip" });
    expect(resumed.actions[0]).toMatchObject({ type: "prompt", text: projectErrorPrompt("Build the app.", "no verdict") });
    expect(String((resumed.actions[0] as { text: string }).text)).not.toContain("not met");
    expect(String((resumed.actions[0] as { text: string }).text)).not.toContain("destination's work");
  });

  it("does not reset the rejection count when the destination is accepted", () => {
    const empty = snap({ frontierIds: [], destinationText: "Build the app." });
    const accepted = onJudge(
      {
        ...freshState(),
        armed: true,
        phase: "claim",
        approvedDestinationId: "d1",
        rejections: 1,
        productStamp: "same",
        lastClaim: "aim",
      },
      empty,
      { ok: true, done: true, summary: "met" },
    );
    expect(accepted.state.rejections).toBe(1);
    const project = onTurn(accepted.state, empty, { ...doneTurn, text: "Done. `proj/src/app.ts`" });
    const rejected = onJudge(project.state, empty, { ok: true, done: false, summary: "still open" }, "same");
    expect(rejected.state.rejections).toBe(2);
    expect(rejected.state.phase).toBe("paused");
    expect(rejected.actions.some((action) => action.type === "notify" && action.message.includes("no product change"))).toBe(true);
  });

  it("states a pass or fail in one sentence and keeps the report", () => {
    const empty = snap({ frontierIds: [], destinationText: "Build the app." });
    const state = {
      ...freshState(),
      armed: true,
      phase: "claim" as const,
      approvedDestinationId: "d1",
      aimMet: true,
      lastClaim: "done `proj/.pi/foundations/first-questions.md`",
    };
    const passed = onJudge(state, empty, { ok: true, done: true, summary: "The app carries. The rest is detail." });
    expect(passed.actions[1]).toMatchObject({
      type: "record",
      text: "Pass: The app carries.\nWorker: done `proj/.pi/foundations/first-questions.md`\nJudge: The app carries. The rest is detail.",
    });
    const failed = onJudge(
      { ...state, aimMet: false, phase: "claim" },
      empty,
      { ok: true, done: false, summary: "The assignment never started. More follows." },
    );
    expect(failed.actions.some((action) => action.type === "record" && action.text.startsWith("Fail: The assignment never started."))).toBe(true);
    expect(failed.actions.some((action) => action.type === "record" && action.text.includes("Judge: The assignment never started. More follows."))).toBe(true);
  });

  it("a saved done clock starts again when the operator runs /ctx-go", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctx-go-done-"));
    const session = join(dir, "session.jsonl");
    writeClock(session, {
      ...freshState(),
      armed: true,
      phase: "idle",
      approvedDestinationId: "d1",
      aimMet: true,
      projectDone: true,
    });
    const loaded = readClock(session);
    expect(loaded.projectDone).toBe(true);
    expect(loaded.armed).toBe(false);
    const again = onGo(loaded, snap({ frontierIds: [], destinationText: "Build the app." }));
    expect(again.state.armed).toBe(true);
    expect(again.state.projectDone).toBe(false);
    expect(again.state.phase).toBe("reconcile");
    expect(again.actions).toEqual([{ type: "prompt", text: RECONCILE_PROMPT }]);
    const claimed = onTurn(again.state, snap({ frontierIds: [], destinationText: "Build the app.", sessionTip: "tip" }), doneTurn);
    expect(claimed.state.phase).toBe("project");
    expect(claimed.state.reconciledThrough).toBe("tip");
    expect(claimed.actions[0]).toMatchObject({ type: "prompt", text: PROJECT_CLAIM_PROMPT });
    const rolled = onTurn(again.state, snap({ frontierIds: ["fork"], destinationText: "Build the app.", sessionTip: "tip" }), doneTurn);
    expect(rolled.actions[0]).toEqual({ type: "claim", questionId: "fork" });
    expect(rolled.actions[1]).toMatchObject({ type: "prompt", text: QUESTION_PROMPT });
    const open = onGo(loaded, snap({ frontierIds: ["q9"], sessionTip: "tip" }));
    expect(open.state.phase).toBe("reconcile");
    const covered = onGo(
      { ...loaded, reconciledThrough: "tip" },
      snap({ frontierIds: ["q9"], sessionTip: "tip" }),
    );
    expect(covered.actions[0]).toEqual({ type: "claim", questionId: "q9" });
    expect(covered.actions[1]).toMatchObject({ type: "prompt", text: QUESTION_PROMPT });
  });

  it("keeps going when the named products change, and stops at ten", () => {
    const empty = snap({ frontierIds: [], destinationText: "Build the app." });
    const base = {
      ...freshState(),
      armed: true,
      phase: "claim" as const,
      approvedDestinationId: "d1",
      lastClaim: "first",
      rejections: 1,
      lastVerdict: "missing",
      priorVerdict: "missing",
      productStamp: "a",
      verdictKind: "rejection" as const,
    };
    const moved = onJudge(base, empty, { ok: true, done: false, summary: "still owed" }, "b");
    expect(moved.state.phase).toBe("work");
    expect(moved.state.rejections).toBe(2);
    expect(moved.state.productStamp).toBe("b");
    expect(moved.actions[0]).toMatchObject({ type: "prompt", text: rejectionPrompt("Build the app.", "still owed") });
    const capped = onJudge(
      { ...base, rejections: 9, productStamp: "a" },
      empty,
      { ok: true, done: false, summary: "tenth" },
      "b",
    );
    expect(capped.state.phase).toBe("paused");
    expect(capped.state.rejections).toBe(10);
    expect(String((capped.actions[0] as { message: string }).message)).toContain("Fail: tenth");
    expect(String((capped.actions[0] as { message: string }).message)).toContain("after 10 judge calls");
    expect(String((capped.actions[0] as { message: string }).message)).toContain("Judge: tenth");
    const finished = onJudge(
      { ...base, aimMet: true, rejections: 9, lastClaim: "done `proj/.pi/foundations/first-questions.md`" },
      empty,
      { ok: true, done: true, summary: "project met" },
      "b",
    );
    expect(finished.state.projectDone).toBe(true);
    expect(finished.actions[0]).toMatchObject({ type: "notify", message: "ctx-go done\nproject met" });
  });

  it("a judge error is not a rejection", () => {
    const state = { ...freshState(), armed: true, phase: "claim" as const, approvedDestinationId: "d1", rejections: 1 };
    const step = onJudge(state, snap({ frontierIds: [] }), { ok: false, error: "no verdict" });
    expect(step.state.rejections).toBe(1);
    expect(step.state.phase).toBe("questions");
    expect(step.state.hold).toBe(true);
    expect(step.state.lastVerdict).toBe("no verdict");
    expect(step.state.verdictKind).toBe("error");
    expect(step.state.phase).not.toBe("paused");
    expect(step.actions.some((action) => action.type === "record" && action.text.includes("Judge: no verdict"))).toBe(true);
    const resumed = onGo(
      { ...step.state, reconciledThrough: "tip" },
      snap({ frontierIds: [], destinationText: "Build the app.", sessionTip: "tip" }),
    );
    expect(resumed.state.rejections).toBe(1);
    expect(resumed.actions[0]).toMatchObject({ type: "prompt", text: judgeErrorPrompt("Build the app.", "no verdict") });
    expect(String((resumed.actions[0] as { text: string }).text)).not.toContain("not met");
  });

  it("a second /ctx-go does not forgive the first rejection", () => {
    const working = {
      ...freshState(),
      armed: true,
      phase: "questions" as const,
      approvedDestinationId: "d1",
      rejections: 1,
    };
    const again = onGo({ ...working, reconciledThrough: "tip" }, snap({ sessionTip: "tip" }));
    expect(again.state.rejections).toBe(1);
    expect(again.state.phase).toBe("questions");
  });

  it("does not treat question work as a destination draft, and does not follow a queued message", () => {
    const started = onApproved({ ...freshState(), armed: true }, snap(), "d1");
    const replaced = onTurn(started.state, snap({ destinationId: "other" }), doneTurn);
    expect(replaced.actions[0]).toMatchObject({ type: "notify" });
    expect(replaced.actions[1]).toMatchObject({ type: "prompt", text: DRAFT_PROMPT });
    expect(replaced.state.approvedDestinationId).toBeNull();
    const queued = onTurn(started.state, snap({ frontierIds: ["q2"] }), { ...doneTurn, pending: true });
    expect(queued.actions).toEqual([]);
    const queuedDraft = onTurn(started.state, snap({ destinationId: "other" }), { ...doneTurn, pending: true });
    expect(queuedDraft.actions).toEqual([]);
    expect(queuedDraft.state.phase).toBe("reconcile");
    expect(queuedDraft.state.approvedDestinationId).toBe("d1");
  });

  it("pauses a marked claim and names a blocked question", () => {
    const started = onApproved({ ...freshState(), armed: true }, snap(), "d1");
    const marked = onTurn(
      started.state,
      snap({ frontierIds: ["q2"], claimedId: "q9", askIds: ["q9"], askHeadlines: ["confirm"] }),
      doneTurn,
    );
    expect(marked.actions[0]).toMatchObject({ type: "notify" });
    const blocked = onTurn(
      started.state,
      snap({
        frontierIds: [],
        blocked: [{ id: "q3", headline: "wait", blockers: ["r1"] }],
      }),
      doneTurn,
    );
    expect(String((blocked.actions[0] as { message: string }).message)).toContain("r1");
    const claimed = onTurn(
      started.state,
      snap({ frontierIds: [], claimedId: "q3", blocked: [{ id: "q3", headline: "wait", blockers: ["r1"] }] }),
      doneTurn,
    );
    expect(String((claimed.actions[0] as { message: string }).message)).toContain("blocked by r1");
    const markedEarly = onTurn(
      started.state,
      snap({ askIds: ["q9"], askHeadlines: ["confirm"] }),
      doneTurn,
    );
    expect(String((markedEarly.actions[0] as { message: string }).message)).toContain("q9");
  });

  it("does not claim a not-built decision that has no question", () => {
    const owed = snap({ frontierIds: [], destinationText: "Build the app.", sessionTip: "m1", notBuiltOpen: true });
    const started = onGo({ ...freshState(), approvedDestinationId: "d1", aimMet: true }, owed);
    expect(started.state.phase).toBe("reconcile");
    expect(started.actions[0]).toMatchObject({ type: "prompt", text: RECONCILE_PROMPT });
    const tools = onTurn(started.state, owed, { ...doneTurn, toolCount: 1, text: "" });
    expect(tools.actions).toEqual([]);
    expect(tools.state.phase).toBe("reconcile");
    const stalled = onTurn(started.state, owed, doneTurn);
    expect(stalled.state.reconciledThrough).toBeNull();
    expect(stalled.actions).toEqual([{ type: "notify", level: "warning", message: "ctx-go paused: a not-built decision has no question" }]);
    const impasse = onTurn(started.state, owed, { ...doneTurn, text: "Impasse: the annotation question is blocked" });
    expect(impasse.state.reconciledThrough).toBeNull();
    expect(impasse.actions[0]).toMatchObject({ type: "notify", message: "ctx-go paused: the annotation question is blocked" });
    const covered = onTurn(
      started.state,
      snap({ frontierIds: ["q-annot"], destinationText: "Build the app.", sessionTip: "m2", notBuiltOpen: false }),
      doneTurn,
    );
    expect(covered.state.reconciledThrough).toBe("m2");
    expect(covered.actions[0]).toEqual({ type: "claim", questionId: "q-annot" });
    expect(covered.actions[1]).toMatchObject({ type: "prompt", text: QUESTION_PROMPT });
  });

  it("claims an unclaimed question instead of pausing", () => {
    const open = snap({ frontierIds: ["q1"], claimedId: null, destinationText: "Build the app.", sessionTip: "tip" });
    const started = onGo({ ...freshState(), approvedDestinationId: "d1", reconciledThrough: "tip" }, open);
    expect(started.actions[0]).toEqual({ type: "claim", questionId: "q1" });
    expect(started.actions[1]).toMatchObject({ type: "prompt", text: QUESTION_PROMPT });
    expect(started.state.lastFingerprint).toContain("q1|");
    const idle = {
      ...started.state,
      lastFingerprint: ["d1", "", "q1"].join("|"),
    };
    const again = onTurn(idle, open, doneTurn);
    expect(again.actions[0]).toEqual({ type: "claim", questionId: "q1" });
    expect(again.actions.some((action) => action.type === "notify")).toBe(false);
  });

  it("stop disarms and does not forget the approved destination", () => {
    const stopped = onStop({
      ...freshState(),
      armed: true,
      approvedDestinationId: "d1",
      rejections: 1,
      lastVerdict: "still no",
      verdictKind: "rejection",
    });
    expect(stopped.state.armed).toBe(false);
    expect(stopped.state.approvedDestinationId).toBe("d1");
    expect(stopped.state.rejections).toBe(1);
    expect(stopped.state.verdictKind).toBe("rejection");
    expect(stopped.state.lastVerdict).toBe("still no");
    const paused = onStop({ ...freshState(), phase: "paused", rejections: 2, approvedDestinationId: "d1" });
    expect(onGo(paused.state, snap()).state.rejections).toBe(0);
  });
});
