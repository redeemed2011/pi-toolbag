import { type Config, DEFAULTS, loadConfig } from "./config.js";
import { foldLive, foldSession } from "./fold.js";
import { loadProjectRecords } from "./store/project.js";
import type { Entry, JudgmentRecord, LiveSet, Occupancy, SessionFold } from "./types.js";

export type InFlightObserver = {
	controller: AbortController;
	coversUpToId: string;
	aboutClaimId?: string;
};

export class Runtime {
	config: Config = { ...DEFAULTS, models: { ...DEFAULTS.models } };
	enabled = true;
	sessionId = "";
	bound = false;
	projectId: string | null = null;
	claimedId: string | null = null;
	occupancy: Occupancy | null = null;
	projectLive: LiveSet | null = null;
	projectRecords: JudgmentRecord[] = [];

	readonly observersInFlight = new Map<string, InFlightObserver>();
	readonly observerTasks = new Set<Promise<void>>();
	dispatchedCoversUpToId: string | undefined;
	compactInFlight = false;
	compactHookInFlight = false;
	lastWorkerError: string | undefined;
	lastCompactionObserverWait: "skipped" | "waited" | undefined;

	ensureConfig(cwd: string): void {
		this.config = loadConfig(cwd);
	}

	restoreFromBranch(branch: Entry[], sessionId: string): SessionFold {
		this.sessionId = sessionId;
		const fold = foldSession(branch, sessionId);
		this.enabled = fold.enabled;
		this.bound = fold.bound;
		this.projectId = fold.projectId;
		this.claimedId = fold.claimedId;
		this.occupancy = fold.occupancy;
		this.reloadProject();
		return fold;
	}

	reloadProject(): void {
		if (!this.bound || !this.projectId) {
			this.projectLive = null;
			this.projectRecords = [];
			return;
		}
		try {
			this.projectRecords = loadProjectRecords(this.projectId);
			this.projectLive = foldLive(this.projectRecords);
		} catch {
			this.projectRecords = [];
			this.projectLive = null;
		}
	}

	get observerSlotsAvailable(): number {
		return Math.max(0, this.config.observerConcurrency - this.observersInFlight.size);
	}

	trackObserverTask(task: Promise<void>): void {
		this.observerTasks.add(task);
		// `void task.finally(...)` still rejects. A stale ctx throw must not be unhandled.
		void task.finally(() => this.observerTasks.delete(task)).catch(() => {});
	}

	async whenObserversIdle(): Promise<void> {
		await Promise.allSettled([...this.observerTasks]);
	}

	readonly workerAborts = new Set<AbortController>();

	trackWorkerAbort(controller: AbortController): void {
		this.workerAborts.add(controller);
	}

	untrackWorkerAbort(controller: AbortController): void {
		this.workerAborts.delete(controller);
	}

	abortAllWorkers(): void {
		for (const { controller } of this.observersInFlight.values()) controller.abort();
		this.observersInFlight.clear();
		for (const controller of this.workerAborts) controller.abort();
		this.workerAborts.clear();
	}

	queueToast(
		line: string,
		level: "info" | "warning" | "error",
		notify: (message: string, level: "info" | "warning" | "error") => void,
	): void {
		notify(line, level);
	}
}
