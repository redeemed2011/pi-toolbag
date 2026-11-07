import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { freshState, type GoPhase, type GoState, type VerdictKind } from "./state.js";

const PHASES: readonly GoPhase[] = ["idle", "draft", "questions", "work", "claim", "project", "paused"];
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
  const priorVerdict = body.priorVerdict === undefined ? "" : body.priorVerdict;
  const productStamp = body.productStamp === undefined || body.productStamp === null ? null : body.productStamp;
  if (typeof priorVerdict !== "string" || (productStamp !== null && typeof productStamp !== "string")) return freshState();
  const aimMet = body.aimMet === undefined ? false : body.aimMet;
  const projectDone = body.projectDone === undefined ? false : body.projectDone;
  if (typeof aimMet !== "boolean" || typeof projectDone !== "boolean") return freshState();
  return {
    ...freshState(),
    phase: body.phase,
    rejections: body.rejections,
    approvedDestinationId: body.approvedDestinationId,
    lastClaim: body.lastClaim,
    lastVerdict: body.lastVerdict,
    priorVerdict,
    productStamp,
    verdictKind: body.verdictKind,
    aimMet,
    projectDone,
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
    priorVerdict: state.priorVerdict,
    productStamp: state.productStamp,
    verdictKind: state.verdictKind,
    aimMet: state.aimMet,
    projectDone: state.projectDone,
    armed: false,
  };
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(body));
  renameSync(tmp, path);
}
