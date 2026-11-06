import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { freshState, type GoPhase, type GoState, type VerdictKind } from "./state.js";

const PHASES: readonly GoPhase[] = ["idle", "draft", "questions", "work", "claim", "paused"];
const KINDS: readonly VerdictKind[] = ["none", "rejection", "error"];

export function clockPath(sessionFile: string): string {
  return `${sessionFile}.ctx-go.json`;
}

function isPhase(value: unknown): value is GoPhase {
  return typeof value === "string" && PHASES.some((phase) => phase === value);
}

function isKind(value: unknown): value is VerdictKind {
  return typeof value === "string" && KINDS.some((kind) => kind === value);
}

/** The file never arms the loop. A missing or unreadable file is a fresh clock. */
export function readClock(sessionFile: string): GoState {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(clockPath(sessionFile), "utf8"));
  } catch {
    return freshState();
  }
  if (!raw || typeof raw !== "object") return freshState();
  const body = raw as Record<string, unknown>;
  if (!isPhase(body.phase) || !isKind(body.verdictKind)) return freshState();
  if (typeof body.rejections !== "number" || !Number.isInteger(body.rejections) || body.rejections < 0) return freshState();
  if (body.approvedDestinationId !== null && typeof body.approvedDestinationId !== "string") return freshState();
  if (typeof body.lastClaim !== "string" || typeof body.lastVerdict !== "string") return freshState();
  return {
    ...freshState(),
    phase: body.phase,
    rejections: body.rejections,
    approvedDestinationId: body.approvedDestinationId,
    lastClaim: body.lastClaim,
    lastVerdict: body.lastVerdict,
    verdictKind: body.verdictKind,
    armed: false,
    hold: false,
  };
}

export function writeClock(sessionFile: string, state: GoState): void {
  const path = clockPath(sessionFile);
  const body = {
    phase: state.phase,
    rejections: state.rejections,
    approvedDestinationId: state.approvedDestinationId,
    lastClaim: state.lastClaim,
    lastVerdict: state.lastVerdict,
    verdictKind: state.verdictKind,
    armed: false,
  };
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(body));
  renameSync(tmp, path);
}
