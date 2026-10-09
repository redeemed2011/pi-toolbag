import {
	CTX_BIND,
	CTX_CLAIM,
	CTX_ENABLED,
	CTX_OCCUPANCY,
	CTX_PROMOTION_DECISION,
	CTX_OBSERVATIONS_RECORDED,
	CTX_PROMOTER_LATCH,
	CTX_PENDING_TURN,
	isOccupancy,
	isPlainRecord,
	isNonEmptyString,
	type AppliesTo,
	type Entry,
	type JudgmentRecord,
	type LiveSet,
	type Observation,
	type Occupancy,
	type PromotionDecision,
	type SessionFold,
} from "./types.js";

function lastCustom<T>(entries: Entry[], customType: string, read: (data: unknown) => T | undefined): T | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "custom" || entry.customType !== customType) continue;
		const value = read(entry.data);
		if (value !== undefined) return value;
	}
	return undefined;
}

function parseObservation(raw: unknown, fallbackCover: string, fallbackSession: string): Observation | undefined {
	if (!isPlainRecord(raw)) return undefined;
	const headline = typeof raw.headline === "string" ? raw.headline : typeof raw.content === "string" ? raw.content : "";
	if (!headline.trim()) return undefined;
	const body = typeof raw.body === "string" ? raw.body : headline;
	const id = typeof raw.id === "string" ? raw.id : typeof raw.timestamp === "string" ? raw.timestamp : "";
	if (!id) return undefined;
	const coversUpToId = typeof raw.coversUpToId === "string" ? raw.coversUpToId : fallbackCover;
	const about = typeof raw.about_claim_id === "string" ? raw.about_claim_id : undefined;
	const ts = typeof raw.ts === "string" ? raw.ts : typeof raw.timestamp === "string" ? raw.timestamp : "";
	const session = typeof raw.session === "string" ? raw.session : fallbackSession;
	return { id, headline: headline.trim(), body, coversUpToId, about_claim_id: about, ts, session };
}

export function foldSession(entries: Entry[], sessionId = ""): SessionFold {
	const enabled = lastCustom(entries, CTX_ENABLED, (data) => {
		if (!isPlainRecord(data) || typeof data.enabled !== "boolean") return undefined;
		return data.enabled;
	});
	const occupancy = lastCustom(entries, CTX_OCCUPANCY, (data) => {
		if (!isPlainRecord(data) || !isOccupancy(data.occupancy)) return undefined;
		return data.occupancy;
	});
	const claimedId = lastCustom(entries, CTX_CLAIM, (data) => {
		if (!isPlainRecord(data)) return undefined;
		if (data.claimed_question_id === null) return null;
		if (typeof data.claimed_question_id === "string") return data.claimed_question_id;
		return undefined;
	});
	const bind = lastCustom(entries, CTX_BIND, (data) => {
		if (!isPlainRecord(data)) return undefined;
		if (data.project_id === null || data.projectId === null) {
			return { projectId: null as string | null, grantId: null as string | null, grantQuestionId: null as string | null };
		}
		const projectId = typeof data.project_id === "string"
			? data.project_id
			: typeof data.projectId === "string"
				? data.projectId
				: undefined;
		if (projectId === undefined) return undefined;
		const grantId = typeof data.grant_id === "string" && data.grant_id.length > 0 ? data.grant_id : null;
		const grantQuestionId = typeof data.question_id === "string" && data.question_id.length > 0 ? data.question_id : null;
		return { projectId, grantId, grantQuestionId };
	});

	const observations: Observation[] = [];
	const seen = new Set<string>();
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== CTX_OBSERVATIONS_RECORDED) continue;
		if (!isPlainRecord(entry.data) || !Array.isArray(entry.data.observations)) continue;
		const cover = typeof entry.data.coversUpToId === "string" ? entry.data.coversUpToId : "";
		const stamp = typeof entry.data.about_claim_id === "string" ? entry.data.about_claim_id : undefined;
		for (const raw of entry.data.observations) {
			const obs = parseObservation(raw, cover, sessionId);
			if (!obs) continue;
			if (stamp && !obs.about_claim_id) obs.about_claim_id = stamp;
			if (seen.has(obs.id)) continue;
			seen.add(obs.id);
			observations.push(obs);
		}
	}

	return {
		enabled: enabled ?? true,
		bound: typeof bind?.projectId === "string" && bind.projectId.length > 0,
		projectId: typeof bind?.projectId === "string" ? bind.projectId : null,
		grantId: bind?.grantId ?? null,
		grantQuestionId: bind?.grantQuestionId ?? null,
		claimedId: claimedId === undefined ? null : claimedId,
		occupancy: occupancy ?? null,
		observations,
		recency: [...observations].reverse(),
		promoterLatched: lastCustom(entries, CTX_PROMOTER_LATCH, (data) => {
			if (!isPlainRecord(data) || data.latched !== true) return undefined;
			return true;
		}) ?? false,
		pendingReplaceTurns: lastCustom(entries, CTX_PENDING_TURN, (data) => {
			if (!isPlainRecord(data) || typeof data.n !== "number" || !Number.isInteger(data.n) || data.n < 0) return undefined;
			return data.n;
		}) ?? 0,
	};
}

