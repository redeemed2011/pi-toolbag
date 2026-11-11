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
  unresolved,
} from "../src/conflicts.js";
import { judgeArgv } from "../src/judge.js";
import { freshState, onConflictRead, onConflictsTurn, onStop } from "../src/state.js";

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
    const pairs = parseConflictPairs(
      "pair: a b the judge cannot both finish and wait\npair: a old retired\npair: c c same\npair: a b they do not contradict",
      live,
    );
    expect(pairs).toEqual([{ a: "a", b: "b", why: "the judge cannot both finish and wait" }]);
    const open = unresolved(pairs.map((pair) => `pair ${pair.a} ${pair.b} ${pair.why}`), live);
    const sent = onConflictRead(freshState(), stamp, { ok: true, pairs }, open);
    expect(sent.state.armed).toBe(true);
    expect(sent.state.phase).toBe("conflicts");
    expect(sent.state.conflictStamp).toBe(stamp);
    expect(sent.actions[0]).toMatchObject({ type: "notify", message: "ctx-go is resolving contradictions" });
    expect(sent.actions[1]).toMatchObject({ type: "prompt", display: false });
    if (sent.actions[1]?.type === "prompt") {
      expect(sent.actions[1].text).toContain("pair a b");
      expect(sent.actions[1].text).toContain("Do not ask the operator");
    }
    expect(shouldReadConflicts(stamp, sent.state.conflictStamp, false)).toBe(false);
    const failed = onConflictRead(freshState(), stamp, { ok: false, error: "no model" }, []);
    expect(failed.state.conflictStamp).toBe(null);
    expect(failed.actions[0]).toMatchObject({ message: "ctx-go paused: conflict read no model" });
    expect(shouldReadConflicts(stamp, failed.state.conflictStamp, false)).toBe(true);
  });

  it("sends one line per distinct rule and keeps a long one", () => {
    const live = foldLive([
      rec("a", "Keep the mic", { directive: "Keep the mic." }),
      rec("b", "Keep the mic again", { directive: "Keep the mic." }),
      rec("c", "Stop the mic", { directive: "Turn the mic off." }),
      rec("d", "Essay", { directive: `start ${"x".repeat(400)} end` }),
    ]);
    const packet = buildConflictPacket(live);
    expect(packet.ok).toBe(true);
    if (!packet.ok) return;
    expect(packet.text).toContain("a decision Keep the mic — Keep the mic.");
    expect(packet.text).not.toContain("b decision");
    expect(packet.text).toContain("Turn the mic off.");
    expect(packet.text).toContain(`start ${"x".repeat(400)} end`);
  });

  it("leaves out records that do not state a rule", () => {
    const live = foldLive([
      rec("law", "Keep the mic", { type: "constraint", directive: "Keep the mic." }),
      rec("aim", "Build it", { type: "destination", body: "Build the app." }),
      rec("skip", "No tour", { type: "out_of_scope", body: "No tour." }),
      rec("note", "Worker note", { type: "finding", body: "The mic was seen." }),
      rec("gone", "Retired", { type: "tombstone", body: "Old mic rule." }),
      rec("cite", "Cites the file", { type: "citation", body: "See the file." }),
      rec("file", "The file", { type: "evidence", body: "hash" }),
    ]);
    const packet = buildConflictPacket(live);
    expect(packet.ok).toBe(true);
    if (!packet.ok) return;
    expect(packet.text).toContain("law constraint");
    expect(packet.text).toContain("aim destination");
    expect(packet.text).toContain("skip out_of_scope");
    expect(packet.text).not.toContain("note");
    expect(packet.text).not.toContain("gone");
    expect(packet.text).not.toContain("cite");
    expect(packet.text).not.toContain("file");
    const withNote = conflictStamp(live);
    const without = conflictStamp(
      foldLive([
        rec("law", "Keep the mic", { type: "constraint", directive: "Keep the mic." }),
        rec("aim", "Build it", { type: "destination", body: "Build the app." }),
        rec("skip", "No tour", { type: "out_of_scope", body: "No tour." }),
      ]),
    );
    expect(withNote).toBe(without);
  });

  it("lists a formal conflict even when the read says clear", () => {
    const live = foldLive([
      rec("parent", "Old rule"),
      rec("left", "One successor", { supersedes: ["parent"] }),
      rec("right", "Other successor", { supersedes: ["parent"] }),
    ]);
    expect(formalConflicts(live)).toEqual(["formal parent successors left right"]);
    const formal = formalConflicts(live);
    const sent = onConflictRead(freshState(), conflictStamp(live), { ok: true, pairs: [] }, formal);
    expect(sent.state.armed).toBe(true);
    expect(sent.actions[0]).toMatchObject({ type: "notify", message: "ctx-go is resolving contradictions" });
    if (sent.actions[1]?.type === "prompt") expect(sent.actions[1].text).toContain("formal parent successors left right");
    const noted = foldLive([
      rec("parent", "Old rule"),
      rec("left", "One successor", { supersedes: ["parent"] }),
      rec("right", "Other successor", { supersedes: ["parent"] }),
      rec("note", "Settled", { type: "finding", body: "left and right do not contradict" }),
    ]);
    expect(unresolved(["pair left right two successors"], noted)).toEqual([]);
    const done = onConflictsTurn(
      sent.state,
      { bound: true, destinationId: "d", frontierIds: [], claimedId: null, askIds: [], askHeadlines: [], blocked: [] },
      { outcome: "completed", toolCount: 0, pending: false, text: "recorded" },
      [],
    );
    expect(done.state.conflictOpen).toEqual([]);
    expect(done.state.phase).not.toBe("conflicts");
    const stuck = { ...sent.state, statusReports: 1 };
    const paused = onConflictsTurn(
      stuck,
      { bound: true, destinationId: "d", frontierIds: [], claimedId: null, askIds: [], askHeadlines: [], blocked: [] },
      { outcome: "completed", toolCount: 0, pending: false, text: "still looking" },
      sent.state.conflictOpen,
    );
    expect(paused.state.armed).toBe(false);
    expect(paused.actions[0]).toMatchObject({ type: "notify", message: "ctx-go paused: contradictions were not resolved" });
    if (paused.actions[0]?.type === "notify") expect(paused.actions[0].message).not.toContain("pair");
  });

  it("keeps a shown set across stop and reload", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctx-go-conflict-"));
    const session = join(dir, "session.jsonl");
    const stopped = onStop({ ...freshState(), conflictStamp: "a,b", conflictOpen: ["pair a b why"], phase: "conflicts" });
    expect(stopped.state.conflictStamp).toBe("a,b");
    expect(stopped.state.conflictOpen).toEqual(["pair a b why"]);
    writeClock(session, stopped.state);
    expect(readClock(session).conflictStamp).toBe("a,b");
    expect(readClock(session).conflictOpen).toEqual(["pair a b why"]);
  });

  it("gives the contradiction read no tools", () => {
    const argv = judgeArgv({ provider: "openai", id: "gpt" }, "list pairs", false);
    expect(argv).toContain("--no-tools");
    expect(argv).not.toContain("read,grep,find");
  });
});
