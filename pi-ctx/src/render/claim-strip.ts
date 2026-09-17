import { bodySetCS } from "../fold.js";
import type { Entry, JudgmentRecord, LiveSet, Observation, PackedInject, SessionFold } from "../types.js";
import { mismatchBanner } from "./banner.js";
import { gateCheck } from "./occupancy.js";
import { packInject, renderOverflow } from "./pack.js";
import { claimedBodyOrEmpty, countsLine, destinationMd } from "./gated-edge.js";

function appliedBodiesMd(bodies: JudgmentRecord[]): string {
	if (bodies.length === 0) return "";
	const parts = ["## Applied constraints"];
	for (const c of bodies) {
		parts.push(`### ${c.headline} (${c.id})\n${c.directive || c.body}`);
	}
	return parts.join("\n\n");
}

export function renderClaimStrip(opts: {
	live: LiveSet;
	session: SessionFold;
	firstKeptId: string;
	branch: Entry[];
	observations: Observation[];
}): PackedInject {
	const claimed = claimedBodyOrEmpty(opts.live, opts.session.claimedId);
	const dest = destinationMd(opts.live);
	const applied = bodySetCS(opts.live, opts.session.claimedId);
	const g = gateCheck(applied);
	const headers = `# ctx\nbound: 1\noccupancy: claim-strip`;
	const unapplied = Math.max(0, opts.live.constraints.length - applied.length);
	const counts = countsLine(opts.live, g, claimed, unapplied);
	const banner = mismatchBanner({
		session: opts.session,
		claimEmpty: claimed.claim_empty === 1,
		claimNotLive: claimed.claim_not_live === 1,
		firstKeptId: opts.firstKeptId,
		branch: opts.branch,
		observations: opts.observations,
	});

	if (g.gate === 1) {
		return renderOverflow({ headers, dest, claimed: claimed.md, counts, banner });
	}

	const fill: string[] = [];
	if (opts.session.claimedId) {
		const recency = opts.observations
			.filter((o) => o.about_claim_id === opts.session.claimedId)
			.reverse()
			.map((o) => `- ${o.headline} (${o.id})`);
		if (recency.length) fill.push(`## Recency\n${recency.join("\n")}`);
	}

	return packInject({
		headers,
		dest,
		bodiesMd: appliedBodiesMd(applied),
		claimedMd: claimed.md,
		counts,
		banner,
		fill,
	});
}