export function resolveOccupancy(session: Pick<SessionFold, "occupancy">, settingsOccupancy?: Occupancy): Occupancy {
	if (session.occupancy) return session.occupancy;
	if (settingsOccupancy) return settingsOccupancy;
	return "gated-edge";
}

export function parseAppliesTo(value: unknown): AppliesTo | undefined {
	// Tool-calling unions often send ["all"] instead of the string "all".
	// That is not a missing applies_to and not a question id.
	if (value === "all") return "all";
	if (Array.isArray(value) && value.length === 1 && value[0] === "all") return "all";
	if (Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString)) return value;
	return undefined;
}

function recordKey(r: Pick<JudgmentRecord, "ts" | "session" | "id">): string {
	return `${r.ts}\0${r.session}\0${r.id}`;
}

export function sortRecords<T extends Pick<JudgmentRecord, "ts" | "session" | "id">>(records: T[]): T[] {
	return [...records].sort((a, b) => {
		if (a.ts !== b.ts) return a.ts < b.ts ? -1 : 1;
		if (a.session !== b.session) return a.session < b.session ? -1 : 1;
		if (a.id !== b.id) return a.id < b.id ? -1 : 1;
		return 0;
	});
}

/**
 * Union skip-bad-line records, then fold supersession.
 * Two live successors of one parent: keep both and surface live_conflict. No last-writer-wins.
 */
export function foldLive(records: JudgmentRecord[]): LiveSet {
	const sorted = sortRecords(records);
	const byId = new Map<string, JudgmentRecord>();
	for (const rec of sorted) {
		if (!byId.has(rec.id)) byId.set(rec.id, rec);
	}

	const superseded = new Set<string>();
	const childrenOf = new Map<string, string[]>();
	for (const rec of byId.values()) {
		for (const parent of rec.supersedes ?? []) {
			superseded.add(parent);
			const list = childrenOf.get(parent) ?? [];
			list.push(rec.id);
			childrenOf.set(parent, list);
		}
	}

	const live = new Set<string>();
	for (const id of byId.keys()) {
		if (!superseded.has(id)) live.add(id);
	}

	const liveConflict: string[] = [];
	for (const [parent, kids] of childrenOf) {
		const liveKids = kids.filter((id) => live.has(id));
		if (liveKids.length > 1) liveConflict.push(parent);
	}

	const blocked = new Set<string>();
	for (const rec of byId.values()) {
		if (!live.has(rec.id)) continue;
		for (const id of rec.blocks ?? []) blocked.add(id);
	}

	const ofType = (type: JudgmentRecord["type"]) =>
		[...live].map((id) => byId.get(id)!).filter((r) => r.type === type);

	return {
		byId,
		live,
		constraints: ofType("constraint"),
		questions: ofType("question"),
		destinations: ofType("destination"),
		outOfScope: ofType("out_of_scope"),
		fog: ofType("fog"),
		pendingReplaces: ofType("pending_replace"),
		blocked,
		liveConflict,
	};
}

export function bodySetGE(live: LiveSet): JudgmentRecord[] {
	return live.constraints.filter((c) => live.live.has(c.id));
}

export function bodySetCS(live: LiveSet, claimedId: string | null): JudgmentRecord[] {
	return live.constraints.filter((c) => {
		if (!live.live.has(c.id)) return false;
		const applies = c.applies_to;
		if (applies === "all") return true;
		if (Array.isArray(applies) && claimedId && applies.includes(claimedId)) return true;
		return false;
	});
}

/** Open ∧ unblocked ∧ unclaimed questions, mint-time order (`ts`, then `id`). */
export function frontierItems(
	live: LiveSet,
	claimedId: string | null,
	includeBlocked = false,
): JudgmentRecord[] {
	return live.questions
		.filter((q) => q.id !== claimedId && (includeBlocked || !live.blocked.has(q.id)))
		.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id.localeCompare(b.id)));
}

export function promotionDecisions(entries: Entry[]): Map<string, PromotionDecision> {
	const out = new Map<string, PromotionDecision>();
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== CTX_PROMOTION_DECISION) continue;
		if (!isPlainRecord(entry.data)) continue;
		const id = entry.data.observation_id;
		const decision = entry.data.decision;
		if (typeof id !== "string") continue;
		if (decision === "minted" || decision === "final_skip" || decision === "not_final") {
			out.set(id, decision);
		}
	}
	return out;
}
