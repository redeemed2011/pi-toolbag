import {
	CTX_OBSERVATIONS_EMPTY_COVER,
	CTX_OBSERVATIONS_RECORDED,
	type Observation,
} from "./types.js";

export type CoverageCommit =
	| { customType: typeof CTX_OBSERVATIONS_RECORDED; data: { observations: Observation[]; coversUpToId: string; about_claim_id?: string } }
	| { customType: typeof CTX_OBSERVATIONS_EMPTY_COVER; data: { coversUpToId: string; about_claim_id?: string } };

/** Worker failure must not produce a coverage commit (watermark stays). Success with zero obs is empty-cover. */
export function coverageCommit(opts: {
	ok: boolean;
	observations: Observation[];
	coversUpToId: string;
	about_claim_id?: string;
}): CoverageCommit | null {
	if (!opts.ok) return null;
	if (opts.observations.length > 0) {
		return {
			customType: CTX_OBSERVATIONS_RECORDED,
			data: {
				observations: opts.observations,
				coversUpToId: opts.coversUpToId,
				about_claim_id: opts.about_claim_id,
			},
		};
	}
	return {
		customType: CTX_OBSERVATIONS_EMPTY_COVER,
		data: { coversUpToId: opts.coversUpToId, about_claim_id: opts.about_claim_id },
	};
}
