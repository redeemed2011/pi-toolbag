import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clockPath, readClock, writeClock } from "../src/clock.js";
import { freshState } from "../src/state.js";

describe("ctx-go clock", () => {
  it("reloads disarmed and keeps the approved destination", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctx-go-clock-"));
    const session = join(dir, "session.jsonl");
    writeClock(session, {
      ...freshState(),
      armed: true,
      phase: "paused",
      rejections: 2,
      approvedDestinationId: "d1",
      lastClaim: "did the thing",
      lastVerdict: "still no",
      verdictKind: "rejection",
    });
    const stored = JSON.parse(readFileSync(clockPath(session), "utf8")) as { armed: boolean };
    expect(stored.armed).toBe(false);
    const loaded = readClock(session);
    expect(loaded.armed).toBe(false);
    expect(loaded.hold).toBe(false);
    expect(loaded.phase).toBe("paused");
    expect(loaded.rejections).toBe(2);
    expect(loaded.approvedDestinationId).toBe("d1");
    expect(loaded.lastVerdict).toBe("still no");
    expect(loaded.verdictKind).toBe("rejection");
  });

  it("keeps only the approved destination after a done result", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctx-go-clock-"));
    const session = join(dir, "session.jsonl");
    const done = { ...freshState(), approvedDestinationId: "d1" };
    writeClock(session, done);
    const loaded = readClock(session);
    expect(loaded.approvedDestinationId).toBe("d1");
    expect(loaded.lastVerdict).toBe("");
    expect(loaded.verdictKind).toBe("none");
    expect(loaded.armed).toBe(false);
  });

  it("ignores a missing or broken file", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctx-go-clock-"));
    const session = join(dir, "session.jsonl");
    expect(readClock(session)).toEqual(freshState());
    writeFileSync(clockPath(session), "{");
    expect(readClock(session)).toEqual(freshState());
    writeFileSync(clockPath(session), JSON.stringify({ phase: "work", armed: true }));
    expect(readClock(session)).toEqual(freshState());
  });

  it("keeps an accepted aim across reload without arming", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctx-go-clock-"));
    const session = join(dir, "session.jsonl");
    writeFileSync(
      clockPath(session),
      JSON.stringify({
        phase: "questions",
        rejections: 0,
        approvedDestinationId: "d1",
        lastClaim: "aim met",
        lastVerdict: "",
        verdictKind: "none",
        aimMet: true,
      }),
    );
    const loaded = readClock(session);
    expect(loaded.armed).toBe(false);
    expect(loaded.aimMet).toBe(true);
    expect(loaded.projectDone).toBe(false);
    expect(loaded.outcomesAsked).toBe(false);
  });

  it("keeps the outcomes turn across reload", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctx-go-clock-"));
    const session = join(dir, "session.jsonl");
    writeClock(session, { ...freshState(), phase: "outcomes", approvedDestinationId: "d1", aimMet: true, outcomesAsked: true });
    const loaded = readClock(session);
    expect(loaded.phase).toBe("outcomes");
    expect(loaded.outcomesAsked).toBe(true);
    expect(loaded.armed).toBe(false);
  });
});
