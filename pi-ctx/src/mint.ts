import { randomUUID } from "node:crypto";
import { bodySetCS, bodySetGE, foldLive } from "./fold.js";
import { claimSlotFits, gateCheck } from "./render/occupancy.js";
import { validateAppliesTo } from "./store/jsonl.js";
import type { AppliesTo, JudgmentRecord, LiveSet, Occupancy, ReasonClass } from "./types.js";
import { parseEvidenceMeta, type EvidenceMeta } from "./evidence.js";

export function mintGateFlags(
	live: LiveSet,
	claimedId: string | null,
): { would_gate_ge: 0 | 1; would_gate_cs: 0 | 1 } {
	return {
		would_gate_ge: gateCheck(bodySetGE(live)).gate,
		would_gate_cs: gateCheck(bodySetCS(live, claimedId)).gate,
	};
}

export function normalizeHeadline(headline: string): string {
	return headline.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export type PutInput = {
	type: JudgmentRecord["type"];
	headline: string;
	body?: string;
	directive?: string;
	rationale?: string;
	applies_to?: unknown;
	supersedes?: string;
	reason_class?: ReasonClass;
	parent?: string;
	blocks?: string[];
	conflicts_with?: string[];
	citation_target?: string;
	blob_hash?: string;
	byte_size?: number;
	producer?: string;
	expires_at?: string;
	id?: string;
	ts?: string;
	session: string;
};

export type PutOk = {
	ok: true;
	record: JudgmentRecord;
	line: Record<string, unknown>;
	would_gate_ge: 0 | 1;
	would_gate_cs: 0 | 1;
};

export type PutErr = {
	ok: false;
	error: string;
	conflict_ids?: string[];
	would_gate_ge?: 0 | 1;
	would_gate_cs?: 0 | 1;
};

export function putJudgment(opts: {
	occupancy: Occupancy;
	siblingKnob: 0 | 2;
	claimedId: string | null;
	existing: JudgmentRecord[];
	input: PutInput;
}): PutOk | PutErr {
	const { input, existing, occupancy, siblingKnob, claimedId } = opts;
	const headline = input.headline.trim();
	if (!headline) return { ok: false, error: "headline required" };
	if (input.type === "evidence" && input.supersedes) return { ok: false, error: "evidence cannot supersede" };
	if (input.type === "evidence" && (input.blocks?.length ?? 0) > 0) {
		return { ok: false, error: "evidence cannot block" };
	}

	const liveBefore = foldLive(existing);

	if (input.supersedes && !input.reason_class) {
		return { ok: false, error: "reason_class required" };
	}
	if (input.supersedes) {
		const target = liveBefore.byId.get(input.supersedes);
		if (!target) return { ok: false, error: "not_found" };
		if (!liveBefore.live.has(input.supersedes)) return { ok: false, error: "already_superseded" };
	}

	if (input.conflicts_with) {
		for (const id of input.conflicts_with) {
			const rec = liveBefore.byId.get(id);
			if (!rec || rec.type !== "constraint" || !liveBefore.live.has(id)) {
				return { ok: false, error: "conflicts_with not_found" };
			}
		}
	}

	let applies_to: AppliesTo | undefined;
	if (input.type === "constraint") {
		const directive = (input.directive ?? "").trim();
		if (!directive) return { ok: false, error: "directive required" };
		const applies = validateAppliesTo(
			input.applies_to,
			liveBefore.questions.map((q) => q.id),
		);
		if (!applies.ok) {
			if (applies.error === "applies_to_missing") return { ok: false, error: "applies_to required" };
			if (applies.error === "applies_to_empty") return { ok: false, error: "applies_to empty refuses" };
			return { ok: false, error: "applies_to dangling" };
		}
		applies_to = applies.applies_to;
	}

	if (input.type === "question") {
		const q = { directive: input.directive, body: input.body || headline };
		if (!claimSlotFits(q, occupancy, siblingKnob)) {
			return { ok: false, error: "question_too_large" };
		}
	}

	let evidence: EvidenceMeta | undefined;
	if (input.type === "evidence") {
		const parsed = parseEvidenceMeta(input);
		if (!parsed.ok) return { ok: false, error: parsed.error };
		evidence = parsed;
	}

	const directive = input.directive?.trim() || undefined;
	const record: JudgmentRecord = {
		id: input.id ?? randomUUID(),
		type: input.type,
		ts: input.ts ?? new Date().toISOString(),
		session: input.session,
		headline,
		body: (input.body ?? directive ?? headline).trim(),
		directive,
		rationale: input.rationale?.trim() || undefined,
		applies_to,
		supersedes: input.supersedes ? [input.supersedes] : undefined,
		parent: input.parent,
		blocks: input.blocks,
		conflicts_with: input.conflicts_with,
		reason_class: input.reason_class,
		citation_target: input.citation_target,
		blob_hash: evidence?.blob_hash,
		byte_size: evidence?.byte_size,
		producer: evidence?.producer,
		expires_at: evidence?.expires_at,
	};

	const after = foldLive([...existing, record]);
	const flags = mintGateFlags(after, claimedId);

	if (record.type === "constraint") {
		const norm = normalizeHeadline(record.headline);
		const superseded = new Set(record.supersedes ?? []);
		const conflicts: string[] = [];
		for (const c of after.constraints) {
			if (c.id === record.id) continue;
			if (normalizeHeadline(c.headline) === norm && !superseded.has(c.id)) conflicts.push(c.id);
		}
		if (record.conflicts_with) {
			for (const id of record.conflicts_with) {
				if (id !== record.id && !superseded.has(id) && !conflicts.includes(id)) conflicts.push(id);
			}
		}
		if (conflicts.length > 0) {
			return { ok: false, error: "live_conflict", conflict_ids: conflicts, ...flags };
		}
		const would = occupancy === "claim-strip" ? flags.would_gate_cs : flags.would_gate_ge;
		if (would === 1) return { ok: false, error: "gate", ...flags };
	}

	const line: Record<string, unknown> = { ...record };
	return { ok: true, record, line, ...flags };
}
