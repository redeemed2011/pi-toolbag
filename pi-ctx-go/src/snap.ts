import { foldSession, frontierItems } from "../../pi-ctx/src/fold.js";
import { loadProjectLive } from "../../pi-ctx/src/store/project.js";
import type { Entry, JudgmentRecord, LiveSet } from "../../pi-ctx/src/types.js";
import { twoLines } from "./text.js";
import type { Snap } from "./state.js";

export type BoundSnap = Snap & {
  projectId: string | null;
  sessionId: string;
  records: JudgmentRecord[];
  live: LiveSet | null;
  destinationText: string;
};

export function readSnap(branch: Entry[], sessionId: string): BoundSnap {
  const session = foldSession(branch, sessionId);
  if (!session.bound || !session.projectId) {
    return {
      bound: false,
      destinationId: null,
      frontierIds: [],
      claimedId: null,
      askIds: [],
      askHeadlines: [],
      blocked: [],
      projectId: null,
      sessionId,
      records: [],
      live: null,
      destinationText: "",
    };
  }
  const live = loadProjectLive(session.projectId);
  const destination = live.destinations[0];
  const destinationText = destination ? twoLines(destination.directive || destination.body) : "";
  const frontier = frontierItems(live, session.claimedId);
  const asks = live.questions.filter((q) => live.askOperator.has(q.id));
  const blocked = live.questions
    .filter((q) => live.blocked.has(q.id))
    .map((q) => ({
      id: q.id,
      headline: q.headline,
      blockers: [...live.live]
        .map((id) => live.byId.get(id))
        .filter((rec): rec is JudgmentRecord => rec !== undefined && (rec.blocks ?? []).includes(q.id))
        .map((rec) => rec.id),
    }));
  return {
    bound: true,
    destinationId: destination?.id ?? null,
    destinationText,
    frontierIds: frontier.map((q) => q.id),
    claimedId: session.claimedId,
    askIds: asks.map((q) => q.id),
    askHeadlines: asks.map((q) => q.headline),
    blocked,
    projectId: session.projectId,
    sessionId,
    records: [...live.byId.values()],
    live,
  };
}

export function closedQuestions(live: LiveSet): { id: string; headline: string; body: string; superseded: string }[] {
  const out: { id: string; headline: string; body: string; superseded: string }[] = [];
  for (const rec of live.byId.values()) {
    if (!live.live.has(rec.id)) continue;
    for (const id of rec.supersedes ?? []) {
      const parent = live.byId.get(id);
      if (!parent || parent.type !== "question") continue;
      out.push({
        id: rec.id,
        headline: rec.headline,
        body: rec.directive || rec.body,
        superseded: id,
      });
    }
  }
  return out;
}
