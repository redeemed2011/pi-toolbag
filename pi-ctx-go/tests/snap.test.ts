import { describe, expect, it } from "vitest";
import type { JudgmentRecord, LiveSet } from "../../pi-ctx/src/types.js";
import { destinationContext, unresolvedNotBuilt } from "../src/snap.js";

function record(partial: Pick<JudgmentRecord, "id" | "type" | "ts" | "headline" | "body"> & Partial<JudgmentRecord>): JudgmentRecord {
  return { session: "s", ...partial };
}

function live(records: JudgmentRecord[], liveIds: string[]): LiveSet {
  return {
    byId: new Map(records.map((rec) => [rec.id, rec])),
    live: new Set(liveIds),
    constraints: records.filter((rec) => rec.type === "constraint"),
    questions: records.filter((rec) => rec.type === "question"),
    destinations: records.filter((rec) => rec.type === "destination"),
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

describe("destination context", () => {
  it("uses the live project, not the first two lines of a destination record", () => {
    const text = destinationContext(
      live(
        [
          record({
            id: "d1",
            type: "destination",
            ts: "2026-11-02T00:00:00.000Z",
            headline: "Approved destination",
            body: "",
            directive: "Ship the marker.\nKeep it short.\nIgnore this third line.",
          }),
          record({
            id: "c1",
            type: "constraint",
            ts: "2026-11-01T00:00:00.000Z",
            headline: "Stay bound",
            body: "",
            directive: "Work only while CTX is bound.",
          }),
          record({ id: "f1", type: "finding", ts: "2026-11-03T00:00:00.000Z", headline: "A note", body: "not part of the destination" }),
        ],
        ["d1", "c1", "f1"],
      ),
    );
    expect(text).toContain("constraint: Stay bound\nWork only while CTX is bound.");
    expect(text).toContain("Ignore this third line.");
    expect(text).not.toContain("not part of the destination");
    expect(text.indexOf("Stay bound")).toBeLessThan(text.indexOf("Approved destination"));
  });
});
