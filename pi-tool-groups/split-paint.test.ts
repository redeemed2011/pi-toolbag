import assert from "node:assert/strict";
import test from "node:test";
import { initTheme, renderDiff } from "@earendil-works/pi-coding-agent";
import { hashlineDiffToGutter } from "./diff-display.ts";
import { loadSplitPaint, splitDiffFile } from "./split-paint.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	getBgAnsi: () => "",
	getFgAnsi: () => "",
};

function visible(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

test("installed droid paints a hashline gutter without the anchors", async () => {
	const file = splitDiffFile();
	const paint = await loadSplitPaint();
	if (!file) {
		assert.equal(paint, null);
		return;
	}
	assert.ok(paint);
	const display = hashlineDiffToGutter("-miCC│bravo\n+btfd│bravo-updated", [2, 2]);
	assert.ok(display);
	const lines = paint(display.gutter, 80, theme);
	const shown = visible(lines?.join("\n") ?? "");
	assert.match(shown, /bravo-updated/);
	assert.match(shown, /2 │ bravo/);
	assert.equal(shown.includes("btfd"), false);
	assert.equal(shown.includes("miCC"), false);
});

test("pi's unified diff accepts the same gutter", () => {
	initTheme("dark");
	const display = hashlineDiffToGutter("-miCC│bravo\n+btfd│bravo-updated", [2, 2]);
	assert.ok(display);
	const shown = visible(renderDiff(display.gutter));
	assert.match(shown, /bravo-updated/);
	assert.equal(shown.includes("btfd"), false);
	assert.equal(shown.includes("miCC"), false);
});
