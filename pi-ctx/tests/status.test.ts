import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { foldLive } from "../src/fold.js";
import { registerContextHook } from "../src/hooks/context-hook.js";
import { applyStatusToSystem, statusLine } from "../src/render/status.js";
import { Runtime } from "../src/runtime.js";
import {
	ATTACH_GUIDELINE,
	BIND_GUIDELINE,
	CLAIM_GUIDELINE,
	FINDING_GUIDELINE,
	FRONTIER_GUIDELINE,
	GET_GUIDELINE,
	GRANT_GUIDELINE,
	RECORD_GUIDELINE,
	ZOOM_GUIDELINE,
} from "../src/tools/guidelines.js";
import {
	CTX_BIND,
	CTX_CLAIM,
	CTX_OCCUPANCY,
	CTX_PENDING_INJECT,
	CTX_STATUS_INJECT,
	FOOTER_TAG,
	type Entry,
	type JudgmentRecord,
} from "../src/types.js";
import { assistantMsg, compaction, constraint, question, userMsg } from "./fixtures.js";

function bind(projectId = "p1"): Entry {
	return { type: "custom", id: "b", customType: CTX_BIND, data: { project_id: projectId } };
}

function claim(id: string | null): Entry {
	return { type: "custom", id: "cl", customType: CTX_CLAIM, data: { claimed_question_id: id } };
}

function occupancy(value: "gated-edge" | "claim-strip"): Entry {
	return { type: "custom", id: "oc", customType: CTX_OCCUPANCY, data: { occupancy: value } };
}

type HookMsg = { role?: string; customType?: string; content?: unknown };
type HookFn = (
	event: { messages: HookMsg[] },
	ctx: { sessionManager: { getBranch: () => Entry[] } },
) => { messages?: HookMsg[] } | undefined;

function capture(runtime: Runtime) {
	const handlers: Record<string, HookFn> = {};
	registerContextHook(
		{
			on(event: string, fn: HookFn) {
				handlers[event] = fn;
			},
		} as unknown as ExtensionAPI,
		runtime,
	);
	return (event: { messages: HookMsg[] }, ctx: { sessionManager: { getBranch: () => Entry[] } }) => {
		const contextResult = handlers.context?.(event, ctx);
		if (!contextResult) return undefined;
		const messages = contextResult.messages ?? event.messages;
		return handlers.context_with_system?.({ messages }, ctx) ?? contextResult;
	};
}

function statusOf(messages: { role?: string; content?: unknown }[] | undefined): string[] {
	const head = messages?.[0];
	if (!head || head.role !== "system" || typeof head.content !== "string") return [];
	const match = head.content.match(/<ctx-status>\n([\s\S]*?)\n<\/ctx-status>/);
	return match ? [match[1]] : [];
}

