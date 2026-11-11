import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { foldLive } from "../../pi-ctx/src/fold.js";
import { putJudgment } from "../../pi-ctx/src/mint.js";
import { judgeArgv } from "../src/judge.js";
import { buildImpassePacket, buildPacket, judgedDone, namedPaths, parseImpasse, parseVerdict, productStamp } from "../src/packet.js";
import { closedQuestions } from "../src/snap.js";

describe("judge packet", () => {
  it("parses an impasse as a way through, agreement, or an error", () => {
    expect(parseImpasse("way through: record the question")).toEqual({
      ok: true,
      through: true,
      summary: "record the question",
    });
    expect(parseImpasse("no way through: nothing was missed")).toEqual({
      ok: true,
      through: false,
      summary: "nothing was missed",
    });
    expect(parseImpasse("verdict: done\nsummary: shipped")).toEqual({ ok: false, error: "no verdict" });
    const packet = buildImpassePacket({
      destination: "Build the app.",
      constraints: [],
      claim: "Impasse: the annotation question is blocked",
      open: "none",
    });
    expect(packet.ok).toBe(true);
    if (packet.ok) {
      expect(packet.text).toContain("Judge this impasse.");
      expect(packet.text).not.toContain("verdict: done");
      expect(packet.text).toContain("Do not ask the operator.");
    }
  });

  it("parses a verdict and rejects anything else", () => {
    expect(parseVerdict("verdict: done\nsummary: shipped")).toEqual({ ok: true, done: false, summary: "shipped" });
    expect(parseVerdict("verdict: done\nsummary: echoed\nverdict: not-done\nsummary: real")).toEqual({
      ok: true,
      done: false,
      summary: "real",
    });
    expect(parseVerdict("looks good")).toEqual({ ok: false, error: "no verdict" });
  });

  it("accepts done only with an outcome path and no gap line", () => {
    const destination = "Build the app.";
    const outcome = 'outcome: "Build the app." /tmp/app.ts the function builds it';
    expect(parseVerdict(`verdict: done\n${outcome}`, destination)).toMatchObject({ ok: true, done: true });
    expect(parseVerdict(`verdict: done\n${outcome}\ngap: the tests fail`, destination)).toMatchObject({
      ok: true,
      done: false,
      summary: "the tests fail",
    });
    expect(parseVerdict(`verdict: done\noutcome: "Build the app." the function builds it`, destination)).toMatchObject({
      done: false,
      summary: "an outcome line has no absolute path",
    });
    expect(parseVerdict(`verdict: done\noutcome: "Build the app." /tmp/app.ts no gap remains`, destination)).toMatchObject({
      done: true,
    });
    const echoed = `verdict: done\n${outcome}`;
    expect(judgedDone(echoed, destination, "The cluster report is the product.")).toMatchObject({
      ok: true,
      done: false,
      summary: "no product",
    });
    expect(judgedDone(echoed, destination, "Product is `/tmp/app.ts`.")).toMatchObject({ ok: true, done: true });
    const packet = buildPacket({
      cwd: mkdtempSync(join(tmpdir(), "ctx-go-gap-")),
      destination,
      constraints: [],
      closed: [],
      claim: "The cluster report is the product.",
      obligation: "the copy stays down",
    });
    expect(packet.ok).toBe(true);
    if (packet.ok) {
      expect(packet.text).toContain("worker claims, not proof");
      expect(packet.text).toContain("outcome:");
      expect(packet.text).toContain("the copy stays down");
      expect(packet.text).toContain("Do not run tests.");
    }
  });

  it("names file products and skips prose and slash commands", () => {
    expect(namedPaths("and/or read/write src/out.md. `Makefile` `https://x/y` `/ctx-go` `/ctx-stop`")).toEqual([]);
    expect(namedPaths("wrote `out.md` and `the report`")).toEqual([]);
    expect(namedPaths("Product is `/tmp/out.md`")).toEqual(["/tmp/out.md"]);
  });

  it("does not treat a session-relative path as a product", () => {
    expect(namedPaths("Product is `out.md` and src/out.md")).toEqual([]);
    const cwd = mkdtempSync(join(tmpdir(), "ctx-go-rel-"));
    writeFileSync(join(cwd, "out.md"), "hello");
    const packet = buildPacket({
      cwd,
      destination: "Ship it",
      constraints: [],
      closed: [],
      claim: "Product is `out.md`",
    });
    expect(packet.ok).toBe(true);
    if (packet.ok) expect(packet.text).not.toContain("hello");
    expect(productStamp(cwd, "`out.md` `src/out.md`")).toBe("");
  });

  it("includes a named file and refuses one it cannot read", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ctx-go-"));
    const file = join(cwd, "out.md");
    writeFileSync(file, "hello");
    expect(namedPaths(`wrote \`${file}\` and \`the report\``)).toEqual([file]);
    const packet = buildPacket({
      cwd,
      destination: "Ship it",
      constraints: [{ id: "c1", headline: "Be reliable", body: "Be reliable" }],
      closed: [],
      claim: `Product is \`${file}\``,
    });
    expect(packet.ok).toBe(true);
    if (packet.ok) expect(packet.text).toContain("hello");
    const missing = buildPacket({
      cwd,
      destination: "Ship it",
      constraints: [],
      closed: [],
      claim: `Product is \`${join(cwd, "missing.md")}\``,
    });
    expect(missing.ok).toBe(false);
    const mentioned = buildPacket({
      cwd,
      destination: "Ship it",
      constraints: [],
      closed: [],
      claim: `Started with \`/ctx-go\`. Product is \`${file}\`.`,
    });
    expect(mentioned.ok).toBe(true);
    if (mentioned.ok) {
      expect(mentioned.text).toContain("hello");
      expect(mentioned.text).not.toContain("missing product");
    }
    const dottedPath = join(cwd, "..notes.md");
    writeFileSync(dottedPath, "kept");
    const dotted = buildPacket({
      cwd,
      destination: "Ship it",
      constraints: [],
      closed: [],
      claim: `Product is \`${dottedPath}\``,
    });
    expect(dotted.ok).toBe(true);
    if (dotted.ok) expect(dotted.text).toContain("kept");
  });

  it("reads a file outside the session directory", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ctx-go-cwd-"));
    const other = mkdtempSync(join(tmpdir(), "ctx-go-other-"));
    const file = join(other, "first-principles.md");
    writeFileSync(file, "outside");
    const claim = `The products are ${file} and \`${file}\`.`;
    expect(namedPaths(claim)).toEqual([file]);
    const packet = buildPacket({
      cwd,
      destination: "Ship it",
      constraints: [],
      closed: [],
      claim,
    });
    expect(packet.ok).toBe(true);
    if (packet.ok) expect(packet.text).toContain("outside");
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

  it("names what did not fit and refuses a file over the cap", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ctx-go-cap-"));
    const file = join(cwd, "big.md");
    writeFileSync(file, "x".repeat(150_001));
    const tooBig = buildPacket({
      cwd,
      destination: "Ship it",
      constraints: [],
      closed: [],
      claim: `Product is ${file}`,
    });
    expect(tooBig.ok).toBe(true);
    if (tooBig.ok) {
      expect(tooBig.text).toContain(file);
      expect(tooBig.text).toContain("This file is not in the packet. Read it.");
      expect(tooBig.text).not.toContain("x".repeat(100));
    }
    writeFileSync(file, "ok");
    const shared = buildPacket({
      cwd,
      destination: "d".repeat(1_000_000),
      constraints: [],
      closed: [],
      claim: `Product is ${file}`,
    });
    expect(shared.ok).toBe(false);
    if (!shared.ok) expect(shared.error).toBe(`packet does not fit: ${file}`);
    const account = buildPacket({
      cwd,
      destination: "d".repeat(1_000_000),
      constraints: [],
      closed: [],
      claim: "The cluster report is the product.",
    });
    expect(account).toEqual({ ok: false, error: "packet does not fit: done-claim account" });
    const parts = ["a.ts", "b.ts", "c.ts"].map((name) => join(cwd, name));
    for (const part of parts) writeFileSync(part, "y".repeat(60_000));
    const several = buildPacket({
      cwd,
      destination: "Ship it",
      constraints: [],
      closed: [],
      claim: parts.join("\n"),
    });
    expect(several.ok).toBe(true);
  });

  it("gives the judge read and search tools and the session thinking level", () => {
    const argv = judgeArgv({ provider: "openai", id: "gpt", thinking: "off" });
    expect(argv).not.toContain("--no-tools");
    expect(argv[argv.indexOf("--tools") + 1]).toBe("read,grep,find");
    expect(argv[argv.indexOf("--exclude-tools") + 1]).toBe("mcp__*");
    const fallback = argv.find((arg) => arg.endsWith("judge-fallback.ts"));
    expect(fallback).toBeTruthy();
    expect(readFileSync(fallback ?? "", "utf8")).not.toContain("attachFallback");
    expect(argv[argv.indexOf("--thinking") + 1]).toBe("off");
    const ask = argv[argv.indexOf("-p") + 1] ?? "";
    expect(ask.length).toBeLessThan(200);
    expect(ask).not.toContain("verdict:");
    expect(ask).not.toMatch(/two lines/i);
    expect(ask).toMatch(/outcome/i);
    expect(ask).toMatch(/gap/i);
  });

  it("stamps product bytes and ignores the contract file", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ctx-go-stamp-"));
    const app = join(cwd, "app.txt");
    const contract = join(cwd, "first-questions.md");
    const extra = join(cwd, "extra.txt");
    writeFileSync(app, "one");
    writeFileSync(contract, "kept");
    const claim = `\`${app}\` \`${contract}\``;
    const first = productStamp(cwd, claim);
    expect(first).toContain(app);
    expect(first).not.toContain("first-questions.md");
    expect(productStamp(cwd, `\`${contract}\` only`)).toBe("");
    writeFileSync(contract, "changed");
    expect(productStamp(cwd, claim)).toBe(first);
    writeFileSync(app, "two");
    expect(productStamp(cwd, claim)).not.toBe(first);
    writeFileSync(extra, "x");
    expect(productStamp(cwd, `\`${app}\` \`${extra}\``)).not.toBe(productStamp(cwd, `\`${app}\``));
  });

  it("does not load fallback-chain providers for the judge", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "ctx-go-judge-"));
    writeFileSync(
      join(agentDir, "auto-fallback.json"),
      JSON.stringify({
        enabled: true,
        chains: [{ name: "swap", models: ["openai/gpt", "xai/grok"] }],
        maxFailoversPerRequest: 1,
      }),
    );
    for (const name of ["pi-openai", "pi-xai"]) {
      const dir = join(agentDir, "npm", "node_modules", name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name }));
    }
    const prev = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    try {
      const argv = judgeArgv({ provider: "openai", id: "gpt", thinking: "off" });
      expect(argv.some((arg) => arg.endsWith("/pi-openai"))).toBe(true);
      expect(argv.some((arg) => arg.includes("pi-xai"))).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = prev;
    }
  });
});
