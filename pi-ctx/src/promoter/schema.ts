export const PROMOTER_N = 10;
export const PROMOTER_CHARS = 280;
export const PENDING_REPLACE_CAP = 10;
export const PENDING_HITL_TURNS = 3;
export const PROMOTER_SHELF_N = 10;

export const SHELF_TYPES = ["destination", "decision", "out_of_scope", "question", "fog", "finding"] as const;
export type ShelfType = (typeof SHELF_TYPES)[number];

const USER_BODY_TYPES = new Set<ShelfType>(["destination", "out_of_scope", "question"]);

export function isShelfType(value: string): value is ShelfType {
	return (SHELF_TYPES as readonly string[]).includes(value);
}

export function shelfBodyIsUserOnly(type: ShelfType): boolean {
	return USER_BODY_TYPES.has(type);
}

export type PromoterPromote = {
	quote: string;
	headline?: string;
};

export type PromoterPending = {
	quote: string;
	live_id: string;
	reason?: string;
};

export type PromoterShelf = {
	type: ShelfType;
	quote: string;
	headline?: string;
};

export type PromoterResult = {
	promote: PromoterPromote[];
	pending_replace: PromoterPending[];
	shelf?: PromoterShelf[];
};

export function emptyPromoterResult(): PromoterResult {
	return { promote: [], pending_replace: [], shelf: [] };
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
	const shelf: PromoterShelf[] = [];
	if (Array.isArray(obj.shelf)) {
		for (const item of obj.shelf) {
			if (!item || typeof item !== "object") continue;
			const rec = item as { type?: unknown; quote?: unknown; headline?: unknown };
			const type = asString(rec.type);
			const quote = asString(rec.quote);
			if (!type || !isShelfType(type) || !quote) continue;
			const headline = asString(rec.headline);
			shelf.push(headline ? { type, quote, headline } : { type, quote });
		}
	}
	return { promote, pending_replace, shelf };
}
