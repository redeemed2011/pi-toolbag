import { createHash } from "node:crypto";
import { realpathSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const PRODUCT_CAP = 150_000;
const CALL_CAP = 1_000_000;

export type PacketInput = {
  cwd: string;
  destination: string;
  constraints: { id: string; headline: string; body: string }[];
  closed: { id: string; headline: string; body: string; superseded: string }[];
  claim: string;
};

export type Packet = { ok: true; text: string } | { ok: false; error: string };

function bareProse(token: string): boolean {
  const parts = token.split("/");
  return parts.length === 2 && !parts[1]?.includes(".") && !token.startsWith(".");
}

function isSlashCommand(token: string): boolean {
  return /^\/[^/\s.]+$/.test(token);
}

function isFilePath(token: string): boolean {
  if (!token || token.includes("://") || /\s/.test(token) || isSlashCommand(token)) return false;
  if (token.includes("/")) return !bareProse(token);
  return /\.[A-Za-z0-9]{1,8}$/.test(token);
}

export function namedPaths(claim: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (token: string) => {
    const name = token.trim().replace(/\.+$/, "");
    if (!isFilePath(name) || seen.has(name)) return;
    seen.add(name);
    found.push(name);
  };
  for (const match of claim.matchAll(/`([^`\n]+)`/g)) add(match[1] ?? "");
  for (const match of claim.matchAll(/(?:^|[\s"'`(])((?:\/(?:[\w.-]+\/)+|\.{1,2}\/|(?:[\w.-]+\/)+)[\w.-]+)/g)) add(match[1] ?? "");
  return found;
}

function readProduct(cwd: string, token: string): { ok: true; text: string } | { ok: false; error: string } {
  const abs = resolve(cwd, token);
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    return { ok: false, error: `missing product ${token}` };
  }
  let size = 0;
  try {
    size = statSync(real).size;
  } catch {
    return { ok: false, error: `missing product ${token}` };
  }
  if (size > PRODUCT_CAP) return { ok: false, error: `product too large ${token}` };
  try {
    return { ok: true, text: readFileSync(real, "utf8") };
  } catch {
    return { ok: false, error: `unreadable product ${token}` };
  }
}

/** Bytes of named products. A new path or a new hash is movement. first-questions.md never counts. */
export function productStamp(cwd: string, claim: string): string {
  const rows: string[] = [];
  for (const token of namedPaths(claim)) {
    if (token.endsWith("first-questions.md")) continue;
    const read = readProduct(cwd, token);
    const hex = createHash("sha256").update(read.ok ? read.text : "").digest("hex");
    rows.push(`${token}\n${hex}`);
  }
  rows.sort();
  return rows.join("\n");
}

export function buildPacket(input: PacketInput): Packet {
  const inlined: { token: string; text: string }[] = [];
  const unread: string[] = [];
  for (const token of namedPaths(input.claim)) {
    const read = readProduct(input.cwd, token);
    if (!read.ok) {
      if (read.error.startsWith("product too large ")) {
        unread.push(token);
        continue;
      }
      return read;
    }
    inlined.push({ token, text: read.text });
  }
  const constraints = input.constraints.map((item) => `### ${item.headline} (${item.id})\n${item.body}`).join("\n\n");
  const closed = input.closed.map((item) => `### ${item.headline} (${item.id}) superseded ${item.superseded}\n${item.body}`).join("\n\n");
  const compose = (includeBodies: boolean): string => {
    const products = [
      ...inlined.map((item) => `### ${item.token}\n${includeBodies ? item.text : "This file is not in the packet. Read it."}`),
      ...unread.map((token) => `### ${token}\nThis file is not in the packet. Read it.`),
    ];
    return [
      "You are the completion judge. Reply with two lines:",
      "verdict: done",
      "or",
      "verdict: not-done",
      "summary: one short paragraph",
      "If the claim names no product, the verdict is not-done.",
      "If a product's text is not included below, read that file. You can read and search files. Do not edit them.",
      "",
      "## Destination",
      input.destination,
      "",
      "## Constraints",
      constraints,
      "",
      "## Questions closed",
      closed,
      "",
      "## Done claim",
      input.claim,
      "",
      "## Products",
      products.join("\n\n"),
    ].join("\n");
  };
  let text = compose(true);
  if (text.length > CALL_CAP && inlined.length > 0) text = compose(false);
  if (text.length > CALL_CAP) {
    const paths = namedPaths(input.claim);
    const included = paths.length > 0 ? paths.join(", ") : "done-claim account";
    return { ok: false, error: `packet does not fit: ${included}` };
  }
  return { ok: true, text };
}

export function buildImpassePacket(input: {
  destination: string;
  constraints: { headline: string; body: string }[];
  claim: string;
  open: string;
}): Packet {
  const constraints = input.constraints.map((item) => `${item.headline}: ${item.body}`).join("\n") || "none";
  const text = [
    "Judge this impasse.",
    "The worker says this item cannot be recorded.",
    "If the worker missed a way through, reply: way through: and a one-line summary.",
    "If there is no missed work, reply: no way through: and the reason.",
    "Do not ask the operator.",
    "",
    "## Impasse",
    input.claim,
    "",
    "## Destination",
    input.destination || "none",
    "",
    "## Constraints",
    constraints,
    "",
    "## Open questions",
    input.open || "none",
  ].join("\n");
  if (text.length > CALL_CAP) return { ok: false, error: "packet does not fit: impasse" };
  return { ok: true, text };
}

export function parseImpasse(text: string): { ok: true; through: boolean; summary: string } | { ok: false; error: string } {
  const line = text.split("\n").map((item) => item.trim()).find(Boolean) ?? "";
  const through = line.match(/^way through:?\s*(.*)$/i);
  if (through) return { ok: true, through: true, summary: (through[1] ?? "").trim() };
  const none = line.match(/^no way through:?\s*(.*)$/i);
  if (none) return { ok: true, through: false, summary: (none[1] ?? "").trim() };
  return { ok: false, error: "no verdict" };
}

export function parseVerdict(text: string): { ok: true; done: boolean; summary: string } | { ok: false; error: string } {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const verdicts = lines.filter((line) => line.toLowerCase().startsWith("verdict:"));
  const verdict = verdicts[verdicts.length - 1];
  if (!verdict) return { ok: false, error: "no verdict" };
  const value = verdict.slice("verdict:".length).trim().toLowerCase();
  if (value !== "done" && value !== "not-done") return { ok: false, error: "bad verdict" };
  const summaries = lines.filter((line) => line.toLowerCase().startsWith("summary:"));
  const summaryLine = summaries[summaries.length - 1];
  const summary = summaryLine ? summaryLine.slice("summary:".length).trim() : "";
  return { ok: true, done: value === "done", summary };
}
