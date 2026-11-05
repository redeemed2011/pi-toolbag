import { foldLive } from "../../pi-ctx/src/fold.js";
import { putJudgment } from "../../pi-ctx/src/mint.js";
import { appendProjectRecord } from "../../pi-ctx/src/store/project.js";
import type { JudgmentRecord } from "../../pi-ctx/src/types.js";
import { twoLines } from "./text.js";

export function approveDestination(opts: {
  projectId: string;
  sessionId: string;
  existing: JudgmentRecord[];
  draft: string;
}): { ok: true; id: string } | { ok: false; error: string } {
  const text = twoLines(opts.draft);
  if (!opts.sessionId) return { ok: false, error: "empty session" };
  if (!text) return { ok: false, error: "empty draft" };
  let existing = opts.existing;
  const live = () => foldLive(existing);
  for (const destination of live().destinations) {
    const put = putJudgment({
      occupancy: "gated-edge",
      siblingKnob: 0,
      claimedId: null,
      existing,
      input: {
        type: "tombstone",
        headline: "Superseded destination",
        body: destination.id,
        supersedes: destination.id,
        reason_class: "decision_change",
        session: opts.sessionId,
      },
    });
    if (!put.ok) return { ok: false, error: put.error };
    appendProjectRecord(opts.projectId, opts.sessionId, put.line);
    existing = [...existing, put.record];
  }
  const put = putJudgment({
    occupancy: "gated-edge",
    siblingKnob: 0,
    claimedId: null,
    existing,
    input: {
      type: "destination",
      headline: "Approved destination",
      directive: text,
      body: text,
      session: opts.sessionId,
    },
  });
  if (!put.ok) return { ok: false, error: put.error };
  appendProjectRecord(opts.projectId, opts.sessionId, put.line);
  return { ok: true, id: put.record.id };
}
