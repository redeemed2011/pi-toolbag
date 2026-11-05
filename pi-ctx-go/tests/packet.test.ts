import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPacket, namedPaths, parseVerdict } from "../src/packet.js";

describe("judge packet", () => {
  it("parses a verdict and rejects anything else", () => {
    expect(parseVerdict("verdict: done\nsummary: shipped")).toEqual({ ok: true, done: true, summary: "shipped" });
    expect(parseVerdict("looks good")).toEqual({ ok: false, error: "no verdict" });
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
  });
});
