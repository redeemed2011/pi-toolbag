import type { JudgmentRecord, LiveSet } from "../../pi-ctx/src/types.js";

const CALL_CAP = 1_000_000;

export const CONFLICT_ASK =
  "The live CTX records are above. List pairs that contradict and that neither record superseded. Skip copies that agree. Reply with pair lines or one clear line. Do not edit anything.";

export type ConflictPair = { a: string; b: string; why: string };

/** The live id set. A supersede changes it. Agreeing copies do not. */
export function conflictStamp(live: LiveSet): string {
  return [...live.live].sort().join(",");
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

export function buildConflictPacket(live: LiveSet): { ok: true; text: string } | { ok: false; error: string } {
  const lines = [
    "These are the live records. Two records contradict when both cannot be true.",
    "A copy that says the same thing is not a pair.",
    "Reply with one line per pair:",
    "pair: <id> <id> <what cannot both be true>",
    "Or, if there is no such pair, one line: clear",
    "",
  ];
  for (const rec of liveRecords(live)) {
    const body = (rec.directive || rec.body || "").trim();
    lines.push(`### ${rec.id} ${rec.type}`);
    lines.push(rec.headline);
    if (body) lines.push(body);
    const supersedes = (rec.supersedes ?? []).join(" ");
    if (supersedes) lines.push(`supersedes ${supersedes}`);
    lines.push("");
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
