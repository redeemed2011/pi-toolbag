export type Notify = (message: string, level?: "info" | "warning" | "error") => void;

/**
 * `hasUI` and `ui` call pi's assertActive(). Background work (observer, compaction)
 * still runs after print mode or a session switch has disposed the ctx. Read the
 * getters once, before the first await, and never touch ctx again. A throw inside
 * a later catch rejects the floating promise and exits the process.
 */
export function notifyFrom(ctx: { hasUI: boolean; ui?: { notify: Notify } }): Notify | undefined {
	if (!ctx.hasUI || !ctx.ui) return undefined;
	const notify = ctx.ui.notify.bind(ctx.ui);
	return (message, level) => {
		try {
			notify(message, level);
		} catch {
			// The UI object can be gone by the time the background work finishes.
		}
	};
}
