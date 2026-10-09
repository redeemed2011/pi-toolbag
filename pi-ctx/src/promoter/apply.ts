import { foldLive } from "../fold.js";
import { normalizeHeadline, putJudgment } from "../mint.js";
import { appendProjectRecord } from "../store/project.js";
import { executeRecord } from "../tools/record.js";
import type { JudgmentRecord, Occupancy } from "../types.js";
import { quoteInCorpus } from "./quotes.js";
import {
	PENDING_REPLACE_CAP,
	PROMOTER_CHARS,
	PROMOTER_N,
	PROMOTER_SHELF_N,
	shelfBodyIsUserOnly,
	type PromoterResult,
} from "./schema.js";

export type ApplyOpts = {
	projectId: string;
	sessionId: string;
	occupancy: Occupancy;
	siblingKnob: 0 | 2;
	claimedId: string | null;
	existing: JudgmentRecord[];
	corpus: string[];
	assistant?: string[];
	result: PromoterResult;
};

export type ApplyReport = {
	promoted: JudgmentRecord[];
	pending: JudgmentRecord[];
	shelf: JudgmentRecord[];
	skipped: string[];
	stopped?: "gate" | "live_conflict";
	existing: JudgmentRecord[];
};

function headlineOf(quote: string, suggested?: string): string {
	const h = (suggested ?? quote).replace(/\s+/g, " ").trim();
	return h.length <= 80 ? h : `${h.slice(0, 77)}...`;
}

export function applyPromoterResult(opts: ApplyOpts): ApplyReport {
	let existing = [...opts.existing];
	const promoted: JudgmentRecord[] = [];
	const pending: JudgmentRecord[] = [];
	const shelf: JudgmentRecord[] = [];
	const skipped: string[] = [];
	const pendingQuotes = new Set<string>();

	const live0 = foldLive(existing);
	const pendingItems = opts.result.pending_replace.slice(0, PENDING_REPLACE_CAP);
	for (const item of pendingItems) {
		if (item.quote.trim().length > PROMOTER_CHARS) {
			skipped.push("pending over 280");
			continue;
		}
		if (!quoteInCorpus(item.quote, opts.corpus)) {
			skipped.push("pending not verbatim");
			continue;
		}
		const liveRec = live0.byId.get(item.live_id);
		if (!liveRec || liveRec.type !== "constraint" || !live0.live.has(item.live_id)) {
			skipped.push("pending live_id not live constraint");
			continue;
		}
		if (normalizeHeadline(item.quote) === normalizeHeadline(liveRec.headline)) {
			skipped.push("pending duplicate headline");
			continue;
		}
		const put = putJudgment({
			occupancy: opts.occupancy,
			siblingKnob: opts.siblingKnob,
			claimedId: opts.claimedId,
			existing,
			input: {
				type: "pending_replace",
				headline: `Replace: ${liveRec.headline}`,
				body: item.quote,
				directive: item.reason ?? `Supersede ${item.live_id} with this user quote?`,
				parent: item.live_id,
				session: opts.sessionId,
			},
		});
		if (!put.ok) {
			skipped.push(`pending ${put.error}`);
			continue;
		}
		appendProjectRecord(opts.projectId, opts.sessionId, put.line);
		existing = [...existing, put.record];
		pending.push(put.record);
		pendingQuotes.add(item.quote.replace(/\s+/g, " ").trim());
	}

	let stopped: ApplyReport["stopped"];
	const promoteItems = opts.result.promote.slice(0, PROMOTER_N);
	for (const item of promoteItems) {
		if (stopped) {
			skipped.push("skipped after stop");
			continue;
		}
		const quote = item.quote.trim();
		if (quote.length > PROMOTER_CHARS) {
			skipped.push("promote over 280");
			continue;
		}
		if (!quoteInCorpus(quote, opts.corpus)) {
			skipped.push("promote not verbatim");
			continue;
		}
		if (pendingQuotes.has(quote.replace(/\s+/g, " ").trim())) {
			skipped.push("promote also pending_replace");
			continue;
		}
		const live = foldLive(existing);
		const head = headlineOf(quote, item.headline);
		const norm = normalizeHeadline(head);
		if (live.constraints.some((c) => live.live.has(c.id) && normalizeHeadline(c.headline) === norm)) {
			skipped.push("promote duplicate headline");
			continue;
		}
		const minted = executeRecord({
			enabled: true,
			bound: true,
			occupancy: opts.occupancy,
			siblingKnob: opts.siblingKnob,
			claimedId: opts.claimedId,
			existing,
			input: {
				type: "constraint",
				headline: head,
				body: quote,
				directive: quote,
				applies_to: "all",
				session: opts.sessionId,
			},
		});
		if (!minted.ok) {
			if (minted.error === "gate" || minted.error === "live_conflict") {
				stopped = minted.error;
				skipped.push(`promote ${minted.error}`);
				continue;
			}
			skipped.push(`promote ${minted.error}`);
			continue;
		}
		appendProjectRecord(opts.projectId, opts.sessionId, minted.line);
		existing = [...existing, minted.record];
		promoted.push(minted.record);
	}

	const assistant = opts.assistant ?? [];
	const shelfItems = (opts.result.shelf ?? []).slice(0, PROMOTER_SHELF_N);
	for (const item of shelfItems) {
		const quote = item.quote.trim();
		if (quote.length > PROMOTER_CHARS) {
			skipped.push("shelf over 280");
			continue;
		}
		const fromUser = quoteInCorpus(quote, opts.corpus);
		const fromAssistant = quoteInCorpus(quote, assistant);
		if (shelfBodyIsUserOnly(item.type)) {
			if (!fromUser) {
				skipped.push("shelf not user verbatim");
				continue;
			}
		} else if (!fromUser && !fromAssistant) {
			skipped.push("shelf not verbatim");
			continue;
		}
		const source = fromUser ? "user" : "assistant";
		const live = foldLive(existing);
		if (item.type === "destination" && live.destinations.some((d) => live.live.has(d.id))) {
			skipped.push("shelf destination exists");
			continue;
		}
		const head = headlineOf(quote, item.headline);
		const norm = normalizeHeadline(head);
		const duplicate = [...live.byId.values()].some(
			(r) => live.live.has(r.id) && normalizeHeadline(r.headline) === norm,
		);
		if (duplicate) {
			skipped.push("shelf duplicate headline");
			continue;
		}
		const minted = executeRecord({
			enabled: true,
			bound: true,
			occupancy: opts.occupancy,
			siblingKnob: opts.siblingKnob,
			claimedId: opts.claimedId,
			existing,
			input: {
				type: item.type,
				headline: head,
				body: quote,
				rationale: `source: ${source}`,
				session: opts.sessionId,
			},
		});
		if (!minted.ok) {
			skipped.push(`shelf ${minted.error}`);
			continue;
		}
		appendProjectRecord(opts.projectId, opts.sessionId, minted.line);
		existing = [...existing, minted.record];
		shelf.push(minted.record);
	}

	return { promoted, pending, shelf, skipped, stopped, existing };
}
