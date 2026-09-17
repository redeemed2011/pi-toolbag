import { foldLive, resolveOccupancy } from "../fold.js";
import type { Hitl } from "../hitl.js";
import { mintGateFlags } from "../mint.js";
import type { Runtime } from "../runtime.js";
import { CTX_OCCUPANCY, isOccupancy, type Occupancy } from "../types.js";

export type OccupancyPi = { appendEntry: (customType: string, data?: unknown) => void };

export type OccupancyOk = {
	ok: true;
	action: "show" | "switched";
	occupancy: Occupancy;
	would_gate_ge: 0 | 1;
	would_gate_cs: 0 | 1;
};

export type OccupancyErr = { ok: false; error: string };

export type OccupancyResult = OccupancyOk | OccupancyErr;

export function occupancyStatusLine(result: OccupancyOk): string {
	return `ctx occupancy: ${result.occupancy} would_gate_ge=${result.would_gate_ge} would_gate_cs=${result.would_gate_cs}`;
}

export async function runOccupancyFlow(opts: {
	pi: OccupancyPi;
	runtime: Runtime;
	hitl: Hitl;
	want?: string;
}): Promise<OccupancyResult> {
	const { pi, runtime, hitl } = opts;
	const live = runtime.projectLive ?? foldLive(runtime.projectRecords);
	const flags = mintGateFlags(live, runtime.claimedId);
	const current = resolveOccupancy({ occupancy: runtime.occupancy }, runtime.config.occupancy);

	const raw = opts.want?.trim().toLowerCase();
	if (!raw) {
		return { ok: true, action: "show", occupancy: current, ...flags };
	}
	if (!isOccupancy(raw)) {
		return { ok: false, error: "ctx occupancy: gated-edge | claim-strip" };
	}

	if (raw === current) {
		return { ok: true, action: "show", occupancy: current, ...flags };
	}

	const targetGate = raw === "claim-strip" ? flags.would_gate_cs : flags.would_gate_ge;
	if (!hitl.hasUI) {
		if (targetGate === 1) {
			return { ok: false, error: `occupancy switch refused: target ${raw} would gate=1` };
		}
		return { ok: false, error: "occupancy switch requires HITL" };
	}

	if (targetGate === 1) {
		const ok = await hitl.confirm(
			"Occupancy would GATE",
			`Switching to ${raw} would render gate=1 (bodies via zoom). Switch anyway?`,
		);
		if (!ok) return { ok: false, error: "cancelled" };
	}

	pi.appendEntry(CTX_OCCUPANCY, { occupancy: raw });
	runtime.occupancy = raw;
	return { ok: true, action: "switched", occupancy: raw, ...flags };
}
