import type { LiveSet } from "../../pi-ctx/src/types.js";
import {
  buildConflictPacket,
  CONFLICT_ASK,
  conflictStamp,
  formalConflicts,
  parseConflictPairs,
  shouldReadConflicts,
} from "./conflicts.js";
import { runJudge, type JudgeModel } from "./judge.js";
import { onConflictRead, type GoState, type Step } from "./state.js";

export const CONFLICT_BUSY = "ctx-go is checking the project for contradictions";

type JudgeRun = typeof runJudge;

/** Tells the operator, then waits on the contradiction read. A skipped read tells nothing. */
export async function runConflictRead(opts: {
  state: GoState;
  live: LiveSet | null;
  model: JudgeModel | null;
  cwd: string;
  tell: (message: string) => void;
  run?: JudgeRun;
}): Promise<Step | null> {
  if (!opts.live || !shouldReadConflicts(conflictStamp(opts.live), opts.state.conflictStamp, opts.state.awaitingAccept)) {
    return null;
  }
  opts.tell(CONFLICT_BUSY);
  const stamp = conflictStamp(opts.live);
  const packet = buildConflictPacket(opts.live);
  const formal = formalConflicts(opts.live);
  const run = opts.run ?? runJudge;
  // The completion judge keeps the session thinking level. This read uses the middle level.
  // xhigh on the whole live set timed out. Thinking off is sent as reasoning_effort
  // none, and Grok 4.7 rejects that.
  const fast = opts.model ? { provider: opts.model.provider, id: opts.model.id, thinking: "medium" as const } : null;
  const ran = !packet.ok
    ? packet
    : !fast
      ? { ok: false as const, error: "no model" }
      : await run(fast, packet.text, opts.cwd, CONFLICT_ASK, false);
  const read = ran.ok ? { ok: true as const, pairs: parseConflictPairs(ran.text, opts.live) } : ran;
  return onConflictRead(opts.state, stamp, read, formal);
}
