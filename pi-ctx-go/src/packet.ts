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

export function buildPacket(input: PacketInput): Packet {
  const products: string[] = [];
  for (const token of namedPaths(input.claim)) {
    const read = readProduct(input.cwd, token);
    if (!read.ok) return read;
    products.push(`### ${token}\n${read.text}`);
  }
  const constraints = input.constraints.map((item) => `### ${item.headline} (${item.id})\n${item.body}`).join("\n\n");
  const closed = input.closed.map((item) => `### ${item.headline} (${item.id}) superseded ${item.superseded}\n${item.body}`).join("\n\n");
  const text = [
    "You are the completion judge. Reply with two lines:",
    "verdict: done",
    "or",
    "verdict: not-done",
    "summary: one short paragraph",
    "If the claim names no product, the verdict is not-done. Do not look for other work.",
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
  if (text.length > CALL_CAP) {
    const paths = namedPaths(input.claim);
    const included = paths.length > 0 ? paths.join(", ") : "done-claim account";
    return { ok: false, error: `packet does not fit: ${included}` };
  }
  return { ok: true, text };
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
