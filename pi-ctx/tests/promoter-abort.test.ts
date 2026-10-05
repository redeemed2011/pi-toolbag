import { beforeEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({
	signals: [] as AbortSignal[],
}));

vi.mock("../src/spawn/observer.js", async () => {
	const actual = await vi.importActual<typeof import("../src/spawn/observer.js")>("../src/spawn/observer.js");
	return {
		...actual,
		spawnWorker: (opts: { signal?: AbortSignal }) =>
			new Promise((resolve) => {
				const finish = () => resolve({ code: null, signal: "SIGTERM" as const, stderr: "" });
				if (!opts.signal || opts.signal.aborted) {
					finish();
					return;
				}
				gate.signals.push(opts.signal);
				opts.signal.addEventListener("abort", finish, { once: true });
			}),
	};
});

import { harvestAfterBind } from "../src/promoter/run.js";
import { Runtime } from "../src/runtime.js";
import { userMsg } from "./fixtures.js";

describe("promoter abort", () => {
	beforeEach(() => {
		gate.signals.length = 0;
		delete process.env.PI_CTX_NO_WORKERS;
	});

	it("abortAllWorkers stops an in-flight promoter", async () => {
		const runtime = new Runtime();
		runtime.bound = true;
		runtime.projectId = "p-abort";
		runtime.sessionId = "sess";
		const pending = harvestAfterBind({
			pi: { appendEntry() {} },
			runtime,
			hitl: {
				hasUI: false,
				select: async () => undefined,
				confirm: async () => false,
				input: async () => undefined,
				notify() {},
			},
			branch: [userMsg("u1", "Keep the tail.")],
			projectName: "p-abort",
		});
		await vi.waitFor(() => expect(gate.signals).toHaveLength(1));
		runtime.abortAllWorkers();
		const receipt = await pending;
		expect(gate.signals[0]?.aborted).toBe(true);
		expect(receipt.note).toMatch(/exited/);
		expect(runtime.workerAborts.size).toBe(0);
	});
});
