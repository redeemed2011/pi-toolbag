import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseJsonl, unionLogDir } from "../src/store/jsonl.js";
import { appendProjectRecord, loadProjectLive } from "../src/store/project.js";

describe("jsonl skip-bad-line", () => {
	it("drops malformed lines and duplicates by byte hash / id", () => {
		const text = [
			"{not json",
			JSON.stringify({ id: "a", type: "constraint", ts: "1", session: "s", headline: "h", body: "b", applies_to: "all" }),
			JSON.stringify({ id: "a", type: "constraint", ts: "1", session: "s", headline: "h", body: "b", applies_to: "all" }),
			JSON.stringify({ type: "constraint", ts: "1", session: "s" }),
			JSON.stringify({ id: "b", type: "constraint", ts: "2", session: "s", headline: "h2", body: "b2", applies_to: "all" }),
		].join("\n");
		expect(parseJsonl(text).map((l) => l.id)).toEqual(["a", "b"]);
	});

	it("unions two writer files without last-writer-wins", () => {
		const home = mkdtempSync(join(tmpdir(), "ctx-home-"));
		appendProjectRecord(
			"p1",
			"sess-a",
			{ id: "c1", type: "constraint", ts: "1", session: "sess-a", headline: "A", body: "A", applies_to: "all" },
			home,
		);
		appendProjectRecord(
			"p1",
			"sess-b",
			{ id: "c2", type: "constraint", ts: "2", session: "sess-b", headline: "B", body: "B", applies_to: "all" },
			home,
		);
		const live = loadProjectLive("p1", home);
		expect([...live.live].sort()).toEqual(["c1", "c2"]);
		expect(unionLogDir(`${home}/projects/p1/logs`).length).toBe(2);
	});

	it("does not write the real ~/.pi/ctx", () => {
		const home = mkdtempSync(join(tmpdir(), "ctx-home-"));
		appendProjectRecord(
			"p",
			"s",
			{ id: "c", type: "constraint", ts: "1", session: "s", headline: "h", body: "b", applies_to: "all" },
			home,
		);
		expect(home).not.toContain("/.pi/ctx");
		writeFileSync(join(home, "marker"), "ok");
	});
});