describe("ctx status line", () => {
	it("counts unblocked unclaimed questions and names a live claim", () => {
		const live = foldLive([
			question("q1", "one"),
			question("q2", "two"),
			{ ...question("f", "fog"), type: "fog", blocks: ["q2"] } as JudgmentRecord,
		]);
		expect(statusLine({ occupancy: "gated-edge", claimedId: null, live })).toBe(
			"ctx bound=1 occupancy=gated-edge claim_empty=1 claim_not_live=0 claim_blocked=0 open_questions=1",
		);
		expect(statusLine({ occupancy: "claim-strip", claimedId: "q1", live })).toBe(
			"ctx bound=1 occupancy=claim-strip claim_empty=0 claim_not_live=0 claim_blocked=0 open_questions=0 claimed=q1",
		);
	});

	it("marks a dead claim and a blocked claim instead of calling them empty", () => {
		const live = foldLive([
			question("q1", "one"),
			question("q2", "two"),
			{ ...question("f", "fog"), type: "fog", blocks: ["q2"] } as JudgmentRecord,
		]);
		expect(statusLine({ occupancy: "gated-edge", claimedId: "gone", live })).toBe(
			"ctx bound=1 occupancy=gated-edge claim_empty=0 claim_not_live=1 claim_blocked=0 open_questions=1 claimed=gone",
		);
		expect(statusLine({ occupancy: "gated-edge", claimedId: "q2", live })).toBe(
			"ctx bound=1 occupancy=gated-edge claim_empty=0 claim_not_live=0 claim_blocked=1 open_questions=1 claimed=q2",
		);
	});

	it("counts a live sibling, drops a superseded question, and does not cap at 20", () => {
		const sibling = foldLive([question("q1", "one"), question("q2", "two")]);
		expect(statusLine({ occupancy: "gated-edge", claimedId: "q1", live: sibling })).toContain(
			"open_questions=1 claimed=q1",
		);
		const replaced = foldLive([question("q1", "old"), { ...question("q2", "new"), supersedes: ["q1"] }]);
		expect(statusLine({ occupancy: "gated-edge", claimedId: null, live: replaced })).toBe(
			"ctx bound=1 occupancy=gated-edge claim_empty=1 claim_not_live=0 claim_blocked=0 open_questions=1",
		);
		const many = foldLive(Array.from({ length: 21 }, (_, i) => question(`q${i}`, "x")));
		expect(statusLine({ occupancy: "gated-edge", claimedId: null, live: many })).toContain("open_questions=21");
		const law = foldLive([constraint("c1", "law", "all"), question("q1", "one")]);
		expect(statusLine({ occupancy: "gated-edge", claimedId: "c1", live: law })).toBe(
			"ctx bound=1 occupancy=gated-edge claim_empty=0 claim_not_live=1 claim_blocked=0 open_questions=1 claimed=c1",
		);
	});

	it("does not let a claimed id rewrite the line", () => {
		const live = foldLive([question("q1", "one")]);
		const line = statusLine({ occupancy: "gated-edge", claimedId: "q1\nclaim_empty=1", live });
		expect(line).toBe(
			"ctx bound=1 occupancy=gated-edge claim_empty=0 claim_not_live=1 claim_blocked=0 open_questions=1 claimed=unsafe",
		);
		expect(line).not.toContain("\n");
	});

	it("replaces a previous line on the system message and strips it when empty", () => {
		const line = "ctx bound=1 occupancy=gated-edge claim_empty=1 open_questions=0";
		const replaced = applyStatusToSystem(
			[
				{ role: "system", content: "prompt" },
				{ role: "user", content: "keep" },
				{ role: "user", customType: CTX_STATUS_INJECT, content: "stale-a" },
				{ role: "user", customType: CTX_STATUS_INJECT, content: "stale-b" },
			],
			line,
		);
		expect(replaced.some((m) => m.role === "user" && String(m.content).includes("ctx bound="))).toBe(false);
		expect(replaced.some((m) => m.customType === CTX_STATUS_INJECT)).toBe(false);
		expect(replaced[1]).toEqual({ role: "user", content: "keep" });
		expect(replaced[0]?.content).toBe(`prompt\n\n<ctx-status>\n${line}\n</ctx-status>`);
		const next = "ctx bound=1 occupancy=gated-edge claim_empty=0 open_questions=1";
		expect(applyStatusToSystem(replaced, next)[0]?.content).toBe(`prompt\n\n<ctx-status>\n${next}\n</ctx-status>`);
		expect(applyStatusToSystem(replaced, "")[0]).toEqual({ role: "system", content: "prompt" });
	});

	it("is absent when unbound and does not drop the user message", () => {
		const fire = capture(new Runtime());
		const unbound = fire(
			{
				messages: [
					{ role: "user", content: "keep" },
					{ role: "user", customType: CTX_STATUS_INJECT, content: "stale" },
				],
			},
			{ sessionManager: { getBranch: () => [] } },
		);
		expect(unbound?.messages).toEqual([{ role: "user", content: "keep" }]);
	});

	it("stays on a later bound turn without the constitution", () => {
		const runtime = new Runtime();
		runtime.config.occupancy = "gated-edge";
		runtime.projectRecords = [question("q1", "one"), constraint("c-all", "never X", "all")];
		const fire = capture(runtime);
		const branch = [
			userMsg("u1", "hi"),
			compaction("c1", "u1"),
			assistantMsg("a2", "went"),
			bind(),
			occupancy("claim-strip"),
			claim("q1"),
		];
		const bound = fire(
			{
				messages: [
					{ role: "system", content: "prompt" },
					{ role: "user", content: "keep" },
					{ role: "user", customType: CTX_STATUS_INJECT, content: "stale" },
				],
			},
			{ sessionManager: { getBranch: () => branch } },
		);
		expect(bound?.messages?.some((m) => m.customType === FOOTER_TAG)).toBe(false);
		expect(bound?.messages?.some((m) => m.customType === CTX_STATUS_INJECT)).toBe(false);
		expect(bound?.messages?.some((m) => m.role === "user" && m.content === "keep")).toBe(true);
		expect(statusOf(bound?.messages)).toEqual([
			"ctx bound=1 occupancy=claim-strip claim_empty=0 claim_not_live=0 claim_blocked=0 open_questions=0 claimed=q1",
		]);
	});

	it("follows the constitution on the first call after compact", () => {
		const runtime = new Runtime();
		runtime.projectRecords = [constraint("c-all", "never X", "all"), question("q1", "one")];
		const fire = capture(runtime);
		const branch = [userMsg("u1", "hi"), compaction("c1", "u1"), bind()];
		const first = fire(
			{ messages: [{ role: "system", content: "prompt" }, { role: "user", content: "continue" }] },
			{ sessionManager: { getBranch: () => branch } },
		);
		const footer = first?.messages?.find((m) => m.customType === FOOTER_TAG);
		expect(String(footer?.content)).toContain("never X");
		expect(statusOf(first?.messages)).toEqual([
			"ctx bound=1 occupancy=gated-edge claim_empty=1 claim_not_live=0 claim_blocked=0 open_questions=1",
		]);
		expect(first?.messages?.some((m) => m.customType === CTX_STATUS_INJECT)).toBe(false);
		expect(first?.messages?.some((m) => m.role === "user" && m.content === "continue")).toBe(true);
	});

	it("keeps a pending replace beside the status line", () => {
		const runtime = new Runtime();
		runtime.projectRecords = [{ ...question("p1", "replace the law"), type: "pending_replace" }];
		const fire = capture(runtime);
		const got = fire(
			{ messages: [{ role: "system", content: "prompt" }, { role: "user", content: "keep" }] },
			{ sessionManager: { getBranch: () => [bind()] } },
		);
		expect(got?.messages?.some((m) => m.customType === CTX_PENDING_INJECT && String(m.content).includes("p1"))).toBe(
			true,
		);
		expect(statusOf(got?.messages)).toEqual([
			"ctx bound=1 occupancy=gated-edge claim_empty=1 claim_not_live=0 claim_blocked=0 open_questions=0",
		]);
		expect(got?.messages?.some((m) => m.customType === CTX_STATUS_INJECT)).toBe(false);
		expect(got?.messages?.some((m) => m.role === "user" && m.content === "keep")).toBe(true);
	});

	it("does nothing when ctx is disabled or passive", () => {
		const off = new Runtime();
		off.enabled = false;
		expect(capture(off)({ messages: [{ role: "user", content: "keep" }] }, { sessionManager: { getBranch: () => [bind()] } })).toBeUndefined();
		const passive = new Runtime();
		passive.config.passive = true;
		expect(
			capture(passive)({ messages: [{ role: "user", content: "keep" }] }, { sessionManager: { getBranch: () => [bind()] } }),
		).toBeUndefined();
	});

	it("uses the config occupancy when the session has none", () => {
		const runtime = new Runtime();
		runtime.config.occupancy = "claim-strip";
		const fire = capture(runtime);
		const got = fire({ messages: [{ role: "system", content: "prompt" }] }, { sessionManager: { getBranch: () => [bind()] } });
		expect(statusOf(got?.messages)).toEqual([
			"ctx bound=1 occupancy=claim-strip claim_empty=1 claim_not_live=0 claim_blocked=0 open_questions=0",
		]);
		expect(got?.messages?.some((m) => m.customType === FOOTER_TAG)).toBe(false);
	});

	it("drops the line after unbind and clears a closed claim", () => {
		const runtime = new Runtime();
		runtime.projectRecords = [question("q1", "one"), question("q2", "two")];
		const fire = capture(runtime);
		const messages = [
			{ role: "system", content: "prompt" },
			{ role: "user", content: "keep" },
			{ role: "user", customType: CTX_STATUS_INJECT, content: "stale" },
		];
		const unbound = fire(
			{ messages },
			{
				sessionManager: {
					getBranch: () => [bind(), { type: "custom", id: "u", customType: CTX_BIND, data: { project_id: null } }],
				},
			},
		);
		expect(unbound?.messages).toEqual([
			{ role: "system", content: "prompt" },
			{ role: "user", content: "keep" },
		]);
		const closed = fire({ messages }, { sessionManager: { getBranch: () => [bind(), claim("q1"), claim(null)] } });
		expect(closed?.messages?.some((m) => m.role === "user" && m.content === "keep")).toBe(true);
		expect(closed?.messages?.some((m) => m.customType === CTX_STATUS_INJECT)).toBe(false);
		expect(statusOf(closed?.messages)).toEqual([
			"ctx bound=1 occupancy=gated-edge claim_empty=1 claim_not_live=0 claim_blocked=0 open_questions=2",
		]);
	});
});

