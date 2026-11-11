import { describe, expect, it } from "vitest";
import { foldLive } from "../../pi-ctx/src/fold.js";
import type { JudgmentRecord } from "../../pi-ctx/src/types.js";
import { CONFLICT_BUSY, runConflictRead } from "../src/conflict-read.js";
import { freshState } from "../src/state.js";

function rec(id: string, headline: string): JudgmentRecord {
  return { id, type: "decision", ts: "2026-11-11T00:00:00.000Z", session: "s", headline, body: "" };
}

describe("contradiction read notice", () => {
  it("says it is checking before the read returns", async () => {
    const live = foldLive([rec("a", "One rule"), rec("b", "Another rule")]);
    const events: string[] = [];
    let release: (value: { ok: true; text: string }) => void = () => {};
    const pending = runConflictRead({
      state: freshState(),
      live,
      model: { provider: "p", id: "m" },
      cwd: "/tmp",
      tell: (message) => events.push(`tell:${message}`),
      run: (model) =>
        new Promise((resolve) => {
          events.push(`run:${model.thinking}`);
          release = resolve;
        }),
    });
    expect(events).toEqual([`tell:${CONFLICT_BUSY}`, "run:medium"]);
    release({ ok: true, text: "clear" });
    const step = await pending;
    expect(step?.actions).toEqual([]);
  });
});
