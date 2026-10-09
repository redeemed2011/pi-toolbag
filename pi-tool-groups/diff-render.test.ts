import assert from "node:assert/strict";
import test from "node:test";
import { renderHashlineResult } from "./diff-render.ts";

const result = {
	details: {
		diff: "-miCC│bravo\n+btfd│bravo-updated",
		diffLineNumbers: [2, 2],
	},
};

test("a recognized diff uses the split painter and does not change the result", () => {
	const seen: string[] = [];
	const lines = renderHashlineResult(result, 80, undefined, {
		split: (gutter) => {
			seen.push(gutter);
			return ["split"];
		},
		unified: () => {
			throw new Error("unified should not run");
		},
	}, () => {
		throw new Error("original should not run");
	});
	assert.deepEqual(lines, ["split"]);
	assert.deepEqual(seen, ["-2 bravo\n+2 bravo-updated"]);
	assert.equal(result.details.diff, "-miCC│bravo\n+btfd│bravo-updated");
});

test("an unrecognized diff keeps the original render", () => {
	const changed = { details: { diff: "+2 bravo", diffLineNumbers: [2] } };
	const lines = renderHashlineResult(changed, 80, undefined, {
		split: () => ["split"],
		unified: () => ["unified"],
	}, () => ["original"]);
	assert.deepEqual(lines, ["original"]);
	assert.equal(changed.details.diff, "+2 bravo");
});

test("a throwing split painter falls back to the unified painter", () => {
	const lines = renderHashlineResult(result, 80, undefined, {
		split: () => {
			throw new Error("droid changed");
		},
		unified: (gutter) => [`unified:${gutter}`],
	}, () => ["original"]);
	assert.deepEqual(lines, ["unified:-2 bravo\n+2 bravo-updated"]);
});

test("when both painters fail, the original render is used", () => {
	const lines = renderHashlineResult(result, 80, { fg: () => { throw new Error("theme"); } }, {
		split: () => null,
		unified: () => {
			throw new Error("renderDiff missing");
		},
	}, () => ["original"]);
	assert.deepEqual(lines, ["original"]);
});

test("a throwing original render still returns the gutter text", () => {
	const lines = renderHashlineResult(result, 80, undefined, {
		split: null,
		unified: () => null,
	}, () => {
		throw new Error("hashline renderer crashed");
	});
	assert.deepEqual(lines, ["-2 bravo\n+2 bravo-updated"]);
});
