import { bodySetCS, bodySetGE, foldLive } from "../fold.js";
import type { Hitl } from "../hitl.js";
import type { PutErr, PutInput, PutOk } from "../mint.js";
import { executeRecord } from "../tools/record.js";
import type { JudgmentRecord, Occupancy } from "../types.js";

export const GATE_REFUSE = "refuse write";
export const GATE_SUPERSEDE = "supersede a live constraint";
export const GATE_SPLIT = "split applies_to";

export type RecordFlowOpts = {
	hitl: Hitl;
	enabled: boolean;
	bound: boolean;
	occupancy: Occupancy;
	siblingKnob: 0 | 2;
	claimedId: string | null;
	existing: JudgmentRecord[];
	input: PutInput;
};

function labelOf(rec: JudgmentRecord): string {
	return `${rec.id} — ${rec.headline}`;
}

function pickId(records: JudgmentRecord[], picked: string | undefined): string | undefined {
	if (!picked) return undefined;
	return records.find((r) => labelOf(r) === picked)?.id;
}

function retry(opts: RecordFlowOpts, input: PutInput): PutOk | PutErr | { ok: false; error: string } {
	return executeRecord({ ...opts, input });
}

function recordsForIds(existing: JudgmentRecord[], ids: string[]): JudgmentRecord[] {
	const live = foldLive(existing);
	const out: JudgmentRecord[] = [];
	for (const id of ids) {
		const rec = live.byId.get(id);
		if (rec) out.push(rec);
	}
	return out;
}

/**
 * TUI `select` which conflicting live constraint to supersede; print stays `"live_conflict"`.
 * Retry is mechanical: leftover conflicts refuse without looping HITL.
 */
async function openLiveConflict(
	opts: RecordFlowOpts,
	conflict: PutErr,
): Promise<PutOk | PutErr | { ok: false; error: string }> {
	if (!opts.hitl.hasUI) return conflict;
	const records = recordsForIds(opts.existing, conflict.conflict_ids ?? []);
	if (records.length === 0) return conflict;
	const picked = await opts.hitl.select("Supersede which live constraint?", records.map(labelOf));
	const id = pickId(records, picked);
	if (!id) return { ok: false, error: "cancelled" };
	return retry(opts, {
		...opts.input,
		supersedes: id,
		reason_class: "conflict",
	});
}

async function openSupersede(opts: RecordFlowOpts, gate: PutErr): Promise<PutOk | PutErr | { ok: false; error: string }> {
	const live = foldLive(opts.existing);
	const bodies = opts.occupancy === "claim-strip" ? bodySetCS(live, opts.claimedId) : bodySetGE(live);
	if (bodies.length === 0) return gate;
	const picked = await opts.hitl.select("Supersede which live constraint?", bodies.map(labelOf));
	const id = pickId(bodies, picked);
	if (!id) return { ok: false, error: "cancelled" };
	return retry(opts, {
		...opts.input,
		supersedes: id,
		reason_class: opts.input.reason_class ?? "decision_change",
	});
}

async function openSplit(opts: RecordFlowOpts, gate: PutErr): Promise<PutOk | PutErr | { ok: false; error: string }> {
	const live = foldLive(opts.existing);
	if (live.questions.length === 0) return gate;
	const picked = await opts.hitl.select("Split applies_to to one question", live.questions.map(labelOf));
	const id = pickId(live.questions, picked);
	if (!id) return { ok: false, error: "cancelled" };
	return retry(opts, { ...opts.input, applies_to: [id] });
}

/**
 * Mint write with live_conflict and GATE overflow HITL.
 * Print stays refuse `"live_conflict"` / `"gate"`.
 * TUI GATE: refuse-first `select` (Pi `confirm()` is Yes-first and cannot refuse-default).
 */
export async function runRecordFlow(
	opts: RecordFlowOpts,
): Promise<PutOk | PutErr | { ok: false; error: string }> {
	const first = executeRecord(opts);
	if (first.ok) return first;
	if (first.error === "live_conflict") return openLiveConflict(opts, first);
	if (first.error !== "gate") return first;
	if (!opts.hitl.hasUI) return first;

	const choice = await opts.hitl.select("Mint would GATE", [GATE_REFUSE, GATE_SUPERSEDE, GATE_SPLIT]);
	if (!choice || choice === GATE_REFUSE) return first;
	if (choice === GATE_SUPERSEDE) return openSupersede(opts, first);
	if (choice === GATE_SPLIT) return openSplit(opts, first);
	return { ok: false, error: "cancelled" };
}
