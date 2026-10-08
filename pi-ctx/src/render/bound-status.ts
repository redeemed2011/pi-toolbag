import { readProjectMeta } from "../store/project.js";

/** Footer slot. Pi sorts extension statuses by this key and drops the line when it is cleared. */
export const BOUND_STATUS_KEY = "ctx";

export type StatusSink = (key: string, text: string | undefined) => void;

/**
 * Short label for the interactive footer. Not the hidden model status line.
 * Unbound clears the slot. A blank display name falls back to the project id.
 */
export function boundStatusText(opts: {
	bound: boolean;
	projectId: string | null;
	projectName?: string | null;
}): string | undefined {
	if (!opts.bound || !opts.projectId) return undefined;
	const name = opts.projectName?.trim() || opts.projectId;
	return `ctx: ${name}`;
}

/** `undefined` text clears the slot. A missing sink is print mode or a disposed ctx. */
export function publishBoundStatus(
	setStatus: StatusSink | undefined,
	opts: { bound: boolean; projectId: string | null; projectName?: string | null },
): void {
	if (!setStatus) return;
	try {
		setStatus(BOUND_STATUS_KEY, boundStatusText(opts));
	} catch {
		// The UI can be gone after a session switch during bind.
	}
}

/**
 * Read `hasUI` and `ui` once. Both getters throw after the session ctx is disposed.
 * Do not touch `ui` when there is no UI.
 */
export function statusSink(ctx: { hasUI?: boolean; ui?: { setStatus?: StatusSink } }): StatusSink | undefined {
	try {
		if (!ctx.hasUI || !ctx.ui?.setStatus) return undefined;
		return ctx.ui.setStatus.bind(ctx.ui);
	} catch {
		return undefined;
	}
}

/** Footer text for the runtime's current binding. The display name comes from project.json. */
export function publishRuntimeBoundStatus(
	setStatus: StatusSink | undefined,
	runtime: { bound: boolean; projectId: string | null },
	readName: (id: string) => string | undefined = (id) => readProjectMeta(id)?.name,
): void {
	if (!setStatus) return;
	if (!runtime.bound || !runtime.projectId) {
		publishBoundStatus(setStatus, { bound: false, projectId: null });
		return;
	}
	let projectName: string | undefined;
	try {
		projectName = readName(runtime.projectId);
	} catch {
		projectName = undefined;
	}
	publishBoundStatus(setStatus, {
		bound: true,
		projectId: runtime.projectId,
		projectName,
	});
}
