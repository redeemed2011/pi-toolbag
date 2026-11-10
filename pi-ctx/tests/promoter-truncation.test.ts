import { beforeEach, describe, expect, it, vi } from "vitest";

type Exit = { code: number | null; signal: NodeJS.Signals | null; stderr: string };

const gate = vi.hoisted(() => ({
	exit: { code: 0, signal: null, stderr: "" } as Exit,
	write: undefined as ((cwd: string) => void) | undefined,
	calls: 0,
}));

vi.mock("../src/spawn/observer.js", async () => {
	const actual = await vi.importActual<typeof import("../src/spawn/observer.js")>("../src/spawn/observer.js");
	return {
		...actual,
		spawnWorker: async (opts: { cwd: string }) => {
			gate.calls += 1;
			gate.write?.(opts.cwd);
			return gate.exit;
		},
	};
});

import { writePromoterResult } from "../src/promoter/io.js";
import { workerRetryWaits } from "../src/spawn/observer.js";
import { harvestAfterBind } from "../src/promoter/run.js";
import { emptyPromoterResult } from "../src/promoter/schema.js";
import { Runtime } from "../src/runtime.js";
import { runResultPath } from "../src/spawn/runs.js";
import { userMsg } from "./fixtures.js";

const truncated = "Response was truncated: the model reached its output token limit.";

function harvest() {
	const runtime = new Runtime();
	runtime.bound = true;
	runtime.projectId = "p-trunc";
	runtime.sessionId = "sess";
	const notes: string[] = [];
	const pending = harvestAfterBind({
		pi: { appendEntry() {} },
		runtime,
		hitl: {
			hasUI: false,
			select: async () => undefined,
			confirm: async () => false,
			input: async () => undefined,
			notify(message: string) {
				notes.push(message);
			},
		},
		branch: [userMsg("u1", "Keep the tail.")],
		projectName: "p-trunc",
	});
	return { pending, notes };
}

const realWaits = [...workerRetryWaits.ms];

describe("promoter truncated print", () => {
	beforeEach(() => {
		gate.exit = { code: 0, signal: null, stderr: "" };
		gate.write = undefined;
		gate.calls = 0;
		workerRetryWaits.ms = [...realWaits];
		delete process.env.PI_CTX_NO_WORKERS;
	});

	it("returns a submitted harvest when print mode exits 1 on a length stop", async () => {
		gate.exit = { code: 1, signal: null, stderr: truncated };
		gate.write = (cwd) => {
			writePromoterResult(runResultPath(cwd), emptyPromoterResult(), true);
		};
		const { pending, notes } = harvest();
		const receipt = await pending;
		expect(receipt.note).toBeUndefined();
		expect(notes.some((note) => note.includes("exited"))).toBe(false);
	});

	it("throws when a length stop has only the startup write", async () => {
		gate.exit = { code: 1, signal: null, stderr: truncated };
		gate.write = (cwd) => {
			writePromoterResult(runResultPath(cwd), emptyPromoterResult());
		};
		const { pending } = harvest();
		const receipt = await pending;
		expect(receipt.note).toMatch(/exited with code 1/);
	});

	it("retries a capacity exit three times before the failure note", async () => {
		workerRetryWaits.ms = [0, 0];
		gate.exit = {
			code: 1,
			signal: null,
			stderr: "The model is currently at capacity due to high demand.",
		};
		const { pending } = harvest();
		const receipt = await pending;
		expect(gate.calls).toBe(3);
		expect(receipt.note).toMatch(/at capacity/);
	});

	it("throws when a submitted harvest is killed by a signal", async () => {
		gate.exit = { code: null, signal: "SIGTERM", stderr: truncated };
		gate.write = (cwd) => {
			writePromoterResult(runResultPath(cwd), emptyPromoterResult(), true);
		};
		const { pending } = harvest();
		const receipt = await pending;
		expect(receipt.note).toMatch(/exited with code/);
	});
});
