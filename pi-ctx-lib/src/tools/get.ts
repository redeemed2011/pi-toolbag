import { authorDisplayEnabled, authorOf } from "../author.js";
import { bodySetCS, bodySetGE } from "../fold.js";
import { claimedBodyOrEmpty } from "../render/gated-edge.js";
import { gateCheck } from "../render/occupancy.js";
import type { JudgmentRecord, LiveSet, Observation, Occupancy } from "../types.js";
import { evidenceExpired } from "../evidence.js";

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

function supportExpired(
	rec: JudgmentRecord,
	live: LiveSet,
	records: JudgmentRecord[],
	now: number,
): boolean | undefined {
	const id = rec.citation_target;
	if (!id) return undefined;
	const target = live.byId.get(id) ?? records.find((r) => r.id === id);
	if (!target || target.type !== "evidence" || !target.expires_at) return undefined;
	return evidenceExpired(target.expires_at, now);
}

export const SHORT_ID_MIN = 8;

function resolveId(
	raw: string,
	live: LiveSet,
	records: JudgmentRecord[],
	observations: Observation[],
): { id: string } | { error: string; candidates?: string[] } {
	const exact = raw.trim();
	if (live.byId.has(exact) || records.some((r) => r.id === exact) || observations.some((o) => o.id === exact)) return { id: exact };
	const id = exact.toLowerCase();
	if (id.length < SHORT_ID_MIN || !/^[0-9a-f-]+$/.test(id)) return { error: "not_found" };
	const matches = new Set<string>();
	for (const r of records) if (r.id.startsWith(id)) matches.add(r.id);
	for (const key of live.byId.keys()) if (key.startsWith(id)) matches.add(key);
	for (const o of observations) if (o.id.startsWith(id)) matches.add(o.id);
	if (matches.size === 1) return { id: [...matches][0] as string };
	if (matches.size > 1) return { error: "ambiguous", candidates: [...matches].sort() };
	return { error: "not_found" };
}

export function lookupRecord(
	rawId: string,
	live: LiveSet,
	records: JudgmentRecord[],
	observations: Observation[],
	now = Date.now(),
	includeAuthor?: boolean,
): Record<string, unknown> {
	const resolved = resolveId(rawId, live, records, observations);
	if ("error" in resolved) {
		return resolved.candidates ? { error: resolved.error, id: rawId, candidates: resolved.candidates } : { error: resolved.error, id: rawId };
	}
	const id = resolved.id;
	const showAuthor = authorDisplayEnabled(includeAuthor);
	const rec = live.byId.get(id) ?? records.find((r) => r.id === id);
	if (rec) {
		const view: Record<string, unknown> = {
			id: rec.id,
			type: rec.type,
			ts: rec.ts,
			live: live.live.has(rec.id),
			...(showAuthor ? { author: authorOf(rec) } : {}),
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
		if (rec.type === "question") view.ask_operator = live.askOperator.has(rec.id);
		if (rec.type === "question") {
			view.findings = records
				.filter((item) => item.type === "finding" && item.parent === rec.id)
				.map((item) => ({
					id: item.id,
					session: item.session,
					...(showAuthor ? { author: authorOf(item) } : {}),
					headline: item.headline,
					live: live.live.has(item.id),
				}));
		}
		if (rec.citation_target) view.citation_target = rec.citation_target;
		if (rec.type === "evidence") {
			view.blob_hash = rec.blob_hash;
			view.byte_size = rec.byte_size;
			view.producer = rec.producer;
			view.expires_at = rec.expires_at;
			view.expired = rec.expires_at ? evidenceExpired(rec.expires_at, now) : true;
		}
		const support = supportExpired(rec, live, records, now);
		if (support !== undefined) view.support_expired = support;
		return view;
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
	includeAuthor?: boolean;
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
	const showAuthor = authorDisplayEnabled(opts.includeAuthor);
	return {
		occupancy: "gated-edge",
		gate: 0,
		constraints: bodies.map((c) => ({
			id: c.id,
			headline: c.headline,
			applies_to: c.applies_to,
			...(showAuthor ? { author: authorOf(c) } : {}),
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
	now?: number;
	includeAuthor?: boolean;
}): Record<string, unknown> {
	if (!opts.enabled) return { error: "ctx is off" };
	if (opts.id) return lookupRecord(opts.id, opts.live, opts.records, opts.observations, opts.now, opts.includeAuthor);
	return defaultRetrieve(opts);
}
