import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { foldLive } from "../../pi-ctx/src/fold.js";
import type { JudgmentRecord } from "../../pi-ctx/src/types.js";
import { readClock, writeClock } from "../src/clock.js";
import {
  buildConflictPacket,
  conflictStamp,
  formalConflicts,
  parseConflictPairs,
  shouldReadConflicts,
} from "../src/conflicts.js";
import { judgeArgv } from "../src/judge.js";
import { freshState, onConflictRead, onStop } from "../src/state.js";

function rec(id: string, headline: string, extra: Partial<JudgmentRecord> = {}): JudgmentRecord {
  return {
    id,
    type: "decision",
    ts: "2026-11-11T00:00:00.000Z",
    session: "s",
    headline,
    body: "",
    ...extra,
  };
}

describe("ctx-go contradiction read", () => {
  it("reads a new live set, pauses on a pair, and continues once that set was shown", () => {
    const live = foldLive([
      rec("a", "The judge finishes", { directive: "If the judge says done, the work is done." }),
      rec("b", "The operator finishes", { directive: "Only the operator Accept finishes." }),
      rec("old", "Retired", { directive: "gone" }),
      rec("c", "Same rule twice", { directive: "Keep the mic.", supersedes: ["old"] }),
    ]);
    const stamp = conflictStamp(live);
    expect(shouldReadConflicts(stamp, null, false)).toBe(true);
    expect(shouldReadConflicts(stamp, null, true)).toBe(false);
    const packet = buildConflictPacket(live);
    expect(packet.ok).toBe(true);
    if (packet.ok) {
      expect(packet.text).toContain("a");
      expect(packet.text).toContain("Only the operator Accept finishes.");
      expect(packet.text).not.toContain("### old ");
      expect(packet.text).toContain("same thing is not a pair");
    }
    const pairs = parseConflictPairs("pair: a b the judge cannot both finish and wait\npair: a old retired\npair: c c same", live);
    expect(pairs).toEqual([{ a: "a", b: "b", why: "the judge cannot both finish and wait" }]);
    const paused = onConflictRead(freshState(), stamp, { ok: true, pairs }, []);
    expect(paused.state.armed).toBe(false);
    expect(paused.state.conflictStamp).toBe(stamp);
    expect(paused.actions[0]).toMatchObject({ type: "notify" });
    if (paused.actions[0]?.type === "notify") expect(paused.actions[0].message).toContain("pair a b");
    expect(shouldReadConflicts(stamp, paused.state.conflictStamp, false)).toBe(false);
    const failed = onConflictRead(freshState(), stamp, { ok: false, error: "no model" }, []);
    expect(failed.state.conflictStamp).toBe(null);
    expect(failed.actions[0]).toMatchObject({ message: "ctx-go paused: conflict read no model" });
    expect(shouldReadConflicts(stamp, failed.state.conflictStamp, false)).toBe(true);
  });

  it("lists a formal conflict even when the read says clear", () => {
    const live = foldLive([
      rec("parent", "Old rule"),
      rec("left", "One successor", { supersedes: ["parent"] }),
      rec("right", "Other successor", { supersedes: ["parent"] }),
    ]);
    expect(formalConflicts(live)).toEqual(["formal parent successors left right"]);
    const cleared = onConflictRead(freshState(), conflictStamp(live), { ok: true, pairs: [] }, formalConflicts(live));
    expect(cleared.state.armed).toBe(false);
    expect(cleared.actions[0]).toMatchObject({ type: "notify" });
    if (cleared.actions[0]?.type === "notify") expect(cleared.actions[0].message).toContain("formal parent successors left right");
  });

  it("keeps a shown set across stop and reload", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctx-go-conflict-"));
    const session = join(dir, "session.jsonl");
    const stopped = onStop({ ...freshState(), conflictStamp: "a,b" });
    expect(stopped.state.conflictStamp).toBe("a,b");
    writeClock(session, stopped.state);
    expect(readClock(session).conflictStamp).toBe("a,b");
  });

  it("gives the contradiction read no tools", () => {
    const argv = judgeArgv({ provider: "openai", id: "gpt" }, "list pairs", false);
    expect(argv).toContain("--no-tools");
    expect(argv).not.toContain("read,grep,find");
  });
});
