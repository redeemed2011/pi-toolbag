import type { Observation } from "./types.js";

const FIRM = /\b(must not|must-not|never)\b/i;
const COND = /\b(only if|unless)\b/i;

export type PromotionCandidate = {
	observationId: string;
	headline: string;
	wording: string;
	kind: "constraint" | "conditional";
	offered: boolean;
};

function words(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.split(/[^a-z0-9]+/g)
			.filter((w) => w.length >= 4),
	);
}

function shares(a: string, b: string): boolean {
	const left = words(a);
	for (const w of words(b)) {
		if (left.has(w)) return true;
	}
	return false;
}

/**
 * Whole-history pool, later-context wording.
 * Firm never → constraint candidate. Conditional stays a conditional.
 * Later extract that qualifies an earlier firm never is not offered (user may override).
 */
export function proposePromotion(
	observations: Observation[],
	skipped: Map<string, "minted" | "final_skip" | "not_final">,
): { offered: PromotionCandidate[]; notOffered: PromotionCandidate[] } {
	const chrono = [...observations].sort((a, b) =>
		a.ts !== b.ts ? (a.ts < b.ts ? -1 : 1) : a.id.localeCompare(b.id),
	);
	const offered: PromotionCandidate[] = [];
	const notOffered: PromotionCandidate[] = [];
	for (let i = 0; i < chrono.length; i++) {
		const o = chrono[i];
		const skip = skipped.get(o.id);
		if (skip === "minted" || skip === "final_skip") continue;
		const text = o.body || o.headline;
		const firm = FIRM.test(text);
		const cond = COND.test(text);
		if (!firm && !cond) continue;
		const later = chrono
			.slice(i + 1)
			.filter((l) => shares(text, l.body || l.headline))
			.map((l) => l.body || l.headline);
		const laterClarified = firm && later.some((t) => COND.test(t));
		const wording = later.length ? `${text}\n\nLater: ${later.join(" | ")}` : text;
		const cand: PromotionCandidate = {
			observationId: o.id,
			headline: o.headline,
			wording,
			kind: cond && !firm ? "conditional" : "constraint",
			offered: !laterClarified,
		};
		if (cand.offered) offered.push(cand);
		else notOffered.push(cand);
	}
	return { offered, notOffered };
}
