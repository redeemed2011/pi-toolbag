import assert from "node:assert/strict";
import test from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { hashlineCardLines, placeRichDiff } from "./index.ts";

initTheme("dark");

const result = {
	content: [{ type: "text", text: "Successfully replaced in demo.txt" }],
	details: {
		diff: "-miCC│bravo\n+btfd│bravo-updated",
		diffLineNumbers: [2, 2],
		warnings: ["Hints stay visible"],
	},
};

test("a finished hashline card drops the anchors", () => {
	const lines = hashlineCardLines({
		toolName: "replace",
		args: { remove_from: "miCC", remove_to: "miCC", text: "bravo-updated" },
		result,
	}, 80, undefined);
	const text = lines.join("\n");
	assert.match(text, /^● Replace Remove from: miCC/);
	assert.match(text, /└─ /);
	assert.match(text, /-2 /);
	assert.match(text, /\+2 /);
	assert.match(text, /bravo-updated/);
	assert.equal(text.includes("│"), false);
	assert.match(text, /Hints stay visible/);
});

test("placeRichDiff replaces the badge body", () => {
	const children: Array<{ render: (width: number) => string[] }> = [];
	const shell = {
		clear() {
			children.length = 0;
		},
		addChild(child: unknown) {
			children.push(child as { render: (width: number) => string[] });
		},
	};
	placeRichDiff({
		toolName: "replace",
		args: { remove_from: "miCC", text: "bravo-updated" },
		result,
		contentBox: shell,
	});
	assert.equal(children.length, 1);
	const text = children[0]!.render(80).join("\n");
	assert.match(text, /-2 /);
	assert.equal(text.includes("│"), false);
});

test("the card header shows elapsed seconds", () => {
	const twelve = hashlineCardLines({
		toolName: "replace",
		args: { remove_from: "miCC" },
		result: { ...result, durationMs: 12 },
	}, 80, undefined);
	assert.match(twelve[0]!, /◷ 0\.01s$/);
	const slow = hashlineCardLines({
		toolName: "replace",
		args: { remove_from: "miCC" },
		result: { ...result, durationMs: 1200 },
	}, 80, undefined);
	assert.match(slow[0]!, /◷ 1\.20s$/);
	const missing = hashlineCardLines({
		toolName: "replace",
		args: { remove_from: "miCC" },
		result,
	}, 80, undefined);
	assert.equal(missing[0]!.includes("◷"), false);
	const dim = hashlineCardLines({
		toolName: "replace",
		result: { ...result, durationMs: 12 },
	}, 80, { fg: (color, text) => (color === "dim" ? `[dim]${text}` : text) });
	assert.match(dim[0]!, /\[dim\]0\.01s$/);
});

test("a running edit is left on the badge", () => {
	let cleared = false;
	placeRichDiff({
		toolName: "replace",
		result,
		isPartial: true,
		contentBox: {
			clear() {
				cleared = true;
			},
			addChild() {},
		},
	});
	assert.equal(cleared, false);
});
