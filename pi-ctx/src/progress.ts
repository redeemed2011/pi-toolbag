import { estimateEntryTokens, isSourceEntry, isValidCutPoint } from "./tokens.js";
import {
	CTX_OBSERVATIONS_EMPTY_COVER,
	CTX_OBSERVATIONS_RECORDED,
	entryIndexById,
	findLastCompactionIndex,
	type Entry,
} from "pi-ctx-lib";

export { entryIndexById, findLastCompactionIndex };

export function entryIndexForId(entries: Entry[], entryId: string | undefined): number {
	if (!entryId) return -1;
	return entryIndexById(entries).get(entryId) ?? -1;
}

export function rawTokensAfterIndex(entries: Entry[], index: number): number {
	let total = 0;
	for (let i = Math.max(0, index + 1); i < entries.length; i++) {
		total += estimateEntryTokens(entries[i]);
	}
	return total;
}

/** Suffix from `index` inclusive (Pi firstKeptEntryId onward). */
export function rawTokensFrom(entries: Entry[], index: number): number {
	let total = 0;
	for (let i = Math.max(0, index); i < entries.length; i++) {
		total += estimateEntryTokens(entries[i]);
	}
	return total;
}

function isCoverageEntry(entry: Entry): entry is Entry & { data: { coversUpToId: string } } {
	if (entry.type !== "custom") return false;
	if (entry.customType !== CTX_OBSERVATIONS_RECORDED && entry.customType !== CTX_OBSERVATIONS_EMPTY_COVER) {
		return false;
	}
	const data = entry.data;
	return !!data && typeof data === "object" && typeof (data as { coversUpToId?: unknown }).coversUpToId === "string";
}

export function latestCoverageMarkerId(entries: Entry[]): string | undefined {
	const idToIndex = entryIndexById(entries);
	let latestIndex = -1;
	let latestMarkerId: string | undefined;
	for (const entry of entries) {
		if (!isCoverageEntry(entry)) continue;
		const coveredIndex = idToIndex.get(entry.data.coversUpToId);
		if (coveredIndex === undefined) continue;
		if (coveredIndex > latestIndex) {
			latestIndex = coveredIndex;
			latestMarkerId = entry.data.coversUpToId;
		}
	}
	return latestMarkerId;
}

export function rawTokensSinceLastCompaction(entries: Entry[]): number {
	const compactionIndex = findLastCompactionIndex(entries);
	if (compactionIndex === -1) return rawTokensAfterIndex(entries, -1);
	const firstKeptEntryId = entries[compactionIndex].firstKeptEntryId;
	const firstKeptIndex = entryIndexForId(entries, firstKeptEntryId);
	if (firstKeptIndex === -1) return rawTokensAfterIndex(entries, compactionIndex);
	return rawTokensAfterIndex(entries, firstKeptIndex - 1);
}

export type SourceSlice = {
	entries: Entry[];
	coversUpToId: string | undefined;
	tokens: number;
};

/**
 * Next observation chunk after `afterEntryId`. Never ends on a tool result.
 * Always includes at least one source entry so an oversized entry cannot stall the clock.
 */
export function selectSourceSlice(
	entries: Entry[],
	afterEntryId: string | undefined,
	chunkTokens: number,
): SourceSlice {
	const startIndex = afterEntryId ? entryIndexForId(entries, afterEntryId) : -1;
	const slice: Entry[] = [];
	let tokens = 0;
	let coversUpToId: string | undefined;

	for (let i = Math.max(0, startIndex + 1); i < entries.length; i++) {
		const entry = entries[i];
		if (!isSourceEntry(entry)) continue;
		const entryTokens = estimateEntryTokens(entry);
		if (slice.length > 0 && tokens + entryTokens > chunkTokens && isValidCutPoint(entry)) break;
		slice.push(entry);
		tokens += entryTokens;
		coversUpToId = entry.id;
	}

	return { entries: slice, coversUpToId, tokens };
}

export { isSourceEntry, isValidCutPoint };