describe("ctx tool duties", () => {
	it("names each tool and the status-line rule that calls it", () => {
		expect(GET_GUIDELINE).toContain("ctx_get");
		expect(GET_GUIDELINE).toContain("status line is absent");
		expect(GET_GUIDELINE).toContain("not a user message");
		expect(GET_GUIDELINE).toContain("once");
		expect(ZOOM_GUIDELINE).toContain("ctx_zoom");
		expect(FRONTIER_GUIDELINE).toContain("ctx_frontier");
		expect(FRONTIER_GUIDELINE).toContain("claim_empty=1");
		expect(FRONTIER_GUIDELINE).toContain("once");
		expect(CLAIM_GUIDELINE).toContain("ctx_claim");
		expect(CLAIM_GUIDELINE).toContain("claim_not_live=1");
		expect(CLAIM_GUIDELINE).toContain("claim_blocked=1");
		expect(CLAIM_GUIDELINE).toContain("silent-swap");
		expect(BIND_GUIDELINE).toContain("ctx_bind");
		expect(BIND_GUIDELINE).toContain("never bind silently");
		expect(RECORD_GUIDELINE).toContain("ctx_record");
		expect(RECORD_GUIDELINE).toContain("turn notes");
		expect(GRANT_GUIDELINE).toContain("ctx_grant");
		expect(ATTACH_GUIDELINE).toContain("ctx_attach");
		expect(FINDING_GUIDELINE).toContain("ctx_finding");
		expect(FINDING_GUIDELINE).toContain("ctx_record");
		expect(FINDING_GUIDELINE).toContain("ctx_bind");
		expect(BIND_GUIDELINE).toContain("Mint law with ctx_record.");
		const register = readFileSync(new URL("../src/tools/register.ts", import.meta.url), "utf8");
		for (const name of [
			"GET_GUIDELINE",
			"ZOOM_GUIDELINE",
			"FRONTIER_GUIDELINE",
			"CLAIM_GUIDELINE",
			"BIND_GUIDELINE",
			"RECORD_GUIDELINE",
			"GRANT_GUIDELINE",
			"ATTACH_GUIDELINE",
			"FINDING_GUIDELINE",
		]) {
			expect(register).toContain(`promptGuidelines: [${name}]`);
		}
	});
});
