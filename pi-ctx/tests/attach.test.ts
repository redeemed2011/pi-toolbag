import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runClaimFlow } from "../src/commands/claim.js";
import { foldSession } from "../src/fold.js";
import { findingRawError, GRANT_TYPE, hashGrantToken } from "../src/grant.js";
import { registerContextHook } from "../src/hooks/context-hook.js";
import { onPendingReplaceSettled } from "../src/hooks/pending-replace-hook.js";
import type { Hitl } from "../src/hitl.js";
import { Runtime } from "../src/runtime.js";
import { lineToJudgment } from "../src/store/jsonl.js";
import { appendProjectRecord, createProject, loadProjectRecords } from "../src/store/project.js";
import { registerTools } from "../src/tools/register.js";
import {
	CTX_BIND,
	CTX_CLAIM,
	CTX_OCCUPANCY,
	CTX_PENDING_TURN,
	type Entry,
} from "../src/types.js";
import { compaction } from "./fixtures.js";

type Tool = {
	name: string;
	prepareArguments?: (args: unknown) => unknown;
	execute: (...args: never[]) => Promise<{ details: unknown }>;
};

function hitl(): Hitl {
	return {
		hasUI: true,
		select: async () => undefined,
		confirm: async () => true,
		input: async () => undefined,
		notify: () => {},
	};
}

function openSession(sessionId: string) {
	const runtime = new Runtime();
	const branch: Entry[] = [];
	const tools = new Map<string, Tool>();
	let footer: string | undefined;
	let confirms = 0;
	const pi = {
		appendEntry(customType: string, data?: unknown) {
			branch.push({ type: "custom", id: `${sessionId}-${branch.length}`, customType, data });
		},
		registerTool(tool: Tool) {
			tools.set(tool.name, tool);
		},
	};
	registerTools(pi as never, runtime);
	const ctx = {
		cwd: "/tmp/work",
		hasUI: true,
		sessionManager: { getBranch: () => branch, getSessionId: () => sessionId },
		ui: {
			setStatus: (_key: string, text: string | undefined) => {
				footer = text;
			},
			select: async () => undefined,
			confirm: async () => {
				confirms += 1;
				return true;
			},
			input: async () => undefined,
			notify: () => {},
		},
	};
	return {
		runtime,
		branch,
		tools,
		pi,
		footer: () => footer,
		confirms: () => confirms,
		async call(name: string, params: unknown) {
			const tool = tools.get(name);
			if (!tool) throw new Error(`missing ${name}`);
			const prepared = tool.prepareArguments ? tool.prepareArguments(params) : params;
			return tool.execute("call" as never, prepared as never, undefined as never, undefined as never, ctx as never);
		},
	};
}

function bind(projectId = "demo", extra: Record<string, unknown> = {}): Entry {
	return { type: "custom", id: "bind", customType: CTX_BIND, data: { project_id: projectId, ...extra } };
}

function seedProject() {
	createProject("Demo", "demo");
	appendProjectRecord("demo", "orch", {
		id: "q1",
		type: "question",
		ts: "2026-10-09T00:00:00.000Z",
		session: "orch",
		headline: "the question",
		body: "do the question",
	});
	appendProjectRecord("demo", "orch", {
		id: "q2",
		type: "question",
		ts: "2026-10-09T00:00:01.000Z",
		session: "orch",
		headline: "other question",
		body: "other",
	});
	appendProjectRecord("demo", "orch", {
		id: "c1",
		type: "constraint",
		ts: "2026-10-09T00:00:02.000Z",
		session: "orch",
		headline: "the law",
		body: "never leak",
		directive: "never leak",
		applies_to: "all",
	});
	appendProjectRecord("demo", "orch", {
		id: "pr1",
		type: "pending_replace",
		ts: "2026-10-09T00:00:03.000Z",
		session: "orch",
		headline: "pending",
		body: "newer wording",
		parent: "c1",
	});
}

function hookText(runtime: Runtime, branch: Entry[]): string {
	const handlers: Record<string, (event: { messages: Array<{ role?: string; content?: unknown }> }, ctx: { sessionManager: { getBranch: () => Entry[] } }) => { messages?: Array<{ role?: string; content?: unknown }> } | undefined> = {};
	registerContextHook({
		on(event: string, fn: (typeof handlers)[string]) {
			handlers[event] = fn;
		},
	} as never, runtime);
	const event = { messages: [{ role: "system", content: "base" }, { role: "user", content: "go" }] };
	const ctx = { sessionManager: { getBranch: () => branch } };
	const contextResult = handlers.context?.(event, ctx);
	const messages = contextResult?.messages ?? event.messages;
	const withStatus = handlers.context_with_system?.({ messages }, ctx)?.messages ?? messages;
	return withStatus.map((message) => String(message.content ?? "")).join("\n");
}

