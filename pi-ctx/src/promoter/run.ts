import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePromoterModel, type SessionModelSource } from "../config.js";
import { foldLive, foldSession, resolveOccupancy } from "../fold.js";
import type { Hitl } from "../hitl.js";
import type { Runtime } from "../runtime.js";
import { buildWorkerArgv, prepareWorkerCwd, spawnWorker } from "../spawn/observer.js";
import { runResultPath } from "../spawn/runs.js";
import { CTX_PROMOTER_LATCH, type Entry, type JudgmentRecord } from "../types.js";
import { applyPromoterResult } from "./apply.js";
import { runPendingReplaceHitl } from "./hitl.js";
import { promoterKickoffPrompt, readPromoterResult, writePromoterKickoff } from "./io.js";
import { extractUserQuotes } from "./quotes.js";
import { PROMOTER_CHARS, PROMOTER_N, emptyPromoterResult, parsePromoterResult } from "./schema.js";

export const PROMOTER_EXTENSION_PATH = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"promoter-worker.ts",
);

export type BindPi = {
	appendEntry: (customType: string, data?: unknown) => void;
	getModel?: () => { provider?: string; id?: string } | undefined;
	getThinkingLevel?: () => string;
};

export type PromoterRunFn = (input: {
	corpus: string[];
	live: { id: string; headline: string; body: string }[];
}) => Promise<unknown>;

export type HarvestReceipt = {
	promoted: string[];
	pending: number;
	skipped: number;
	note?: string;
};

const emptyReceipt = (): HarvestReceipt => ({ promoted: [], pending: 0, skipped: 0 });


export function receiptText(opts: {
	projectName: string;
	promoted: JudgmentRecord[];
	pending: JudgmentRecord[];
	skipped: string[];
}): string {
	const heads = opts.promoted.map((r) => `"${r.headline}"`).join(" ");
	const parts = [`bound to ${opts.projectName}.`];
	if (opts.promoted.length === 0 && opts.pending.length === 0) parts.push("Promoted none.");
	else parts.push(`Promoted ${opts.promoted.length}: ${heads}`.trim());
	if (opts.pending.length) parts.push(`Pending replace: ${opts.pending.length}.`);
	if (opts.skipped.length) parts.push(`Skipped ${opts.skipped.length}.`);
	return parts.join(" ");
}

export async function harvestAfterBind(opts: {
	pi: BindPi;
	runtime: Runtime;
	hitl: Hitl;
	branch: Entry[];
	projectName: string;
	promoterRun?: PromoterRunFn;
	sessionModel?: SessionModelSource;
}): Promise<HarvestReceipt> {
	const { runtime, hitl, branch } = opts;
	if (!runtime.bound || !runtime.projectId) return emptyReceipt();
	const fold = foldSession(branch, runtime.sessionId);
	if (fold.promoterLatched) return { ...emptyReceipt(), note: "already harvested this session" };

	const corpus = extractUserQuotes(branch);
	const occupancy = resolveOccupancy({ occupancy: runtime.occupancy }, runtime.config.occupancy);
	const siblingKnob = runtime.config.gatedEdgeSiblingHeadlines;
	const existing = runtime.projectRecords;
	const live = foldLive(existing);

	let raw: unknown = emptyPromoterResult();
	if (corpus.length > 0) {
		const livePayload = live.constraints
			.filter((c) => live.live.has(c.id))
			.map((c) => ({
				id: c.id,
				headline: c.headline,
				body: (c.directive || c.body).slice(0, 2000),
			}));
		try {
			if (opts.promoterRun) {
				raw = await opts.promoterRun({ corpus, live: livePayload });
			} else if (process.env.PI_CTX_NO_WORKERS === "1") {
				raw = emptyPromoterResult();
			} else {
				raw = await spawnPromoter({
					runtime,
					corpus,
					live: livePayload,
					sessionModel:
						opts.sessionModel ?? {
							getModel: () => opts.pi.getModel?.(),
							getThinkingLevel: () => opts.pi.getThinkingLevel?.() ?? "",
						},
				});
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			hitl.notify(`Promoted none (${message})`, "warning");
			return { ...emptyReceipt(), note: message };
		}
	}

	const applied = applyPromoterResult({
		projectId: runtime.projectId,
		sessionId: runtime.sessionId,
		occupancy,
		siblingKnob,
		claimedId: runtime.claimedId,
		existing,
		corpus,
		result: parsePromoterResult(raw),
	});
	runtime.projectRecords = applied.existing;
	runtime.projectLive = foldLive(applied.existing);

	if (applied.pending.length > 0 && hitl.hasUI) {
		const hitlOut = await runPendingReplaceHitl({
			hitl,
			projectId: runtime.projectId,
			sessionId: runtime.sessionId,
			occupancy,
			siblingKnob,
			claimedId: runtime.claimedId,
			existing: runtime.projectRecords,
		});
		runtime.projectRecords = hitlOut.existing;
		runtime.projectLive = foldLive(hitlOut.existing);
	}

	opts.pi.appendEntry(CTX_PROMOTER_LATCH, { latched: true });
	const folded = foldLive(runtime.projectRecords);
	const receipt: HarvestReceipt = {
		promoted: applied.promoted.map((r) => r.headline),
		pending: applied.pending.filter((p) => folded.live.has(p.id)).length,
		skipped: applied.skipped.length,
	};
	hitl.notify(
		receiptText({
			projectName: opts.projectName,
			promoted: applied.promoted,
			pending: folded.pendingReplaces.filter((p) => folded.live.has(p.id)),
			skipped: applied.skipped,
		}),
		"info",
	);
	return receipt;
}

async function spawnPromoter(opts: {
	runtime: Runtime;
	corpus: string[];
	live: { id: string; headline: string; body: string }[];
	sessionModel?: SessionModelSource;
}): Promise<unknown> {
	const runId = `prm-${Date.now()}`;
	const { cwd, sessionDir } = prepareWorkerCwd(opts.runtime.sessionId || "session", runId);
	writePromoterKickoff(cwd, {
		corpus: opts.corpus,
		live: opts.live,
		n: PROMOTER_N,
		chars: PROMOTER_CHARS,
	});
	const kickoff = promoterKickoffPrompt({
		corpus: opts.corpus,
		live: opts.live,
		n: PROMOTER_N,
		chars: PROMOTER_CHARS,
	});
	const argv = buildWorkerArgv({
		model: resolvePromoterModel(opts.runtime.config, opts.sessionModel),
		sessionName: `ctx-promoter-${runId}`,
		kickoffPrompt: kickoff,
		sessionDir,
		workerExtensionPath: PROMOTER_EXTENSION_PATH,
	});
	const env: NodeJS.ProcessEnv = {
		...process.env,
		CTX_WORKER: "promoter",
		CTX_RESULT_PATH: runResultPath(cwd),
		CTX_RUN_ID: runId,
		CTX_PROMOTER_TOKEN: "1",
	};
	const controller = new AbortController();
	opts.runtime.trackWorkerAbort(controller);
	let exit: Awaited<ReturnType<typeof spawnWorker>>;
	try {
		exit = await spawnWorker({ argv, cwd, env, signal: controller.signal });
	} finally {
		opts.runtime.untrackWorkerAbort(controller);
	}
	if (exit.code !== 0) {
		throw new Error(
			`promoter exited with code ${exit.code}${exit.stderr ? `: ${exit.stderr.trim().slice(0, 200)}` : ""}`,
		);
	}
	return readPromoterResult(runResultPath(cwd));
}
