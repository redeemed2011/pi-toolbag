import { entryIndexById } from "../progress.js";
import type { Entry, Observation, SessionFold } from "../types.js";

export function mismatchBanner(opts: {
	session: Pick<SessionFold, "claimedId">;
	claimEmpty: boolean;
	claimNotLive: boolean;
	firstKeptId: string;
	branch: Entry[];
	observations: Observation[];
}): string | undefined {
	if (opts.claimEmpty || opts.claimNotLive) return undefined;
	if (!opts.session.claimedId) return undefined;
	const indexes = entryIndexById(opts.branch);
	const cut = indexes.get(opts.firstKeptId);
	if (cut === undefined) return undefined;
	const tailObs = opts.observations.filter((o) => {
		if (!o.about_claim_id) return false;
		const idx = indexes.get(o.coversUpToId);
		return idx !== undefined && idx >= cut;
	});
	if (tailObs.length === 0) return undefined;
	const n = tailObs.filter((o) => o.about_claim_id !== opts.session.claimedId).length;
	const label = n > 0 ? "DIVERGED" : "MATCH";
	return `tail_claim: ${label} ${n}`;
}
