import { describe, expect, it } from "vitest";
import { CLAIM_PROMPT, DRAFT_PROMPT, QUESTION_PROMPT } from "../src/prompts.js";
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
    expect(step.actions[0]).toMatchObject({ type: "notify" });
  });

  it("starts by asking for a draft, then for approval", () => {
    const started = onGo(freshState(), snap({ destinationId: null }));
    expect(started.state.phase).toBe("draft");
    expect(started.actions[0]).toMatchObject({ type: "prompt", text: DRAFT_PROMPT });
    const drafted = onTurn(started.state, snap({ destinationId: null }), { ...doneTurn, text: "Ship the marker.\nKeep it short.\nIgnore." });
    expect(drafted.actions[0]).toMatchObject({ type: "approve", text: "Ship the marker.\nKeep it short." });
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
    const moved = onTurn(started.state, snap({ frontierIds: [] }), doneTurn);
    expect(moved.actions[0]).toMatchObject({ type: "prompt", text: CLAIM_PROMPT });
    const marked = onTurn(started.state, snap({ frontierIds: [], askIds: ["q9"], askHeadlines: ["confirm"] }), doneTurn);
    expect(marked.actions[0]).toMatchObject({ type: "notify" });
    expect(String((marked.actions[0] as { message: string }).message)).toContain("q9");
  });

  it("judges only from the claim phase, and the second rejection pauses", () => {
    let state = onApproved({ ...freshState(), armed: true }, snap({ frontierIds: [] }), "d1").state;
    state = onTurn(state, snap({ frontierIds: [] }), doneTurn).state;
    expect(state.phase).toBe("claim");
    const claim = onTurn(state, snap({ frontierIds: [] }), doneTurn);
    expect(claim.actions[0]).toMatchObject({ type: "judge" });
    const once = onJudge(claim.state, snap({ frontierIds: [] }), { ok: true, done: false, summary: "missing product" });
    expect(once.state.rejections).toBe(1);
    expect(once.actions[0]).toMatchObject({ type: "prompt" });
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
    expect(replaced.actions[0]).toMatchObject({ type: "prompt", text: DRAFT_PROMPT });
    expect(replaced.state.approvedDestinationId).toBeNull();
    const queued = onTurn(started.state, snap({ frontierIds: ["q2"] }), { ...doneTurn, pending: true });
    expect(queued.actions).toEqual([]);
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
  });

  it("stop disarms and does not forget the approved destination", () => {
    const stopped = onStop({ ...freshState(), armed: true, approvedDestinationId: "d1", rejections: 1 });
    expect(stopped.state.armed).toBe(false);
    expect(stopped.state.approvedDestinationId).toBe("d1");
  });
});
