import { foldLive, resolveOccupancy } from "../fold.js";
import type { Entry, JudgmentRecord, Occupancy, PackedInject, SessionFold } from "../types.js";
import { renderClaimStrip } from "./claim-strip.js";
import { renderGatedEdge } from "./gated-edge.js";
import { recallErrorInject, renderUnbound } from "./unbound.js";

export type RenderConfig = {
	occupancy: Occupancy;
	gatedEdgeSiblingHeadlines: 0 | 2;
};

export function renderInject(opts: {
	session: SessionFold;
	branch: Entry[];
	firstKeptId: string;
	config: RenderConfig;
	projectRecords?: JudgmentRecord[];
	includeAuthor?: boolean;
}): PackedInject {
	try {
		if (!opts.session.bound) {
			return renderUnbound(opts.session.recency, opts.firstKeptId, opts.branch);
		}
		const live = foldLive(opts.projectRecords ?? []);
		const occupancy = resolveOccupancy(opts.session, opts.config.occupancy);
		if (occupancy === "claim-strip") {
			return renderClaimStrip({
				live,
				session: opts.session,
				firstKeptId: opts.firstKeptId,
				branch: opts.branch,
				observations: opts.session.observations,
				includeAuthor: opts.includeAuthor,
			});
		}
		return renderGatedEdge({
			live,
			session: opts.session,
			firstKeptId: opts.firstKeptId,
			branch: opts.branch,
			siblingKnob: opts.config.gatedEdgeSiblingHeadlines,
			observations: opts.session.observations,
			includeAuthor: opts.includeAuthor,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return recallErrorInject(opts.session.claimedId, message);
	}
}

export function renderConstitutionOnly(opts: {
	session: SessionFold;
	branch: Entry[];
	firstKeptId: string;
	config: RenderConfig;
	projectRecords?: JudgmentRecord[];
	includeAuthor?: boolean;
}): PackedInject {
	const packed = renderInject(opts);
	if (!opts.session.bound) return packed;
	const live = foldLive(opts.projectRecords ?? []);
	const occupancy = resolveOccupancy(opts.session, opts.config.occupancy);
	if (occupancy === "claim-strip") {
		return renderClaimStrip({
			live,
			session: opts.session,
			firstKeptId: opts.firstKeptId,
			branch: opts.branch,
			observations: [],
			includeAuthor: opts.includeAuthor,
		});
	}
	return renderGatedEdge({
		live,
		session: opts.session,
		firstKeptId: opts.firstKeptId,
		branch: opts.branch,
		siblingKnob: opts.config.gatedEdgeSiblingHeadlines,
		observations: [],
		includeAuthor: opts.includeAuthor,
	});
}
