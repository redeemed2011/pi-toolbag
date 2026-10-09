import assert from "node:assert/strict";
import test from "node:test";
import { hashlineDiffToGutter } from "./diff-display.ts";

test("anchored replace rows become gutter lines with their line numbers", () => {
	const diff = " abcd│alpha\n-miCC│bravo\n+btfd│bravo-updated";
	const lineNumbers = [1, 2, 2];
	const display = hashlineDiffToGutter(diff, lineNumbers);
	assert.deepEqual(display, { gutter: " 1 alpha\n-2 bravo\n+2 bravo-updated" });
	assert.equal(diff, " abcd│alpha\n-miCC│bravo\n+btfd│bravo-updated");
	assert.deepEqual(lineNumbers, [1, 2, 2]);
});

test("a blanked dead anchor is still a hashline row", () => {
	const display = hashlineDiffToGutter("-    │bravo", [2]);
	assert.equal(display?.gutter, "-2 bravo");
});

test("batch header, ellipsis, and truncation stay outside the gutter text", () => {
	const display = hashlineDiffToGutter(
		"batch 1:\n abcd│alpha\n ...\n+btfd│bravo-updated\n[diff truncated at 1 KB; use read to see the rest.]",
		[null, 1, null, 2, null],
	);
	assert.deepEqual(display, {
		header: "batch 1:",
		gutter: " 1 alpha\n ...\n+2 bravo-updated",
		notice: "[diff truncated at 1 KB; use read to see the rest.]",
	});
});

test("a changed hashline shape is left alone", () => {
	assert.equal(hashlineDiffToGutter("+2 bravo-updated", [2]), null);
	assert.equal(hashlineDiffToGutter("+btfd|bravo-updated", [2]), null);
	assert.equal(hashlineDiffToGutter("+btf│bravo", [2]), null);
	assert.equal(hashlineDiffToGutter("-   │bravo", [2]), null);
	assert.equal(hashlineDiffToGutter("+btfd│bravo\nnot a row", [2, null]), null);
	assert.equal(hashlineDiffToGutter("+btfd│bravo", [2, 3]), null);
	assert.equal(hashlineDiffToGutter("+btfd│bravo", null), null);
	assert.equal(hashlineDiffToGutter(" ...", [null]), null);
	assert.equal(hashlineDiffToGutter("batch 1:\n+btfd│bravo", [2, 2]), null);
});
