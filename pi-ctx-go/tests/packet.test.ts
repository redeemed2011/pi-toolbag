import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { foldLive } from "../../pi-ctx/src/fold.js";
import { putJudgment } from "../../pi-ctx/src/mint.js";
import { judgeArgv } from "../src/judge.js";
import { buildPacket, namedPaths, parseVerdict } from "../src/packet.js";
import { closedQuestions } from "../src/snap.js";

describe("judge packet", () => {
  it("parses a verdict and rejects anything else", () => {
    expect(parseVerdict("verdict: done\nsummary: shipped")).toEqual({ ok: true, done: true, summary: "shipped" });
    expect(parseVerdict("verdict: done\nsummary: echoed\nverdict: not-done\nsummary: real")).toEqual({
      ok: true,
      done: false,
      summary: "real",
    });
    expect(parseVerdict("looks good")).toEqual({ ok: false, error: "no verdict" });
  });

  it("names file products and skips prose", () => {
    expect(namedPaths("and/or read/write src/out.md. `Makefile` `https://x/y`")).toEqual(["Makefile", "src/out.md"]);
  });

  it("includes a named file and refuses one it cannot read", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ctx-go-"));
    writeFileSync(join(cwd, "out.md"), "hello");
    expect(namedPaths("wrote `out.md` and `the report`")).toEqual(["out.md"]);
    const packet = buildPacket({
      cwd,
      destination: "Ship it",
      constraints: [{ id: "c1", headline: "Be reliable", body: "Be reliable" }],
      closed: [],
      claim: "Product is `out.md`",
    });
    expect(packet.ok).toBe(true);
    if (packet.ok) expect(packet.text).toContain("hello");
    const missing = buildPacket({
      cwd,
      destination: "Ship it",
      constraints: [],
      closed: [],
      claim: "Product is `missing.md`",
    });
    expect(missing.ok).toBe(false);
    writeFileSync(join(cwd, "..notes.md"), "kept");
    const dotted = buildPacket({
      cwd,
      destination: "Ship it",
      constraints: [],
      closed: [],
      claim: "Product is `..notes.md`",
    });
    expect(dotted.ok).toBe(true);
  });

  it("follows a superseded closer to the live record", () => {
    const base = { occupancy: "gated-edge" as const, siblingKnob: 0 as const, claimedId: null };
    const q = putJudgment({
      ...base,
      existing: [],
      input: { type: "question", headline: "q", session: "s", id: "q1" },
    });
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    const closer = putJudgment({
      ...base,
      existing: [q.record],
      input: { type: "decision", headline: "A", body: "closed", supersedes: "q1", reason_class: "decision_change", session: "s", id: "a" },
    });
    expect(closer.ok).toBe(true);
    if (!closer.ok) return;
    const later = putJudgment({
      ...base,
      existing: [q.record, closer.record],
      input: { type: "decision", headline: "B", body: "replaced", supersedes: "a", reason_class: "decision_change", session: "s", id: "b" },
    });
    expect(later.ok).toBe(true);
    if (!later.ok) return;
    const closed = closedQuestions(foldLive([q.record, closer.record, later.record]));
    expect(closed).toEqual([{ id: "b", headline: "B", body: "replaced", superseded: "q1" }]);
  });

  it("gives the judge no tools and the session thinking level", () => {
    const argv = judgeArgv({ provider: "openai", id: "gpt", thinking: "off" }, "packet");
    expect(argv).toContain("--no-tools");
    expect(argv).not.toContain("--no-builtin-tools");
    expect(argv[argv.indexOf("--thinking") + 1]).toBe("off");
  });
});
