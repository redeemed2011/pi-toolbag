import { loadConfig } from "../../pi-ctx/src/config.js";
import { foldSession, frontierItems, resolveOccupancy } from "../../pi-ctx/src/fold.js";
import { loadProjectLive } from "../../pi-ctx/src/store/project.js";
import { applyClaim } from "../../pi-ctx/src/tools/claim.js";
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

function saysNotBuilt(rec: JudgmentRecord): boolean {
  return /\bnot built\b/i.test(`${rec.headline}\n${rec.directive ?? ""}\n${rec.body}`);
}

/** A live not-built decision stays open until some question is recorded at or after it. */
export function unresolvedNotBuilt(live: LiveSet): boolean {
  const questions = [...live.byId.values()].filter((rec) => rec.type === "question");
  for (const rec of live.byId.values()) {
    if (!live.live.has(rec.id) || rec.type !== "decision" || !saysNotBuilt(rec)) continue;
    if (!questions.some((question) => question.ts >= rec.ts)) return true;
  }
  return false;
}

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
  const sessionTip = branch.length > 0 ? branch[branch.length - 1]?.id ?? null : null;
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
    claimedId:
      session.claimedId && live.live.has(session.claimedId) && live.byId.get(session.claimedId)?.type === "question"
        ? session.claimedId
        : null,
    askIds: asks.map((q) => q.id),
    askHeadlines: asks.map((q) => q.headline),
    blocked,
    sessionTip,
    notBuiltOpen: unresolvedNotBuilt(live),
    projectId: session.projectId,
    sessionId,
    records: [...live.byId.values()],
    live,
  };
}

/** Claim the oldest unclaimed frontier question. Does not write the session entry. */
export function prepareClaim(
  branch: Entry[],
  sessionId: string,
  cwd: string,
  questionId: string,
): { ok: true; claimedId: string; noop: boolean } | { ok: false; error: string } {
  const session = foldSession(branch, sessionId);
  if (!session.bound || !session.projectId) return { ok: false, error: "no project bound" };
  if (session.grantId && session.grantQuestionId !== questionId) return { ok: false, error: "worker claim limited" };
  const live = loadProjectLive(session.projectId);
  const prior = session.claimedId ? live.byId.get(session.claimedId) : undefined;
  const liveClaim = prior && prior.type === "question" && live.live.has(prior.id) ? prior.id : null;
  const config = loadConfig(cwd);
  const result = applyClaim({
    action: "claim",
    question_id: questionId,
    bound: true,
    enabled: session.enabled,
    claimedId: liveClaim,
    live,
    occupancy: resolveOccupancy(session, config.occupancy),
    siblingKnob: config.gatedEdgeSiblingHeadlines,
  });
  if (!result.ok || !result.claimed_id) return result.ok ? { ok: false, error: "not_found" } : result;
  return { ok: true, claimedId: result.claimed_id, noop: result.noop === true };
}

export function closedQuestions(live: LiveSet): { id: string; headline: string; body: string; superseded: string }[] {
  const children = new Map<string, string[]>();
  for (const rec of live.byId.values()) {
    for (const id of rec.supersedes ?? []) {
      const list = children.get(id) ?? [];
      list.push(rec.id);
      children.set(id, list);
    }
  }
  const tip = (id: string, seen: Set<string>): JudgmentRecord | undefined => {
    if (seen.has(id)) return undefined;
    seen.add(id);
    for (const childId of children.get(id) ?? []) {
      const child = live.byId.get(childId);
      if (child && live.live.has(child.id)) return child;
      const later = tip(childId, seen);
      if (later) return later;
    }
    return undefined;
  };
  const out: { id: string; headline: string; body: string; superseded: string }[] = [];
  for (const rec of live.byId.values()) {
    if (rec.type !== "question" || live.live.has(rec.id)) continue;
    const closer = tip(rec.id, new Set());
    if (!closer) continue;
    out.push({ id: closer.id, headline: closer.headline, body: closer.directive || closer.body, superseded: rec.id });
  }
  return out;
}
