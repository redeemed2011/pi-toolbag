import { describe, expect, it } from "vitest";
import type { JudgmentRecord, LiveSet } from "../../pi-ctx/src/types.js";
import { unresolvedNotBuilt } from "../src/snap.js";

function record(partial: Pick<JudgmentRecord, "id" | "type" | "ts" | "headline" | "body">): JudgmentRecord {
  return { session: "s", ...partial };
}

function live(records: JudgmentRecord[], liveIds: string[]): LiveSet {
  return {
    byId: new Map(records.map((rec) => [rec.id, rec])),
    live: new Set(liveIds),
    constraints: [],
    questions: [],
    destinations: [],
    outOfScope: [],
    fog: [],
    pendingReplaces: [],
    blocked: new Set(),
    askOperator: new Set(),
    liveConflict: [],
  };
}

describe("not-built decisions", () => {
  it("stays open until a question is recorded at or after it", () => {
    const decision = record({
      id: "d",
      type: "decision",
      ts: "2026-11-09T19:01:21.837Z",
      headline: "Dev-mode annotation",
      body: "Not built.",
    });
    expect(unresolvedNotBuilt(live([decision], ["d"]))).toBe(true);
    const earlier = record({
      id: "q-old",
      type: "question",
      ts: "2026-11-09T18:19:17.986Z",
      headline: "Fork",
      body: "Fork a master.",
    });
    expect(unresolvedNotBuilt(live([decision, earlier], ["d"]))).toBe(true);
    const later = record({
      id: "q",
      type: "question",
      ts: "2026-11-09T19:20:25.150Z",
      headline: "Build point-and-comment",
      body: "While development is on.",
    });
    expect(unresolvedNotBuilt(live([decision, later], ["d"]))).toBe(false);
    expect(unresolvedNotBuilt(live([decision, later], ["d", "q"]))).toBe(false);
  });
});
