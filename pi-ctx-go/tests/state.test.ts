import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readClock, writeClock } from "../src/clock.js";
import {
  CLAIM_PROMPT,
  DRAFT_PROMPT,
  OUTCOMES_PROMPT,
  PROJECT_CLAIM_PROMPT,
  QUESTION_PROMPT,
  RECONCILE_PROMPT,
  judgeErrorPrompt,
  projectErrorPrompt,
  projectRejectionPrompt,
  rejectionPrompt,
  workPrompt,
} from "../src/prompts.js";
import { freshState, onAccept, onApproved, onGo, onImpasseJudge, onJudge, onNotDone, onStop, onTurn, type Snap } from "../src/state.js";

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
  it("asks for a full product path", () => {
    expect(CLAIM_PROMPT).toContain("full path");
    expect(CLAIM_PROMPT).toContain("relative to this session");
    expect(PROJECT_CLAIM_PROMPT).toContain("full path");
    expect(PROJECT_CLAIM_PROMPT).toContain("slash command is not a path");
  });

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

  it("does not advance when the turn says the goal is in place", () => {
    const phrase = "The goal is in place.";
    const empty = snap({ frontierIds: [], destinationText: "Build the app.", sessionTip: "tip" });
    const started = onApproved({ ...freshState(), armed: true }, empty, "d1");
    const reconcile = onTurn(started.state, empty, { ...doneTurn, text: phrase });
    expect(reconcile.state.phase).toBe("reconcile");
    expect(reconcile.state.reconciledThrough).toBeNull();
    const working = onTurn(started.state, empty, doneTurn).state;
    const work = onTurn(working, empty, { ...doneTurn, text: phrase });
    expect(work.state.phase).toBe("work");
    expect(work.actions.some((action) => action.type === "judge")).toBe(false);
  });

  it("does not advance when the turn says the outcomes are not proven", () => {
    const phrase = "The outcomes are not proven.";
    const empty = snap({ frontierIds: [], destinationText: "Build the app.", sessionTip: "tip" });
    const started = onApproved({ ...freshState(), armed: true }, empty, "d1");
    const reconcile = onTurn(started.state, empty, { ...doneTurn, text: phrase });
    expect(reconcile.state.phase).toBe("reconcile");
    expect(reconcile.state.reconciledThrough).toBeNull();
    const working = onTurn(started.state, empty, doneTurn).state;
    const work = onTurn(working, empty, { ...doneTurn, text: phrase });
    expect(work.state.phase).toBe("work");
    expect(work.actions.some((action) => action.type === "judge")).toBe(false);
  });

  it("does not advance when the turn says the model is checking", () => {
    const phrase = "The model is checking.";
    const empty = snap({ frontierIds: [], destinationText: "Build the app.", sessionTip: "tip" });
    const started = onApproved({ ...freshState(), armed: true }, empty, "d1");
    const reconcile = onTurn(started.state, empty, { ...doneTurn, text: phrase });
    expect(reconcile.state.phase).toBe("reconcile");
    expect(reconcile.state.reconciledThrough).toBeNull();
    const working = onTurn(started.state, empty, doneTurn).state;
    const work = onTurn(working, empty, { ...doneTurn, text: phrase });
    expect(work.state.phase).toBe("work");
    expect(work.actions.some((action) => action.type === "judge")).toBe(false);
  });

  it("does not finish reconcile on a status report", () => {
    const empty = snap({ frontierIds: [], destinationText: "Build the app.", sessionTip: "tip" });
    const started = onApproved({ ...freshState(), armed: true }, empty, "d1");
    const status =
      "The one-sentence goal is in place, but the other recorded outcomes are not all proven. I am checking those against what is actually running.";
    const step = onTurn(started.state, empty, { ...doneTurn, text: status });
    expect(step.state.phase).toBe("reconcile");
    expect(step.state.reconciledThrough).toBeNull();
    expect(step.actions.some((action) => action.type === "judge")).toBe(false);
  });

  it("resets the status-report count when the turn changed something", () => {
    const phrase = "The model is checking.";
    const empty = snap({ frontierIds: [], destinationText: "Build the app.", sessionTip: "tip" });
    let state = onApproved({ ...freshState(), armed: true }, empty, "d1").state;
    state = onTurn(state, empty, doneTurn).state;
    const first = onTurn(state, empty, { ...doneTurn, text: phrase });
    expect(first.state.statusReports).toBe(1);
    expect(first.actions[0]).toMatchObject({ type: "prompt" });
    const moved = snap({ frontierIds: [], claimedId: "q9", destinationText: "Build the app.", sessionTip: "tip" });
    const changed = onTurn(first.state, moved, { ...doneTurn, text: phrase });
    expect(changed.state.statusReports).toBe(0);
    expect(changed.actions[0]).toMatchObject({ type: "prompt" });
    const again = onTurn(changed.state, moved, { ...doneTurn, text: phrase });
    expect(again.state.statusReports).toBe(1);
    expect(again.actions[0]).toMatchObject({ type: "prompt" });
    const repeated = onTurn(again.state, moved, { ...doneTurn, text: phrase });
    expect(repeated.actions).toEqual([{ type: "notify", level: "warning", message: "ctx-go paused: no progress" }]);
  });

  it("sends a status report back to the work and pauses only when it is repeated", () => {
    const empty = snap({ frontierIds: [], destinationText: "Build the app.", sessionTip: "tip" });
    const status =
      "The one-sentence goal is in place, but the other recorded outcomes are not all proven. I am checking those against what is actually running.";
    let state = onApproved({ ...freshState(), armed: true }, empty, "d1").state;
    state = onTurn(state, empty, doneTurn).state;
    expect(state.phase).toBe("work");
    const first = onTurn(state, empty, { ...doneTurn, text: status });
    expect(first.state.phase).toBe("work");
    expect(first.state.statusReports).toBe(1);
    expect(first.actions.some((action) => action.type === "judge")).toBe(false);
    expect(String((first.actions[0] as { text: string }).text)).toContain("Do not say you are checking");
    const second = onTurn(first.state, empty, { ...doneTurn, text: status });
    expect(second.state.phase).toBe("work");
    expect(second.actions).toEqual([{ type: "notify", level: "warning", message: "ctx-go paused: no progress" }]);
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
    const waiting = onJudge(state, empty, { ok: true, done: true, summary: "met" });
    expect(waiting.state.armed).toBe(true);
    expect(waiting.state.aimMet).toBe(false);
    expect(waiting.state.projectDone).toBe(false);
    expect(waiting.state.awaitingAccept).toBe(true);
    expect(waiting.state.phase).toBe("paused");
    expect(waiting.actions.some((action) => action.type === "notify" && action.message.startsWith("ctx-go done"))).toBe(false);
    expect(waiting.actions.some((action) => action.type === "accept" && action.summary === "met")).toBe(true);
    expect(waiting.actions.some((action) => action.type === "record" && action.text.startsWith("Pass: met") && action.text.includes("Judge: met"))).toBe(true);
    const skipped = onGo(waiting.state, empty);
    expect(skipped.state.aimMet).toBe(false);
    expect(skipped.actions[0]).toMatchObject({ type: "accept", summary: "met" });
    const accepted = onAccept(waiting.state, empty);
    expect(accepted.state.aimMet).toBe(true);
    expect(accepted.state.projectDone).toBe(false);
    expect(accepted.state.awaitingAccept).toBe(false);
    expect(accepted.state.phase).toBe("outcomes");
    expect(accepted.actions[0]).toMatchObject({ type: "prompt", text: OUTCOMES_PROMPT });
    expect(accepted.actions.some((action) => action.type === "judge")).toBe(false);
    const openWork = onAccept(
      onJudge(state, snap({ frontierIds: ["fork"], destinationText: "Build the app." }), { ok: true, done: true, summary: "met" }).state,
      snap({ frontierIds: ["fork"], destinationText: "Build the app." }),
    );
    expect(openWork.state.projectDone).toBe(false);
    expect(openWork.state.phase).toBe("questions");
    expect(openWork.actions[0]).toEqual({ type: "claim", questionId: "fork" });
    expect(openWork.actions[1]).toMatchObject({ type: "prompt", text: QUESTION_PROMPT });
    const declined = onNotDone(waiting.state, empty, "the copy stays down");
    expect(declined.state.awaitingAccept).toBe(false);
    expect(declined.state.aimMet).toBe(false);
    expect(declined.state.obligation).toBe("the copy stays down");
    expect(onNotDone(waiting.state, empty, "  ").state.awaitingAccept).toBe(true);
    const ready = onTurn(accepted.state, empty, doneTurn);
    expect(ready.state.phase).toBe("project");
    expect(ready.state.outcomesAsked).toBe(true);
    expect(ready.actions[0]).toMatchObject({ type: "prompt", text: PROJECT_CLAIM_PROMPT });
    const claimed = onTurn(ready.state, empty, {
      ...doneTurn,
      text: "Done. /tmp/app.ts /tmp/proj/.pi/foundations/first-questions.md",
    });
    expect(claimed.actions[0]).toMatchObject({ type: "judge" });
    const projectWait = onJudge(claimed.state, empty, { ok: true, done: true, summary: "project met" });
    expect(projectWait.state.projectDone).toBe(false);
    expect(projectWait.state.awaitingAccept).toBe(true);
    const finished = onAccept(projectWait.state, empty);
    expect(finished.state.armed).toBe(false);
    expect(finished.state.projectDone).toBe(true);
    expect(finished.state.aimMet).toBe(true);
    expect(finished.actions[0]).toMatchObject({ type: "notify", message: "ctx-go done\nproject met" });
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
    const waiting = onJudge(
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
    expect(waiting.state.rejections).toBe(1);
    const accepted = onAccept(waiting.state, empty);
    expect(accepted.state.rejections).toBe(1);
    const ready = onTurn(accepted.state, empty, doneTurn);
    const project = onTurn(ready.state, empty, {
      ...doneTurn,
      text: "Done. /tmp/app.ts /tmp/proj/.pi/foundations/first-questions.md",
    });
    const rejected = onJudge(project.state, empty, { ok: true, done: false, summary: "still open" }, "same");
    expect(rejected.state.rejections).toBe(2);
    expect(rejected.state.phase).toBe("paused");
    expect(rejected.actions.some((action) => action.type === "notify" && action.message.includes("no product change"))).toBe(true);
  });

  it("sends a status report during the outcomes turn back to that turn", () => {
    const empty = snap({ frontierIds: [], destinationText: "Build the app." });
    const accepted = onAccept(
      onJudge(
        { ...freshState(), armed: true, phase: "claim", approvedDestinationId: "d1", lastClaim: "aim" },
        empty,
        { ok: true, done: true, summary: "met" },
      ).state,
      empty,
    );
    const report = onTurn(accepted.state, empty, { ...doneTurn, text: "The goal is in place." });
    expect(report.state.outcomesAsked).toBe(false);
    expect(report.state.phase).toBe("outcomes");
    expect(report.actions.some((action) => action.type === "judge")).toBe(false);
    expect(String((report.actions[0] as { text: string }).text)).toContain("first-questions.md");
    expect(String((report.actions[0] as { text: string }).text)).not.toContain("Name the result of the project");
    const again = onTurn(report.state, empty, { ...doneTurn, text: "The goal is in place." });
    expect(again.state.outcomesAsked).toBe(false);
    expect(again.actions.some((action) => action.type === "judge")).toBe(false);
    expect(again.actions[0]).toMatchObject({ type: "notify", message: "ctx-go paused: no progress" });
  });

  it("records owed outcomes before a project claim, and a claim that misses the file does not call the judge", () => {
    const empty = snap({ frontierIds: [], destinationText: "Build the app." });
    const waiting = onJudge(
      { ...freshState(), armed: true, phase: "claim", approvedDestinationId: "d1", lastClaim: "aim" },
      empty,
      { ok: true, done: true, summary: "met" },
    );
    const accepted = onAccept(waiting.state, empty);
    expect(accepted.state.phase).toBe("outcomes");
    expect(accepted.actions.some((action) => action.type === "judge")).toBe(false);
    const tools = onTurn(accepted.state, empty, { ...doneTurn, toolCount: 1, text: "recorded" });
    expect(tools.actions).toEqual([]);
    expect(tools.state.phase).toBe("outcomes");
    expect(tools.state.outcomesAsked).toBe(false);
    const owed = onTurn(
      accepted.state,
      snap({ frontierIds: ["owed"], destinationText: "Build the app." }),
      doneTurn,
    );
    expect(owed.state.outcomesAsked).toBe(true);
    expect(owed.actions[0]).toEqual({ type: "claim", questionId: "owed" });
    const none = onTurn(accepted.state, empty, { ...doneTurn, text: "Nothing is still owed. The project is done." });
    expect(none.actions.some((action) => action.type === "judge")).toBe(false);
    expect(none.state.phase).toBe("project");
    const relative = onTurn(none.state, empty, {
      ...doneTurn,
      text: "Done. proj/.pi/foundations/first-questions.md",
    });
    expect(relative.actions.some((action) => action.type === "judge")).toBe(false);
    expect(relative.actions[0]).toMatchObject({
      type: "notify",
      message: "ctx-go paused: the project claim did not name first-questions.md",
    });
    const named = onTurn(relative.state, empty, {
      ...doneTurn,
      text: "Done. /home/bo/src/app/.pi/foundations/first-questions.md",
    });
    expect(named.actions[0]).toMatchObject({
      type: "judge",
      claim: "Done. /home/bo/src/app/.pi/foundations/first-questions.md",
    });
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
    expect(passed.state.projectDone).toBe(false);
    expect(passed.actions.some((action) => action.type === "record" && action.text === "Pass: The app carries.\nWorker: done `proj/.pi/foundations/first-questions.md`\nJudge: The app carries. The rest is detail.")).toBe(true);
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
    const asked = onTurn(again.state, snap({ frontierIds: [], destinationText: "Build the app.", sessionTip: "tip" }), doneTurn);
    expect(asked.state.phase).toBe("outcomes");
    expect(asked.state.reconciledThrough).toBe("tip");
    expect(asked.actions[0]).toMatchObject({ type: "prompt", text: OUTCOMES_PROMPT });
    const claimed = onTurn(asked.state, snap({ frontierIds: [], destinationText: "Build the app.", sessionTip: "tip" }), doneTurn);
    expect(claimed.state.phase).toBe("project");
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
      { ...base, aimMet: true, rejections: 9, lastClaim: "done /tmp/app.ts" },
      empty,
      { ok: true, done: true, summary: "project met" },
      "b",
    );
    expect(finished.state.projectDone).toBe(false);
    expect(finished.state.awaitingAccept).toBe(true);
    expect(finished.actions.some((action) => action.type === "notify" && action.message.startsWith("ctx-go done"))).toBe(false);
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
    expect(impasse.state.hold).toBe(false);
    expect(impasse.state.phase).toBe("reconcile");
    expect(impasse.actions).toEqual([
      { type: "judge", claim: "Impasse: the annotation question is blocked", review: "impasse" },
    ]);
    const covered = onTurn(
      started.state,
      snap({ frontierIds: ["q-annot"], destinationText: "Build the app.", sessionTip: "m2", notBuiltOpen: false }),
      doneTurn,
    );
    expect(covered.state.reconciledThrough).toBe("m2");
    expect(covered.actions[0]).toEqual({ type: "claim", questionId: "q-annot" });
    expect(covered.actions[1]).toMatchObject({ type: "prompt", text: QUESTION_PROMPT });
  });

  it("reviews an impasse before pausing", () => {
    const owed = snap({ frontierIds: [], destinationText: "Build the app.", sessionTip: "m1", notBuiltOpen: true });
    const started = onGo({ ...freshState(), approvedDestinationId: "d1" }, owed);
    const impasse = onTurn(started.state, owed, { ...doneTurn, text: "Impasse: the annotation question is blocked" });
    expect(impasse.actions.some((action) => action.type === "notify")).toBe(false);
    expect(impasse.state.rejections).toBe(0);
    const through = onImpasseJudge(impasse.state, owed, { ok: true, through: true, summary: "record the annotation question" });
    expect(through.state.phase).toBe("reconcile");
    expect(through.state.reconciledThrough).toBeNull();
    expect(through.state.rejections).toBe(0);
    expect(through.state.hold).toBe(false);
    expect(through.actions[0]).toMatchObject({ type: "prompt" });
    expect(String((through.actions[0] as { text: string }).text)).toContain("record the annotation question");
    expect(String((through.actions[0] as { text: string }).text)).toContain("The judge found a way through:");
    expect(through.actions.some((action) => action.type === "notify" || action.type === "approve")).toBe(false);
    const agreed = onImpasseJudge(impasse.state, owed, { ok: true, through: false, summary: "the annotation question is already blocked" });
    expect(agreed.state.hold).toBe(true);
    expect(agreed.state.reconciledThrough).toBeNull();
    expect(agreed.state.verdictKind).not.toBe("error");
    expect(agreed.state.rejections).toBe(0);
    expect(agreed.actions).toEqual([
      { type: "notify", level: "warning", message: "ctx-go paused: the annotation question is already blocked" },
    ]);
    expect(String((agreed.actions[0] as { message: string }).message)).not.toContain("Ask the operator");
    const erred = onImpasseJudge(impasse.state, owed, { ok: false, error: "no verdict" });
    expect(erred.state.hold).toBe(true);
    expect(erred.state.verdictKind).toBe("error");
    expect(erred.state.rejections).toBe(0);
    expect(erred.state.reconciledThrough).toBeNull();
    expect(erred.actions).toEqual([{ type: "notify", level: "warning", message: "ctx-go paused: no verdict" }]);
    expect(String((erred.actions[0] as { message: string }).message)).not.toContain("already blocked");
    expect(String((erred.actions[0] as { message: string }).message)).not.toContain("Ask the operator");
    expect(erred.actions.some((action) => action.type === "prompt")).toBe(false);
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
