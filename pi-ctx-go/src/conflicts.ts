import type { JudgmentRecord, LiveSet } from "../../pi-ctx/src/types.js";

const CALL_CAP = 1_000_000;

/** A record is compared only when it states a rule. A finding, tombstone, citation, or evidence file does not. */
const COMPARED = new Set(["constraint", "decision", "destination", "out_of_scope"]);

function compared(live: LiveSet): JudgmentRecord[] {
  return liveRecords(live).filter((rec) => COMPARED.has(rec.type));
}

export const CONFLICT_ASK =
  "The live CTX records are above. List pairs that contradict and that neither record superseded. Skip copies that agree. Reply with pair lines or one clear line. Do not edit anything.";

export type ConflictPair = { a: string; b: string; why: string };

/** The compared id set. A new finding does not change it. A supersede of a rule does. */
export function conflictStamp(live: LiveSet): string {
  return compared(live)
    .map((rec) => rec.id)
    .sort()
    .join(",");
}

export function shouldReadConflicts(stamp: string, seen: string | null, awaitingAccept: boolean): boolean {
  if (awaitingAccept) return false;
  return seen !== stamp;
}

function liveRecords(live: LiveSet): JudgmentRecord[] {
  return [...live.live]
    .map((id) => live.byId.get(id))
    .filter((rec): rec is JudgmentRecord => rec !== undefined)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function ruleText(rec: JudgmentRecord): string {
  return (rec.directive || rec.body || "").replace(/\s+/g, " ").trim();
}

/** One line per distinct rule. Agreeing copies are omitted. The rule text is kept. */
export function buildConflictPacket(live: LiveSet): { ok: true; text: string } | { ok: false; error: string } {
  const lines = [
    "These are the live rules. Two rules contradict when both cannot be true.",
    "A copy that says the same thing is not a pair.",
    "Reply with one line per pair:",
    "pair: <id> <id> <what cannot both be true>",
    "Or, if there is no such pair, one line: clear",
    "",
  ];
  const seen = new Set<string>();
  for (const rec of compared(live)) {
    const body = ruleText(rec);
    const key = body || rec.headline.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    const parts = [`${rec.id} ${rec.type} ${rec.headline.trim()}`];
    if (body) parts.push(body);
    const supersedes = (rec.supersedes ?? []).join(" ");
    if (supersedes) parts.push(`supersedes ${supersedes}`);
    lines.push(parts.join(" — "));
  }
  const text = lines.join("\n");
  if (text.length > CALL_CAP) return { ok: false, error: "conflict packet does not fit" };
  return { ok: true, text };
}

/** Parents that already have two live successors. The model is not asked to find these. */
export function formalConflicts(live: LiveSet): string[] {
  const lines: string[] = [];
  for (const parent of live.liveConflict) {
    const kids = liveRecords(live)
      .filter((rec) => (rec.supersedes ?? []).includes(parent))
      .map((rec) => rec.id);
    lines.push(`formal ${parent} successors ${kids.join(" ")}`);
  }
  return lines;
}

export function parseConflictPairs(text: string, live: LiveSet): ConflictPair[] {
  const pairs: ConflictPair[] = [];
  const seen = new Set<string>();
  for (const raw of text.split("\n")) {
    const match = raw.trim().match(/^pair:\s+(\S+)\s+(\S+)\s+(.+)$/i);
    if (!match) continue;
    const a = match[1] ?? "";
    const b = match[2] ?? "";
    const why = (match[3] ?? "").trim();
    if (!live.live.has(a) || !live.live.has(b) || a === b || !why) continue;
    if (/not a contradict|do not contradict|does not contradict/i.test(why)) continue;
    const left = live.byId.get(a);
    const right = live.byId.get(b);
    if ((left?.supersedes ?? []).includes(b) || (right?.supersedes ?? []).includes(a)) continue;
    const key = [a, b].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ a, b, why });
  }
  return pairs;
}

function findingText(live: LiveSet): string[] {
  return liveRecords(live)
    .filter((rec) => rec.type === "finding")
    .map((rec) => `${rec.headline}\n${rec.directive ?? ""}\n${rec.body}`);
}

/** A pair is settled when one rule is no longer live, or a finding names both ids. */
export function unresolved(lines: string[], live: LiveSet): string[] {
  const formalNow = new Set(formalConflicts(live).map((line) => line.split(" ")[1] ?? ""));
  const findings = findingText(live);
  const open: string[] = [];
  for (const line of lines) {
    const pair = /^pair\s+(\S+)\s+(\S+)\s+/.exec(line);
    if (pair) {
      const a = pair[1] ?? "";
      const b = pair[2] ?? "";
      if (!live.live.has(a) || !live.live.has(b)) continue;
      if (findings.some((text) => text.includes(a) && text.includes(b))) continue;
      open.push(line);
      continue;
    }
    const formal = /^formal\s+(\S+)\s+/.exec(line);
    if (formal && formalNow.has(formal[1] ?? "")) open.push(line);
  }
  return open;
}
