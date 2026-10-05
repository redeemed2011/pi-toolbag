import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { spawnWorker } from "../src/spawn/observer.js";

describe("spawnWorker abort", () => {
	it("stops a worker that exits on SIGTERM", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-term-"));
		const ac = new AbortController();
		const pending = spawnWorker({
			argv: [process.execPath, "-e", "setInterval(() => {}, 1000);"],
			cwd,
			env: process.env,
			signal: ac.signal,
		});
		ac.abort();
		const exit = await pending;
		expect(exit.signal).toBe("SIGTERM");
	});

	it("SIGKILLs a worker that ignores SIGTERM", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-kill-"));
		const ready = join(cwd, "ready");
		const ac = new AbortController();
		const pending = spawnWorker({
			argv: [
				process.execPath,
				"-e",
				"process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(process.env.READY, '1'); setInterval(() => {}, 1000);",
			],
			cwd,
			env: { ...process.env, READY: ready },
			signal: ac.signal,
		});
		const start = Date.now();
		while (!existsSync(ready)) {
			if (Date.now() - start > 2000) throw new Error("worker never became ready");
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		ac.abort();
		const exit = await pending;
		expect(exit.signal).toBe("SIGKILL");
	}, 8_000);
});
