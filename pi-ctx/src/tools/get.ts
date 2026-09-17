import { bodySetCS, bodySetGE } from "../fold.js";
import { claimedBodyOrEmpty } from "../render/gated-edge.js";
import { gateCheck } from "../render/occupancy.js";
import type { JudgmentRecord, LiveSet, Observation, Occupancy } from "../types.js";

export const RETRIEVE_HEADLINE_CAP = 20;

export function claimView(live: LiveSet, claimedId: string | null) {
	const info = claimedBodyOrEmpty(live, claimedId);
	const q = claimedId ? live.byId.get(claimedId) : undefined;
	return {
		claimed_id: claimedId,
		claim_empty: info.claim_empty,
		claim_not_live: info.claim_not_live,
		blocked: info.blocked,
		headline: q?.headline,
		body: info.claim_empty === 1 ? undefined : q?.directive || q?.body,
	};
}

export function lookupRecord(
	id: string,
	live: LiveSet,
	records: JudgmentRecord[],
	observations: Observation[],
): Record<string, unknown> {
	const rec = live.byId.get(id) ?? records.find((r) => r.id === id);
	if (rec) {
		return {
			id: rec.id,
			type: rec.type,
			ts: rec.ts,
			live: live.live.has(rec.id),
			headline: rec.headline,
			directive: rec.directive,
			rationale: rec.rationale,
			applies_to: rec.applies_to,
			parent: rec.parent,
			supersedes: rec.supersedes,
			about_claim_id: rec.about_claim_id,
			blocked: live.blocked.has(rec.id),
			body: rec.body,
		};
	}
	const obs = observations.find((o) => o.id === id);
	if (obs) {
		return {
			id: obs.id,
			type: "observation",
			ts: obs.ts,
			live: true,
			headline: obs.headline,
			body: obs.body,
			about_claim_id: obs.about_claim_id,
		};
	}
	return { error: "not_found", id };
}

export function defaultRetrieve(opts: {
	bound: boolean;
	occupancy: Occupancy;
	claimedId: string | null;
	live: LiveSet;
	recency: Observation[];
}): Record<string, unknown> {
	const recency = opts.recency.slice(0, RETRIEVE_HEADLINE_CAP).map((o) => ({
		id: o.id,
		headline: o.headline,
	}));
	if (!opts.bound) {
		return { bound: false, message: "no project bound", recency };
	}
	const claim = claimView(opts.live, opts.claimedId);
	if (opts.occupancy === "claim-strip") {
		const applied = bodySetCS(opts.live, opts.claimedId);
		const g = gateCheck(applied);
		return {
			occupancy: "claim-strip",
			gate: g.gate,
			law_index: opts.live.constraints.map((c) => ({
				id: c.id,
				headline: c.headline,
				applies_to: c.applies_to,
			})),
			claim,
			recency,
			unapplied: Math.max(0, opts.live.constraints.length - applied.length),
		};
	}
	const bodies = bodySetGE(opts.live);
	const g = gateCheck(bodies);
	if (g.gate === 1) {
		return {
			occupancy: "gated-edge",
			gate: 1,
			constraint_ids: bodies.map((c) => ({ id: c.id, headline: c.headline })),
			claim,
			recency,
			note: "bodies via zoom",
		};
	}
	return {
		occupancy: "gated-edge",
		gate: 0,
		constraints: bodies.map((c) => ({
			id: c.id,
			headline: c.headline,
			applies_to: c.applies_to,
			body: c.directive || c.body,
		})),
		claim,
		recency,
	};
}

export function executeGet(opts: {
	id?: string;
	enabled: boolean;
	bound: boolean;
	occupancy: Occupancy;
	claimedId: string | null;
	live: LiveSet;
	records: JudgmentRecord[];
	observations: Observation[];
	recency: Observation[];
}): unknown {
	if (!opts.enabled) return { error: "ctx is off" };
	if (opts.id) return lookupRecord(opts.id, opts.live, opts.records, opts.observations);
	return defaultRetrieve(opts);
}
