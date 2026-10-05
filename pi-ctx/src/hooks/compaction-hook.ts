import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { foldSession } from "../fold.js";
import { INJECT_CAP, injectTokens } from "../render/estimate.js";
import { renderInject } from "../render/inject.js";
import { recallErrorInject } from "../render/unbound.js";
import type { Runtime } from "../runtime.js";
import { canSkipObserverWait, snapCutoff } from "../snap.js";
import { CTX_FOLDED, type Entry } from "../types.js";

export function registerCompactionHook(pi: ExtensionAPI, runtime: Runtime): void {
	pi.on("session_before_compact", async (event: any, ctx: any) => {
		if (!runtime.enabled || runtime.config.passive) return undefined;

		if (runtime.compactHookInFlight) {
			if (ctx.hasUI) ctx.ui.notify("ctx: another compaction is already in progress; cancelling duplicate", "warning");
			return { cancel: true };
		}

		runtime.compactHookInFlight = true;
		try {
			runtime.ensureConfig(ctx.cwd);
			const tailTokens = runtime.config.tailTokens;
			const { firstKeptEntryId, tokensBefore } = event.preparation;

			let branch = (ctx.sessionManager?.getBranch?.() as Entry[] | undefined) ?? (event.branchEntries as Entry[]);
			let snap = snapCutoff(branch, firstKeptEntryId, tailTokens);

			const skip = canSkipObserverWait(
				branch,
				snap.firstKeptId,
				snap.tail,
				tailTokens,
				runtime.observersInFlight.values(),
			);
			runtime.lastCompactionObserverWait = skip ? "skipped" : "waited";
			if (!skip) {
				if (ctx.hasUI) ctx.ui.notify("ctx: waiting for in-flight observers before folding…", "info");
				await runtime.whenObserversIdle();
				try {
					const fresh = ctx.sessionManager?.getBranch?.() as Entry[] | undefined;
					branch = fresh ?? (event.branchEntries as Entry[]) ?? branch;
				} catch {
					// Stale after the wait. Keep the branch already read; do not fall through to recall_error.
				}
				snap = snapCutoff(branch, firstKeptEntryId, tailTokens);
			}

			const session = foldSession(branch, runtime.sessionId);
			runtime.bound = session.bound;
			runtime.claimedId = session.claimedId;
			runtime.occupancy = session.occupancy;
			runtime.projectId = session.projectId;
			runtime.reloadProject();

			const packed = renderInject({
				session,
				branch,
				firstKeptId: snap.firstKeptId,
				config: runtime.config,
				projectRecords: runtime.projectRecords,
			});

			let summary = packed.text;
			if (injectTokens(summary) > INJECT_CAP) {
				summary = summary.slice(0, INJECT_CAP * 4);
			}

			return {
				compaction: {
					summary,
					firstKeptEntryId: snap.firstKeptId,
					tokensBefore,
					details: {
						type: CTX_FOLDED,
						version: 1,
						gate: packed.gate,
						claim_truncated: packed.claim_truncated,
						occupancy: session.occupancy ?? runtime.config.occupancy,
						bound: session.bound ? 1 : 0,
						claim: session.claimedId,
					},
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			try {
				if (ctx.hasUI) ctx.ui.notify(`ctx: compact renderer failed: ${message}`, "error");
			} catch {
				// notify must not prevent the recall_error return
			}
			const fallback = recallErrorInject(runtime.claimedId, message);
			const preparation = event?.preparation ?? {};
			return {
				compaction: {
					summary: fallback.text,
					firstKeptEntryId: preparation.firstKeptEntryId,
					tokensBefore: preparation.tokensBefore,
					details: { type: CTX_FOLDED, version: 1, gate: 1, recall_error: 1 },
				},
			};
		} finally {
			runtime.compactHookInFlight = false;
		}
	});
}
