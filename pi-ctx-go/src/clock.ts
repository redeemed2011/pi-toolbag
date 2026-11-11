import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { freshState, type GoPhase, type GoState, type VerdictKind } from "./state.js";

const PHASES: readonly GoPhase[] = ["idle", "draft", "reconcile", "conflicts", "questions", "work", "claim", "outcomes", "project", "paused"];
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
  const reconciledThrough = body.reconciledThrough === undefined ? null : body.reconciledThrough;
  if (reconciledThrough !== null && typeof reconciledThrough !== "string") return freshState();
  const statusReports = body.statusReports === undefined ? 0 : body.statusReports;
  if (typeof statusReports !== "number" || !Number.isInteger(statusReports) || statusReports < 0) return freshState();
  const awaitingAccept = body.awaitingAccept === undefined ? false : body.awaitingAccept;
  const obligation = body.obligation === undefined ? "" : body.obligation;
  if (typeof awaitingAccept !== "boolean" || typeof obligation !== "string") return freshState();
  const conflictStamp = body.conflictStamp === undefined || body.conflictStamp === null ? null : body.conflictStamp;
  if (conflictStamp !== null && typeof conflictStamp !== "string") return freshState();
  const outcomesAsked = body.outcomesAsked === undefined ? false : body.outcomesAsked;
  if (typeof outcomesAsked !== "boolean") return freshState();
  const conflictOpen = body.conflictOpen === undefined ? [] : body.conflictOpen;
  if (!Array.isArray(conflictOpen) || conflictOpen.some((line) => typeof line !== "string")) return freshState();
  return {
    ...freshState(),
    phase: body.phase,
    reconciledThrough,
    statusReports,
    rejections: body.rejections,
    approvedDestinationId: body.approvedDestinationId,
    lastClaim: body.lastClaim,
    lastVerdict: body.lastVerdict,
    priorVerdict,
    productStamp,
    verdictKind: body.verdictKind,
    aimMet,
    projectDone,
    awaitingAccept,
    obligation,
    conflictStamp,
    conflictOpen,
    outcomesAsked,
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
    awaitingAccept: state.awaitingAccept,
    obligation: state.obligation,
    conflictStamp: state.conflictStamp,
    conflictOpen: state.conflictOpen,
    outcomesAsked: state.outcomesAsked,
    reconciledThrough: state.reconciledThrough,
    statusReports: state.statusReports,
    armed: false,
  };
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(body));
  renameSync(tmp, path);
}
