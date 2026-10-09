import assert from "node:assert/strict";
import test from "node:test";
import { editCountParts, summarizeEdit } from "./index.ts";

function row(toolName: string, args: Record<string, unknown>, details?: unknown, isPartial = false) {
	return {
		toolName,
		args,
		result: details === undefined && !isPartial ? undefined : { details },
		isPartial,
		expanded: false,
		render: () => [],
		invalidate: () => {},
	};
}

test("a finished write counts its content lines as added", () => {
	const content = Array.from({ length: 29 }, () => "line").join("\n");
	const summary = summarizeEdit([row("write", { path: "pi-tool-groups/split-paint.test.ts", content }, undefined)]);
	assert.equal(summary.text, "Edited split-paint.test.ts");
	assert.equal(summary.added, 29);
	assert.equal(summary.removed, 0);
	assert.equal(summary.running, false);
});

test("a write in progress does not count lines yet", () => {
	const summary = summarizeEdit([row("write", { path: "split-paint.test.ts", content: "a\nb\n" }, undefined, true)]);
	assert.equal(summary.added, 0);
	assert.equal(summary.running, true);
});

test("hashline metrics still supply the counts", () => {
	const summary = summarizeEdit([
		row("replace", { path: "split-paint.test.ts" }, { metrics: { added_lines: 2, removed_lines: 1 } }),
	]);
	assert.equal(summary.added, 2);
	assert.equal(summary.removed, 1);
});

test("a removal-only count is not glued to the filename", () => {
	assert.deepEqual(editCountParts(0, 22), { added: "", removed: " -22" });
	assert.deepEqual(editCountParts(3, 22), { added: " +3", removed: "/-22" });
	assert.deepEqual(editCountParts(3, 0), { added: " +3", removed: "" });
	assert.deepEqual(editCountParts(0, 0), { added: "", removed: "" });
});
