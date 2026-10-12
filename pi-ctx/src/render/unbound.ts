import type { Entry, Observation, PackedInject } from "../types.js";
import { INJECT_CAP, injectTokens } from "./estimate.js";

const HEADER = `# ctx
bound: 0
occupancy: none
no project bound`;

function coveredInsideTail(coverId: string, firstKeptId: string, branch: Entry[]): boolean {
	const cut = branch.findIndex((entry) => entry.id === firstKeptId);
	if (cut < 0) return coverId === firstKeptId;
	const cover = branch.findIndex((entry) => entry.id === coverId);
	if (cover < 0) return false;
	return cover > cut;
}

export function renderUnbound(recency: Observation[], firstKeptId?: string, branch: Entry[] = []): PackedInject {
	const lines: string[] = [HEADER, "## Recency"];
	for (const obs of recency) {
		if (firstKeptId && coveredInsideTail(obs.coversUpToId, firstKeptId, branch)) continue;
		const line = `- ${obs.headline} (${obs.id})`;
		const trial = `${lines.join("\n")}\n${line}`;
		if (injectTokens(trial) > INJECT_CAP) break;
		lines.push(line);
	}
	if (lines[lines.length - 1] === "## Recency") lines.push("- (none)");
	return { text: lines.join("\n"), gate: 0, claim_truncated: 0 };
}

export function recallErrorInject(claimId: string | null, message: string): PackedInject {
	const text = [
		"# ctx",
		"recall_error=1",
		"no constraint bodies this cycle",
		claimId ? `claim: ${claimId}` : "claim: (none)",
		`error: ${message}`.slice(0, 400),
	].join("\n");
	return { text, gate: 1, claim_truncated: 0 };
}
