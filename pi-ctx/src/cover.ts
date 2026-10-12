import { entryIndexForId, latestCoverageMarkerId, selectSourceSlice, type SourceSlice } from "./progress.js";
import { isSourceEntry } from "./tokens.js";
import type { Entry } from "./types.js";

/** First source entry after the coverage watermark and strictly before the cut. */
export function firstUncoveredSourceId(branch: Entry[], firstKeptId: string): string | undefined {
	const cut = entryIndexForId(branch, firstKeptId);
	if (cut < 0) return undefined;
	const covered = entryIndexForId(branch, latestCoverageMarkerId(branch));
	for (let i = covered + 1; i < cut; i++) {
		if (isSourceEntry(branch[i])) return branch[i].id;
	}
	return undefined;
}

export type CoverageStep =
	| { action: "done" }
	| { action: "wait" }
	| { action: "dispatch"; slice: SourceSlice }
	| { action: "retain"; firstKeptId: string };

/**
 * Compaction must not drop source that has no observation cover.
 * An in-flight observer on an earlier chunk does not cover a later gap:
 * wait for a free slot, then dispatch that gap, or retain it.
 */
export function planCoverageStep(
	branch: Entry[],
	firstKeptId: string,
	chunkTokens: number,
	inFlightCovers: readonly string[],
): CoverageStep {
	const uncovered = firstUncoveredSourceId(branch, firstKeptId);
	if (!uncovered) return { action: "done" };
	if (inFlightCovers.length > 0) return { action: "wait" };

	const slice = selectSourceSlice(branch, latestCoverageMarkerId(branch), Math.max(1, chunkTokens));
	const start = slice.entries.length > 0 ? entryIndexForId(branch, slice.entries[0].id) : -1;
	const cut = entryIndexForId(branch, firstKeptId);
	if (!slice.coversUpToId || start < 0 || cut < 0 || start >= cut) {
		return { action: "retain", firstKeptId: uncovered };
	}
	return { action: "dispatch", slice };
}
