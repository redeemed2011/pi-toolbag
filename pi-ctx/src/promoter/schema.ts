export const PROMOTER_N = 10;
export const PROMOTER_CHARS = 280;
export const PENDING_REPLACE_CAP = 10;
export const PENDING_HITL_TURNS = 3;

export type PromoterPromote = {
	quote: string;
	headline?: string;
};

export type PromoterPending = {
	quote: string;
	live_id: string;
	reason?: string;
};

export type PromoterResult = {
	promote: PromoterPromote[];
	pending_replace: PromoterPending[];
};

export function emptyPromoterResult(): PromoterResult {
	return { promote: [], pending_replace: [] };
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function parsePromoterResult(raw: unknown): PromoterResult {
	if (!raw || typeof raw !== "object") return emptyPromoterResult();
	const obj = raw as Record<string, unknown>;
	const promote: PromoterPromote[] = [];
	if (Array.isArray(obj.promote)) {
		for (const item of obj.promote) {
			if (!item || typeof item !== "object") continue;
			const quote = asString((item as { quote?: unknown }).quote);
			if (!quote) continue;
			const headline = asString((item as { headline?: unknown }).headline);
			promote.push(headline ? { quote, headline } : { quote });
		}
	}
	const pending_replace: PromoterPending[] = [];
	if (Array.isArray(obj.pending_replace)) {
		for (const item of obj.pending_replace) {
			if (!item || typeof item !== "object") continue;
			const rec = item as { quote?: unknown; live_id?: unknown; reason?: unknown };
			const quote = asString(rec.quote);
			const live_id = asString(rec.live_id);
			if (!quote || !live_id) continue;
			const reason = asString(rec.reason);
			pending_replace.push(reason ? { quote, live_id, reason } : { quote, live_id });
		}
	}
	return { promote, pending_replace };
}