describe("worker attach", () => {
	const prev = process.env.CTX_HOME;
	let home: string;

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "ctx-attach-"));
		process.env.CTX_HOME = home;
	});

	afterEach(() => {
		if (prev === undefined) delete process.env.CTX_HOME;
		else process.env.CTX_HOME = prev;
	});

	it("folds a legacy bind as an orchestrator, a grant as a worker, and an unbind as neither", () => {
		const legacy = foldSession([bind()], "s");
		expect(legacy).toMatchObject({ bound: true, projectId: "demo", grantId: null, grantQuestionId: null });
		const worker = foldSession([bind("demo", { grant_id: "g1", question_id: "q1" })], "s");
		expect(worker).toMatchObject({ bound: true, grantId: "g1", grantQuestionId: "q1" });
		const unbound = foldSession([
			bind("demo", { grant_id: "g1", question_id: "q1" }),
			{ type: "custom", id: "u", customType: CTX_BIND, data: { project_id: null } },
		], "s");
		expect(unbound).toMatchObject({ bound: false, projectId: null, grantId: null, grantQuestionId: null });
	});

	it("grants a live question without the claim check, and the law loader skips the line", async () => {
		seedProject();
		appendProjectRecord("demo", "orch", {
			id: "q-big",
			type: "question",
			ts: "2026-10-09T00:00:04.000Z",
			session: "orch",
			headline: "big",
			body: "x".repeat(1200 * 4 + 4),
		});
		const orch = openSession("orch");
		orch.branch.push(bind(), { type: "custom", id: "oc", customType: CTX_OCCUPANCY, data: { occupancy: "claim-strip" } });
		orch.branch.push({ type: "custom", id: "cl", customType: CTX_CLAIM, data: { claimed_question_id: "q2" } });
		const missing = await orch.call("ctx_grant", { question_id: "gone" });
		expect(missing.details).toEqual({ ok: false, error: "not_found" });
		const huge = await orch.call("ctx_grant", { question_id: "q-big" });
		expect((huge.details as { ok: boolean }).ok).toBe(true);
		const granted = await orch.call("ctx_grant", { question_id: "q1" });
		const grant = granted.details as { ok: true; project_id: string; token: string; grant_id: string };
		expect(grant.project_id).toBe("demo");
		expect(orch.runtime.claimedId).toBe("q2");
		const raw = readFileSync(join(home, "projects/demo/logs/orch.jsonl"), "utf8");
		expect(raw).not.toContain(grant.token);
		expect(raw).toContain(hashGrantToken(grant.token));
		expect(loadProjectRecords("demo").some((record) => record.id === grant.grant_id)).toBe(false);
		expect(lineToJudgment({
			id: grant.grant_id,
			type: GRANT_TYPE,
			ts: "2026-10-09T00:00:05.000Z",
			session: "orch",
			question_id: "q1",
			token_hash: "abc",
		})).toBeUndefined();
		const fresh = openSession("nope");
		expect((await fresh.call("ctx_grant", { question_id: "q1" })).details).toEqual({ ok: false, error: "no project bound" });
	});

	it("attaches a fresh session from the returned token and shows law before the next tool call", async () => {
		seedProject();
		const orch = openSession("orch");
		orch.branch.push(bind());
		const grant = (await orch.call("ctx_grant", { question_id: "q1" })).details as { token: string; project_id: string };
		const worker = openSession("worker");
		worker.branch.push(compaction("compact", "u0"));
		const attached = await worker.call("ctx_attach", { project_id: grant.project_id, token: grant.token });
		expect(attached.details).toMatchObject({ ok: true, project_id: "demo", question_id: "q1", claimed_id: "q1" });
		expect(worker.runtime.bound).toBe(true);
		expect(worker.runtime.projectRecords.some((record) => record.id === "c1")).toBe(true);
		expect(worker.footer()).toBe("ctx: Demo");
		expect(worker.branch.map((entry) => entry.customType)).toEqual([undefined, CTX_BIND, CTX_CLAIM]);
		const shown = hookText(worker.runtime, worker.branch);
		expect(shown).toContain("never leak");
		expect(shown).toContain("bound=1");
		const turns: Array<{ type: string }> = [];
		await onPendingReplaceSettled({
			appendEntry: (customType: string) => {
				turns.push({ type: customType });
			},
		} as never, worker.runtime, {
			hasUI: true,
			sessionManager: { getBranch: () => worker.branch, getSessionId: () => "worker" },
		});
		expect(turns).toEqual([{ type: CTX_PENDING_TURN }]);
		const second = openSession("worker-2");
		expect((await second.call("ctx_attach", { project_id: "demo", token: grant.token })).details).toMatchObject({ ok: true, claimed_id: "q1" });
	});

	it("refuses grant, record, and bind on the attached worker", async () => {
		seedProject();
		const orch = openSession("orch");
		orch.branch.push(bind());
		const grant = (await orch.call("ctx_grant", { question_id: "q1" })).details as { token: string };
		const worker = openSession("worker");
		await worker.call("ctx_attach", { project_id: "demo", token: grant.token });
		const linesBefore = readFileSync(join(home, "projects/demo/logs/orch.jsonl"), "utf8").split("\n").length;
		expect((await worker.call("ctx_grant", { question_id: "q2" })).details).toEqual({ ok: false, error: "worker cannot grant" });
		expect((await worker.call("ctx_record", { type: "decision", headline: "sneak" })).details).toEqual({ ok: false, error: "worker cannot record" });
		expect((await worker.call("ctx_bind", {})).details).toEqual({ ok: false, error: "worker cannot bind" });
		expect(worker.confirms()).toBe(0);
		expect(readFileSync(join(home, "projects/demo/logs/orch.jsonl"), "utf8").split("\n").length).toBe(linesBefore);
	});

	it("limits the claim tool to the granted question and leaves the slash command alone", async () => {
		seedProject();
		const orch = openSession("orch");
		orch.branch.push(bind());
		const grant = (await orch.call("ctx_grant", { question_id: "q1" })).details as { token: string };
		const worker = openSession("worker");
		await worker.call("ctx_attach", { project_id: "demo", token: grant.token });
		expect((await worker.call("ctx_claim", { action: "claim", question_id: "q2" })).details).toEqual({ ok: false, error: "worker claim limited" });
		expect(worker.runtime.claimedId).toBe("q1");
		expect((await worker.call("ctx_claim", { action: "close" })).details).toMatchObject({ ok: true, claimed_id: null });
		expect((await worker.call("ctx_claim", { action: "claim", question_id: "q1" })).details).toMatchObject({ ok: true, claimed_id: "q1" });
		const slash = await runClaimFlow({
			pi: worker.pi,
			runtime: worker.runtime,
			hitl: hitl(),
			action: "claim",
			question_id: "q2",
		});
		expect(slash).toEqual({ ok: true, claimed_id: "q2" });
	});

	it("writes nothing when attach fails", async () => {
		seedProject();
		const orch = openSession("orch");
		orch.branch.push(bind());
		const grant = (await orch.call("ctx_grant", { question_id: "q1" })).details as { token: string };
		const namesBefore = readdirSync(join(home, "projects"));
		const bad = openSession("bad");
		expect((await bad.call("ctx_attach", { project_id: "../demo", token: grant.token })).details).toEqual({ ok: false, error: "bad project id" });
		expect((await bad.call("ctx_attach", { project_id: "missing-proj", token: grant.token })).details).toEqual({ ok: false, error: "not_found" });
		expect(readdirSync(join(home, "projects"))).toEqual(namesBefore);
		expect(existsSync(join(home, "projects/missing-proj"))).toBe(false);
		createProject("Ok", "ok-id");
		writeFileSync(join(home, "projects/ok-id/project.json"), `${JSON.stringify({ id: "other-id", name: "Ok", created_at: "t" })}\n`);
		expect((await bad.call("ctx_attach", { project_id: "ok-id", token: grant.token })).details).toEqual({ ok: false, error: "not_found" });
		expect((await bad.call("ctx_attach", { project_id: "demo", token: "nope" })).details).toEqual({ ok: false, error: "grant not found" });
		expect(bad.branch).toEqual([]);
		expect(bad.runtime.bound).toBe(false);

		const used = openSession("used");
		used.branch.push(bind(), { type: "custom", id: "u", customType: CTX_BIND, data: { project_id: null } });
		const before = used.branch.length;
		expect((await used.call("ctx_attach", { project_id: "demo", token: grant.token })).details).toEqual({ ok: false, error: "not a fresh session" });
		expect(used.branch).toHaveLength(before);

		appendProjectRecord("demo", "orch", {
			id: "fog",
			type: "fog",
			ts: "2026-10-09T00:00:05.000Z",
			session: "orch",
			headline: "blocked",
			body: "blocked",
			blocks: ["q1"],
		});
		const blocked = openSession("blocked");
		expect((await blocked.call("ctx_attach", { project_id: "demo", token: grant.token })).details).toEqual({ ok: false, error: "blocked" });
		expect(blocked.branch).toEqual([]);

		appendProjectRecord("demo", "orch", {
			id: "q-big",
			type: "question",
			ts: "2026-10-09T00:00:06.000Z",
			session: "orch",
			headline: "big",
			body: "x".repeat(1200 * 4 + 4),
		});
		const bigGrant = (await orch.call("ctx_grant", { question_id: "q-big" })).details as { token: string };
		const huge = openSession("huge");
		huge.branch.push({ type: "custom", id: "oc", customType: CTX_OCCUPANCY, data: { occupancy: "claim-strip" } });
		expect((await huge.call("ctx_attach", { project_id: "demo", token: bigGrant.token })).details).toEqual({ ok: false, error: "question_too_large" });
		expect(huge.branch).toHaveLength(1);

		appendProjectRecord("demo", "orch", {
			id: "q1b",
			type: "question",
			ts: "2026-10-09T00:00:07.000Z",
			session: "orch",
			headline: "replacement",
			body: "replacement",
			supersedes: ["q1"],
		});
		const retired = openSession("retired");
		expect((await retired.call("ctx_attach", { project_id: "demo", token: grant.token })).details).toEqual({ ok: false, error: "not_found" });
		expect(retired.branch).toEqual([]);
	});

	it("files a finding only from a worker, including after focus drops or the question is retired", async () => {
		seedProject();
		const orch = openSession("orch");
		orch.branch.push(bind());
		expect(findingRawError({ headline: "h", body: "b", parent: "q1" })).toBe("extra field");
		const prepared = orch.tools.get("ctx_finding")!.prepareArguments?.({ headline: "h", body: "b", supersedes: "c1" });
		expect(prepared).toEqual({ headline: "", body: "", __refuse: "extra field" });
		expect((await orch.call("ctx_finding", { headline: "h", body: "b", parent: "q1" })).details).toEqual({ ok: false, error: "extra field" });
		expect((await orch.call("ctx_finding", { headline: "h", body: "b" })).details).toEqual({ ok: false, error: "not a worker" });
		const grant = (await orch.call("ctx_grant", { question_id: "q1" })).details as { token: string };
		const worker = openSession("worker");
		await worker.call("ctx_attach", { project_id: "demo", token: grant.token });
		const filed = (await worker.call("ctx_finding", { headline: "saw it", body: "the result" })).details as {
			ok: true;
			record: { id: string; type: string; parent?: string; session: string };
		};
		expect(filed.record).toMatchObject({ type: "finding", parent: "q1", session: "worker" });
		await worker.call("ctx_claim", { action: "close" });
		const later = (await worker.call("ctx_finding", { headline: "after drop", body: "still filed" })).details as { ok: true; record: { id: string } };
		expect(later.ok).toBe(true);
		appendProjectRecord("demo", "orch", {
			id: "q1b",
			type: "question",
			ts: "2026-10-09T00:00:08.000Z",
			session: "orch",
			headline: "replacement",
			body: "replacement",
			supersedes: ["q1"],
		});
		const retired = (await worker.call("ctx_finding", { headline: "after retire", body: "kept" })).details as { ok: true; record: { id: string } };
		expect(retired.ok).toBe(true);
		appendProjectRecord("demo", "worker", {
			id: "f-new",
			type: "finding",
			ts: "2026-10-09T00:00:09.000Z",
			session: "worker",
			headline: "replaces the first",
			body: "replaces the first",
			parent: "q1",
			supersedes: [filed.record.id],
		});
		const looked = (await worker.call("ctx_get", { id: "q1" })).details as {
			findings: Array<{ id: string; session: string; headline: string; live: boolean; body?: string }>;
		};
		const first = looked.findings.find((item) => item.id === filed.record.id);
		expect(first).toEqual({ id: filed.record.id, session: "worker", headline: "saw it", live: false });
		expect(first).not.toHaveProperty("body");
		expect(looked.findings.find((item) => item.id === "f-new")).toMatchObject({ live: true, session: "worker" });
	});
});
