/** Session JSONL / branch entries we fold. Subset of Pi SessionEntry. */
export type Entry = {
	type: string;
	id: string;
	parentId?: string | null;
	timestamp?: number | string;
	message?: {
		role?: string;
		content?: unknown;
		excludeFromContext?: boolean;
		command?: string;
		output?: string;
		stopReason?: string;
		errorMessage?: string;
		toolName?: string;
	};
	content?: unknown;
	customType?: string;
	data?: unknown;
	summary?: unknown;
	firstKeptEntryId?: string;
	excludeFromContext?: boolean;
};

export const CTX_ENABLED = "ctx.enabled";
export const CTX_OCCUPANCY = "ctx.occupancy";
export const CTX_CLAIM = "ctx.claim";
export const CTX_BIND = "ctx.bind";
export const CTX_PROMOTION_DECISION = "ctx.promotion.decision";
export const CTX_OBSERVATIONS_RECORDED = "ctx.observations.recorded";
export const CTX_OBSERVATIONS_EMPTY_COVER = "ctx.observations.empty_cover";
export const CTX_RESUME = "ctx.resume";
export const CTX_FOLDED = "ctx.folded";
export const CTX_PROMOTER_LATCH = "ctx.promoter.latch";
export const CTX_PENDING_TURN = "ctx.pending_replace.turns";
export const CTX_PENDING_INJECT = "ctx.pending_replace.inject";
export const CTX_STATUS_INJECT = "ctx.status";
export const FOOTER_TAG = "ctx.constitution-footer";

export type Occupancy = "gated-edge" | "claim-strip";

export type Observation = {
	id: string;
	headline: string;
	body: string;
	coversUpToId: string;
	about_claim_id?: string;
	ts: string;
	session: string;
};

export type ObservationsRecordedData = {
	observations: Observation[];
	coversUpToId: string;
	about_claim_id?: string;
};

export type EmptyCoverData = {
	coversUpToId: string;
	about_claim_id?: string;
};

export type RecordKind =
	| "constraint"
	| "decision"
	| "question"
	| "fog"
	| "destination"
	| "out_of_scope"
	| "finding"
	| "tombstone"
	| "citation"
	| "evidence"
	| "pending_replace"
	| "observation";

/** `applies_to` is required at mint: `"all"` or question ids. Missing refuses. Never default to all. */
export type AppliesTo = "all" | string[];

export type ReasonClass = "clarification" | "decision_change" | "conflict";

export type PromotionDecision = "minted" | "final_skip" | "not_final";

export type JudgmentRecord = {
	id: string;
	type: Exclude<RecordKind, "observation">;
	ts: string;
	session: string;
	headline: string;
	body: string;
	directive?: string;
	rationale?: string;
	applies_to?: AppliesTo;
	supersedes?: string[];
	parent?: string;
	blocks?: string[];
	conflicts_with?: string[];
	about_claim_id?: string;
	reason_class?: ReasonClass;
	citation_target?: string;
	blob_hash?: string;
	byte_size?: number;
	producer?: string;
	expires_at?: string;
};

export type LiveSet = {
	byId: Map<string, JudgmentRecord>;
	live: Set<string>;
	constraints: JudgmentRecord[];
	questions: JudgmentRecord[];
	destinations: JudgmentRecord[];
	outOfScope: JudgmentRecord[];
	fog: JudgmentRecord[];
	pendingReplaces: JudgmentRecord[];
	blocked: Set<string>;
	liveConflict: string[];
};

export type SessionFold = {
	enabled: boolean;
	bound: boolean;
	projectId: string | null;
	claimedId: string | null;
	occupancy: Occupancy | null;
	observations: Observation[];
	recency: Observation[];
	promoterLatched?: boolean;
	pendingReplaceTurns?: number;
	grantId: string | null;
	grantQuestionId: string | null;
};

export type PackedInject = {
	text: string;
	gate: 0 | 1;
	claim_truncated: 0 | 1;
};

export function isOccupancy(value: unknown): value is Occupancy {
	return value === "gated-edge" || value === "claim-strip";
}

export function isReasonClass(value: unknown): value is ReasonClass {
	return value === "clarification" || value === "decision_change" || value === "conflict";
}

export function isJudgmentType(value: string): value is Exclude<RecordKind, "observation"> {
	return (
		value === "constraint" ||
		value === "decision" ||
		value === "question" ||
		value === "fog" ||
		value === "destination" ||
		value === "out_of_scope" ||
		value === "finding" ||
		value === "tombstone" ||
		value === "citation" ||
		value === "evidence" ||
		value === "pending_replace"
	);
}

export function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
