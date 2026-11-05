import { describe, expect, it } from "vitest";
import { CLAIM_PROMPT, DRAFT_PROMPT, QUESTION_PROMPT, rejectionPrompt, workPrompt } from "../src/prompts.js";
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
    expect(approved.actions[0]).toMatchObject({ type: "prompt", text: QUESTION_PROMPT });
  });

  it("does not continue a tool turn, and the next unchanged turn pauses", () => {
    const started = onApproved({ ...freshState(), armed: true }, snap(), "d1");
    const tools = onTurn(started.state, snap(), { ...doneTurn, toolCount: 2, text: "" });
    expect(tools.actions).toEqual([]);
    expect(tools.state.phase).toBe("questions");
    const stalled = onTurn(tools.state, snap(), doneTurn);
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
    const empty = snap({ frontierIds: [], destinationText: "Build the app." });
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
    const resumed = onGo(again.state, snap());
    expect(resumed.state.rejections).toBe(0);
    expect(resumed.state.armed).toBe(true);
  });

  it("a judge error is not a rejection", () => {
    const state = { ...freshState(), armed: true, phase: "claim" as const, approvedDestinationId: "d1", rejections: 1 };
    const step = onJudge(state, snap({ frontierIds: [] }), { ok: false, error: "no verdict" });
    expect(step.state.rejections).toBe(1);
    expect(step.state.phase).toBe("questions");
    expect(step.state.hold).toBe(true);
  });

  it("a second /ctx-go does not forgive the first rejection", () => {
    const working = {
      ...freshState(),
      armed: true,
      phase: "questions" as const,
      approvedDestinationId: "d1",
      rejections: 1,
    };
    const again = onGo(working, snap());
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
    expect(queuedDraft.state.phase).toBe("questions");
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

  it("stop disarms and does not forget the approved destination", () => {
    const stopped = onStop({ ...freshState(), armed: true, approvedDestinationId: "d1", rejections: 1 });
    expect(stopped.state.armed).toBe(false);
    expect(stopped.state.approvedDestinationId).toBe("d1");
    expect(stopped.state.rejections).toBe(1);
    const paused = onStop({ ...freshState(), phase: "paused", rejections: 2, approvedDestinationId: "d1" });
    expect(onGo(paused.state, snap()).state.rejections).toBe(0);
  });
});
