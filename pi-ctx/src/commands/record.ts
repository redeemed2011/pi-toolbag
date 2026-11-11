import { foldLive } from "../fold.js";
import type { Hitl } from "../hitl.js";
import type { PutErr, PutInput, PutOk } from "../mint.js";
import { executeRecord } from "../tools/record.js";
import type { JudgmentRecord, Occupancy } from "../types.js";

const GATE_TELL = "If you cannot resolve it, tell the user the constraint list is full.";

export function gateAgentMessage(occupancy: Occupancy): string {
	const resolve =
		occupancy === "claim-strip"
			? "Resolve it by calling ctx_record again with supersedes set to the live constraint this replaces and reason_class decision_change, or with applies_to set to one live question other than the claimed question."
			: "Resolve it by calling ctx_record again with supersedes set to the live constraint this replaces and reason_class decision_change. Narrowing applies_to does not shrink this list.";
	return `The constraint list is full. ${resolve} ${GATE_TELL}`;
}

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

/**
 * Mint write with live_conflict HITL.
 * A full constraint list does not open a dialog. The error goes back to the agent.
 */
export async function runRecordFlow(
	opts: RecordFlowOpts,
): Promise<PutOk | PutErr | { ok: false; error: string }> {
	const first = executeRecord(opts);
	if (first.ok) return first;
	if (first.error === "live_conflict") return openLiveConflict(opts, first);
	if (first.error !== "gate") return first;
	return { ...first, message: gateAgentMessage(opts.occupancy) };
}
