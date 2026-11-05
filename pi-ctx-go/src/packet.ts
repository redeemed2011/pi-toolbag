import { realpathSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const PACKET_CAP = 150_000;

export type PacketInput = {
  cwd: string;
  destination: string;
  constraints: { id: string; headline: string; body: string }[];
  closed: { id: string; headline: string; body: string; superseded: string }[];
  claim: string;
};

export type Packet = { ok: true; text: string } | { ok: false; error: string };

function looksLikePath(token: string): boolean {
  return token.includes("/") || /\.[A-Za-z0-9]{1,8}$/.test(token);
}

export function namedPaths(claim: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (token: string) => {
    const name = token.trim();
    if (!looksLikePath(name) || seen.has(name)) return;
    seen.add(name);
    found.push(name);
  };
  for (const match of claim.matchAll(/`([^`\n]+)`/g)) add(match[1] ?? "");
  for (const match of claim.matchAll(/(?:^|\s)((?:[\w.-]+\/)+[\w.-]+)/g)) add(match[1] ?? "");
  return found;
}

function readProduct(cwd: string, token: string): { ok: true; text: string } | { ok: false; error: string } {
  const abs = resolve(cwd, token);
  let real: string;
  let root: string;
  try {
    root = realpathSync(cwd);
    real = realpathSync(abs);
  } catch {
    return { ok: false, error: `missing product ${token}` };
  }
  const rel = relative(root, real);
  if (rel.startsWith("..") || isAbsolute(rel)) return { ok: false, error: `product outside the session ${token}` };
  let size = 0;
  try {
    size = statSync(real).size;
  } catch {
    return { ok: false, error: `missing product ${token}` };
  }
  if (size > PACKET_CAP) return { ok: false, error: `product too large ${token}` };
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
  if (text.length > PACKET_CAP) return { ok: false, error: "judge packet does not fit" };
  return { ok: true, text };
}

export function parseVerdict(text: string): { ok: true; done: boolean; summary: string } | { ok: false; error: string } {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const verdict = lines.find((line) => line.toLowerCase().startsWith("verdict:"));
  if (!verdict) return { ok: false, error: "no verdict" };
  const value = verdict.slice("verdict:".length).trim().toLowerCase();
  if (value !== "done" && value !== "not-done") return { ok: false, error: "bad verdict" };
  const summaryLine = lines.find((line) => line.toLowerCase().startsWith("summary:"));
  const summary = summaryLine ? summaryLine.slice("summary:".length).trim() : "";
  return { ok: true, done: value === "done", summary };
}
