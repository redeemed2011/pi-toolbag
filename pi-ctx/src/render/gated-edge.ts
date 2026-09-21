import { bodySetGE } from "../fold.js";
import type { JudgmentRecord, LiveSet, Observation, PackedInject, SessionFold } from "../types.js";
import { pendingReplaceSection } from "../promoter/inject.js";
import { mismatchBanner } from "./banner.js";
import { GATE_BODY_COUNT, injectTokens } from "./estimate.js";
import { gateCheck } from "./occupancy.js";
import { packInject, renderOverflow } from "./pack.js";
import type { Entry } from "../types.js";

function constraintBodiesMd(bodies: JudgmentRecord[]): string {
	if (bodies.length === 0) return "";
	const parts = ["## Constraints"];
	for (const c of bodies) {
		parts.push(`### ${c.headline} (${c.id})\n${c.directive || c.body}`);
	}
	return parts.join("\n\n");
}

export function claimedBodyOrEmpty(
	live: LiveSet,
	claimedId: string | null,
): { md: string; claim_empty: 0 | 1; claim_not_live: 0 | 1; blocked: 0 | 1 } {
	if (!claimedId) return { md: "", claim_empty: 1, claim_not_live: 0, blocked: 0 };
	const q = live.byId.get(claimedId);
	if (!q || !live.live.has(claimedId) || q.type !== "question") {
		return { md: `claim ${claimedId} not_live`, claim_empty: 0, claim_not_live: 1, blocked: 0 };
	}
	if (live.blocked.has(claimedId)) {
		return { md: `## Claimed\n${q.directive || q.body || q.headline}`, claim_empty: 0, claim_not_live: 0, blocked: 1 };
	}
	return { md: `## Claimed\n${q.directive || q.body}`, claim_empty: 0, claim_not_live: 0, blocked: 0 };
}

export function renderGatedEdge(opts: {
	live: LiveSet;
	session: SessionFold;
	firstKeptId: string;
	branch: Entry[];
	siblingKnob: 0 | 2;
	observations: Observation[];
}): PackedInject {
	const bodies = bodySetGE(opts.live);
	const claimed = claimedBodyOrEmpty(opts.live, opts.session.claimedId);
	const dest = destinationMd(opts.live);
	const g = gateCheck(bodies);
	const headers = `# ctx\nbound: 1\noccupancy: gated-edge`;
	const counts = countsLine(opts.live, g, claimed);
	const pending = pendingReplaceSection(opts.live);
	const mismatch = mismatchBanner({
		session: opts.session,
		claimEmpty: claimed.claim_empty === 1,
		claimNotLive: claimed.claim_not_live === 1,
		firstKeptId: opts.firstKeptId,
		branch: opts.branch,
		observations: opts.observations,
	});
	const banner = [mismatch, pending].filter(Boolean).join("\n\n") || undefined;

	if (g.gate === 1) {
		return renderOverflow({ headers, dest, claimed: claimed.md, counts, banner });
	}

	const fill: string[] = [];
	if (claimed.claim_empty === 0 && opts.siblingKnob === 2) {
		const siblings = opts.live.questions
			.filter((q) => q.id !== opts.session.claimedId && !opts.live.blocked.has(q.id))
			.slice(0, 2)
			.map((q) => `- ${q.headline} (${q.id})`);
		if (siblings.length) fill.push(`## Siblings\n${siblings.join("\n")}`);
	}
	const recency = recencyLines(opts.observations, opts.firstKeptId, opts.branch);
	if (recency.length) fill.push(`## Recency\n${recency.join("\n")}`);

	return packInject({
		headers,
		dest,
		bodiesMd: constraintBodiesMd(bodies),
		claimedMd: claimed.md,
		counts,
		banner,
		fill,
	});
}

export function destinationMd(live: LiveSet): string {
	const d = live.destinations[0];
	if (!d) return "";
	const body = (d.directive || d.body).split("\n").slice(0, 2).join("\n");
	const oos = live.outOfScope.slice(0, 6).map((o) => `- ${o.headline} (${o.id})`);
	const oosBlock = oos.length ? `\n\n## Out of scope\n${oos.join("\n")}` : "";
	return `## Destination\n${body}${oosBlock}`;
}

export function countsLine(
	live: LiveSet,
	g: { gate: 0 | 1; n: number },
	claimed: { claim_empty: 0 | 1; claim_not_live: 0 | 1; blocked: 0 | 1 },
	unapplied?: number,
): string {
	const frontierElided = Math.max(0, live.questions.length - (claimed.claim_empty ? 0 : 1));
	const parts = [
		`fog:${live.fog.length}`,
		`blocked:${live.blocked.size}`,
		`frontier_elided:${frontierElided}`,
		`oos:${live.outOfScope.length}`,
		`constraints:${g.n}/${GATE_BODY_COUNT}`,
		`gate:${g.gate}`,
		`claim_empty:${claimed.claim_empty}`,
		`claim_not_live:${claimed.claim_not_live}`,
	];
	if (unapplied !== undefined) parts.push(`unapplied:${unapplied}`);
	return `## Counts\n${parts.join(" ")}`;
}

export function recencyLines(observations: Observation[], firstKeptId: string, branch: Entry[]): string[] {
	const idx = new Map(branch.map((e, i) => [e.id, i] as const));
	const cut = idx.get(firstKeptId);
	const lines: string[] = [];
	const newestFirst = [...observations].reverse();
	for (const obs of newestFirst) {
		const coverIdx = idx.get(obs.coversUpToId);
		if (cut !== undefined && coverIdx !== undefined && coverIdx >= cut) continue;
		lines.push(`- ${obs.headline} (${obs.id})`);
	}
	return lines;
}

export { injectTokens };
