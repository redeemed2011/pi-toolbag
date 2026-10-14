import assert from "node:assert/strict";
import test from "node:test";
import { layoutChatParts, type ChatPart } from "./index.ts";

function part(kind: ChatPart["kind"], ...lines: string[]): ChatPart {
	return { kind, lines };
}

test("collapsed tools and a status line sit flush", () => {
	const layout = layoutChatParts([
		part("group", "● Ctx Record"),
		part("spacer", ""),
		part("status", " ctx: observer started (~4,985 tok)"),
		part("group", "• Thinking · Verifying the question is off the frontier before closing it."),
		part("group", "● Ctx Frontier"),
	]);
	assert.deepEqual(layout.lines, [
		"● Ctx Record",
		" ctx: observer started (~4,985 tok)",
		"• Thinking · Verifying the question is off the frontier before closing it.",
		"● Ctx Frontier",
	]);
	assert.deepEqual(layout.heights, [1, 0, 1, 1, 1]);
});

test("an expanded row keeps one blank line above and below", () => {
	const layout = layoutChatParts([
		part("group", "● Ctx Record"),
		part("group", "", "result text", "more", ""),
		part("group", "● Ctx Frontier"),
	]);
	assert.deepEqual(layout.lines, ["● Ctx Record", "", "result text", "more", "", "● Ctx Frontier"]);
});

test("a block that already ended blank does not gain a second blank", () => {
	const layout = layoutChatParts([
		part("other", "fails when one does not.", ""),
		part("group", "", "expanded result", ""),
		part("spacer", ""),
		part("status", " ctx: observer started"),
	]);
	assert.deepEqual(layout.lines, ["fails when one does not.", "", "expanded result", "", " ctx: observer started"]);
	assert.deepEqual(layout.heights, [2, 2, 0, 1]);
});
