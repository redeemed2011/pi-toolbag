import { entryIndexById, rawTokensFrom } from "./progress.js";
import { isSourceEntry, isValidCutPoint } from "./tokens.js";
import { CTX_OBSERVATIONS_EMPTY_COVER, CTX_OBSERVATIONS_RECORDED, type Entry } from "./types.js";

function chunkBoundaryIndices(branch: Entry[]): number[] {
	const indexes = entryIndexById(branch);
	const set = new Set<number>();
	for (const entry of branch) {
		if (entry.type !== "custom") continue;
		if (entry.customType !== CTX_OBSERVATIONS_RECORDED && entry.customType !== CTX_OBSERVATIONS_EMPTY_COVER) {
			continue;
		}
		const data = entry.data as { coversUpToId?: string } | undefined;
		if (!data?.coversUpToId) continue;
		const idx = indexes.get(data.coversUpToId);
		if (idx !== undefined) set.add(idx);
	}
	return Array.from(set).sort((a, b) => a - b);
}

function firstKeptAfterBoundary(branch: Entry[], boundaryIndex: number): Entry | undefined {
	for (let i = boundaryIndex + 1; i < branch.length; i++) {
		if (!isSourceEntry(branch[i])) continue;
		return isValidCutPoint(branch[i]) ? branch[i] : undefined;
	}
	return undefined;
}

/**
 * Snap Pi's proposed firstKeptEntryId later-or-equal only.
 * An earlier id lengthens the suffix past keepRecentTokens — forbidden.
 * If no qualifying observation boundary exists, keep the proposal.
 */
export function snapCutoff(
	branch: Entry[],
	proposedFirstKeptId: string,
	tailTokens: number,
): { firstKeptId: string; tail: number } {
	const indexes = entryIndexById(branch);
	const proposedIdx = indexes.get(proposedFirstKeptId);
	const proposedTail = proposedIdx === undefined ? 0 : rawTokensFrom(branch, proposedIdx);
	if (proposedIdx === undefined) {
		return { firstKeptId: proposedFirstKeptId, tail: proposedTail };
	}

	let bestId: string | undefined;
	let bestTail: number | undefined;

	for (const boundaryIndex of chunkBoundaryIndices(branch)) {
		const firstKept = firstKeptAfterBoundary(branch, boundaryIndex);
		if (!firstKept) continue;
		const idx = indexes.get(firstKept.id);
		if (idx === undefined) continue;
		if (idx < proposedIdx) continue;
		const tail = rawTokensFrom(branch, idx);
		if (tail > tailTokens) continue;
		if (bestId === undefined || bestTail === undefined) {
			bestId = firstKept.id;
			bestTail = tail;
			continue;
		}
		if (Math.abs(tail - tailTokens) < Math.abs(bestTail - tailTokens)) {
			bestId = firstKept.id;
			bestTail = tail;
		}
	}

	if (bestId === undefined || bestTail === undefined) {
		return { firstKeptId: proposedFirstKeptId, tail: proposedTail };
	}
	return { firstKeptId: bestId, tail: bestTail };
}

export function canSkipObserverWait(
	branch: Entry[],
	snappedFirstKeptId: string,
	snappedTail: number | undefined,
	tailTokens: number,
	observersInFlight: Iterable<{ coversUpToId: string }>,
): boolean {
	if (snappedTail === undefined || snappedTail > tailTokens) return false;
	const indexes = entryIndexById(branch);
	const cutoffIndex = indexes.get(snappedFirstKeptId);
	if (cutoffIndex === undefined) return false;
	for (const { coversUpToId } of observersInFlight) {
		const idx = indexes.get(coversUpToId);
		if (idx === undefined || idx < cutoffIndex) return false;
	}
	return true;
}
