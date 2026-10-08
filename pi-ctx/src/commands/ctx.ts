import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { bodySetCS, bodySetGE, resolveOccupancy } from "../fold.js";
import { hitlFromCtx } from "../hitl.js";
import { notifyFrom } from "../notify.js";
import { mintGateFlags } from "../mint.js";
import { gateCheck } from "../render/occupancy.js";
import type { Runtime } from "../runtime.js";
import { CTX_ENABLED, type Entry } from "../types.js";
import { publishRuntimeBoundStatus, statusSink } from "../render/bound-status.js";
import { runBindFlow, runUnbind } from "./bind.js";
import { runClaimFlow } from "./claim.js";
import { occupancyStatusLine, runOccupancyFlow } from "./occupancy.js";

export function registerCtxCommand(pi: ExtensionAPI, runtime: Runtime): void {
	pi.registerCommand("ctx", {
		description:
			"ctx memory: on | off | status | compact | occupancy [gated-edge|claim-strip] | bind | unbind | claim",
		handler: async (args: string, ctx: any) => {
			const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
			const cmd = (parts[0] || "status").toLowerCase();
			const hitl = hitlFromCtx(ctx);
			const setStatus = statusSink(ctx);
			const branch = (ctx.sessionManager?.getBranch?.() as Entry[]) ?? [];
			if (ctx.sessionManager?.getSessionId) {
				runtime.restoreFromBranch(branch, ctx.sessionManager.getSessionId());
				publishRuntimeBoundStatus(setStatus, runtime);
			}

			if (cmd === "on" || cmd === "off") {
				const next = cmd === "on";
				runtime.enabled = next;
				pi.appendEntry(CTX_ENABLED, { enabled: next });
				if (ctx.hasUI) ctx.ui.notify(`ctx ${next ? "enabled" : "disabled"}`, "info");
				return;
			}

			if (cmd === "compact") {
				if (!runtime.enabled) {
					if (ctx.hasUI) ctx.ui.notify("ctx is off", "warning");
					return;
				}
				const notify = notifyFrom(ctx);
				ctx.compact({
					onComplete: () => {
						notify?.("ctx: compaction complete", "info");
					},
					onError: (error: { message: string }) => {
						notify?.(`ctx: ${error.message}`, "error");
					},
				});
				return;
			}

			if (cmd === "occupancy") {
				const result = await runOccupancyFlow({
					pi,
					runtime,
					hitl,
					want: parts[1],
				});
				if (!result.ok) ctx.ui.notify(result.error, "warning");
				else ctx.ui.notify(occupancyStatusLine(result), "info");
				return;
			}

			if (cmd === "bind") {
				const suggested = parts.slice(1).join(" ") || undefined;
				const result = await runBindFlow({
					pi,
					runtime,
					hitl,
					cwd: ctx.cwd ?? "",
					branch,
					suggestedName: suggested,
					status: setStatus,
				});
				if (!result.ok && ctx.hasUI) ctx.ui.notify(result.error, "warning");
				return;
			}

			if (cmd === "unbind") {
				const result = runUnbind({ pi, runtime, hitl, status: setStatus });
				if (!result.ok && ctx.hasUI) ctx.ui.notify(result.error, "warning");
				return;
			}

			if (cmd === "claim") {
				const sub = (parts[1] || "status").toLowerCase();
				const action = sub === "close" ? "close" : sub === "status" ? "status" : "claim";
				const question_id = action === "claim" && sub !== "claim" ? parts[1] : parts[2];
				const result = await runClaimFlow({
					pi,
					runtime,
					hitl,
					action,
					question_id,
				});
				if (ctx.hasUI) {
					if (!result.ok) ctx.ui.notify(result.error, "warning");
					else ctx.ui.notify(`claim=${result.claimed_id ?? "(empty)"}`, "info");
				}
				return;
			}

			const occupancy = resolveOccupancy({ occupancy: runtime.occupancy }, runtime.config.occupancy);
			const live = runtime.projectLive;
			const flags = live
				? mintGateFlags(live, runtime.claimedId)
				: { would_gate_ge: 0 as const, would_gate_cs: 0 as const };
			const bodies = live
				? occupancy === "claim-strip"
					? bodySetCS(live, runtime.claimedId)
					: bodySetGE(live)
				: [];
			const g = gateCheck(bodies);
			const line = [
				`enabled=${runtime.enabled}`,
				`bound=${runtime.bound ? runtime.projectId : "no"}`,
				`occupancy=${occupancy}`,
				`claim=${runtime.claimedId ?? "(empty)"}`,
				`constraints=${g.n}`,
				`gate=${g.gate}`,
				`would_gate_ge=${flags.would_gate_ge}`,
				`would_gate_cs=${flags.would_gate_cs}`,
				`observers=${runtime.observersInFlight.size}`,
				runtime.lastWorkerError ? `last_error=${runtime.lastWorkerError}` : "",
			]
				.filter(Boolean)
				.join(" ");
			if (ctx.hasUI) ctx.ui.notify(line, "info");
		},
	});
}
