import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBindFlow } from "../src/commands/bind.js";
import { DEFAULTS, resolvePromoterModel } from "../src/config.js";
import { foldLive, foldSession } from "../src/fold.js";
import { applyPromoterResult } from "../src/promoter/apply.js";
import { pendingReplaceSection } from "../src/promoter/inject.js";
import { extractAssistantQuotes, extractUserQuotes, quoteInCorpus } from "../src/promoter/quotes.js";
import { promoterKickoffPrompt } from "../src/promoter/io.js";
import { PROMOTER_EXTENSION_PATH, receiptText } from "../src/promoter/run.js";
import { DEFER_ONE, KEEP, SUPERSEDE, runPendingReplaceHitl } from "../src/promoter/hitl.js";
import { isCompletedParentTurn, onPendingReplaceSettled, registerPendingReplaceHook } from "../src/hooks/pending-replace-hook.js";
import { parsePromoterResult } from "../src/promoter/schema.js";
import { renderInject } from "../src/render/inject.js";
import { Runtime } from "../src/runtime.js";
import { appendProjectRecord, createProject, loadProjectRecords } from "../src/store/project.js";
import { assistantMsg, constraint, userMsg } from "./fixtures.js";
import { readFileSync } from "node:fs";

describe("promoter harvest", () => {
	const prev = process.env.CTX_HOME;
	let home: string;

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "ctx-home-"));
		process.env.CTX_HOME = home;
	});
	afterEach(() => {
		if (prev === undefined) delete process.env.CTX_HOME;
		else process.env.CTX_HOME = prev;
	});

	it("extracts user-role quotes only", () => {
		expect(extractUserQuotes([userMsg("u1", "Never invoke the pi wrapper from tests.")])).toEqual([
			"Never invoke the pi wrapper from tests.",
		]);
	});

	it("inlines corpus in the promoter -p prompt", () => {
		const prompt = promoterKickoffPrompt({
			corpus: ["Do not invent Spawn Envelope."],
			live: [{ id: "c1", headline: "old", body: "old law" }],
			n: 10,
			chars: 280,
		});
		expect(prompt).toContain("Do not invent Spawn Envelope.");
		expect(prompt).toContain("BEGIN KICKOFF JSON");
		expect(prompt).toContain("c1");
	});

	it("requires verbatim substring", () => {
		expect(quoteInCorpus("Never invoke the pi wrapper from tests.", ["Never invoke the pi wrapper from tests."])).toBe(
			true,
		);
		expect(quoteInCorpus("Never use sqlite", ["Never invoke the pi wrapper from tests."])).toBe(false);
	});

	it("mints a verbatim all-constraint and skips paraphrase", () => {
		createProject("p", "p");
		const quote = "Do not write occupancy on project.json.";
		const report = applyPromoterResult({
			projectId: "p",
			sessionId: "sess",
			occupancy: "gated-edge",
			siblingKnob: 0,
			claimedId: null,
			existing: [],
			corpus: [quote],
			result: {
				promote: [{ quote }, { quote: "Always persist in sqlite instead." }],
				pending_replace: [],
			},
		});
		expect(report.promoted).toHaveLength(1);
		expect(report.promoted[0].type).toBe("constraint");
		expect(report.promoted[0].applies_to).toBe("all");
		expect(report.promoted[0].directive).toBe(quote);
		expect(report.skipped.some((s) => s.includes("not verbatim"))).toBe(true);
	});

	it("queues pending_replace instead of minting a contradicting constraint; not a live body", () => {
		createProject("p", "p");
		const live = constraint("c1", "confirm per candidate on bind", "all");
		live.headline = "confirm-only promotion pass";
		live.directive = live.body;
		const quote = "Bind is consent to promote what should clearly be promoted";
		const report = applyPromoterResult({
			projectId: "p",
			sessionId: "sess",
			occupancy: "gated-edge",
			siblingKnob: 0,
			claimedId: null,
			existing: [live],
			corpus: [quote],
			result: {
				promote: [],
				pending_replace: [{ quote, live_id: "c1", reason: "replaces confirm-per-candidate" }],
			},
		});
		expect(report.pending).toHaveLength(1);
		expect(report.pending[0].type).toBe("pending_replace");
		expect(report.pending[0].parent).toBe("c1");
		const folded = foldLive(report.existing);
		expect(folded.constraints.map((c) => c.id)).toEqual(["c1"]);
		expect(folded.pendingReplaces).toHaveLength(1);
		expect(pendingReplaceSection(folded)).toContain("Pending replace");
		expect(pendingReplaceSection(folded)).toContain(quote);
	});

	it("skips duplicate normalized headlines", () => {
		createProject("p", "p");
		const live = constraint("c1", "Never silently bind", "all");
		live.headline = "Never silently bind";
		live.directive = live.body;
		const report = applyPromoterResult({
			projectId: "p",
			sessionId: "sess",
			occupancy: "gated-edge",
			siblingKnob: 0,
			claimedId: null,
			existing: [live],
			corpus: ["Never silently bind"],
			result: { promote: [{ quote: "Never silently bind" }], pending_replace: [] },
		});
		expect(report.promoted).toHaveLength(0);
		expect(report.skipped.some((s) => s.includes("duplicate"))).toBe(true);
	});

	it("bind harvest uses promoterRun and latches the session", async () => {
		const runtime = new Runtime();
		runtime.sessionId = "sess-h";
		const entries: { type: string; data?: unknown }[] = [];
		const quote = "Stop calling them Job 1 and Job 2.";
		const result = await runBindFlow({
			pi: { appendEntry: (customType, data) => entries.push({ type: customType, data }) },
			runtime,
			hitl: {
				hasUI: true,
				select: async (_t, options) => options.find((o) => o.startsWith("new:")) ?? options[0],
				confirm: async () => true,
				input: async () => undefined,
				notify: () => {},
			},
			cwd: "/tmp/work",
			branch: [userMsg("u1", quote)],
			suggestedName: "harvest-app",
			promoterRun: async () => ({ promote: [{ quote }], pending_replace: [] }),
		});
		expect(result.ok).toBe(true);
		expect(entries.some((e) => e.type === "ctx.promoter.latch")).toBe(true);
		const recs = loadProjectRecords("harvest-app");
		expect(recs.some((r) => r.type === "constraint" && r.body === quote)).toBe(true);
	});

	it("says when the promoter returns nothing", async () => {
		const runtime = new Runtime();
		runtime.sessionId = "sess-empty";
		const notes: string[] = [];
		const result = await runBindFlow({
			pi: { appendEntry: () => {} },
			runtime,
			hitl: {
				hasUI: true,
				select: async (_t, options) => options.find((o) => o.startsWith("new:")) ?? options[0],
				confirm: async () => true,
				input: async () => undefined,
				notify: (message: string) => notes.push(message),
			},
			cwd: "/tmp/work",
			branch: [userMsg("u1", "Never mention the shelf cap in the receipt.")],
			suggestedName: "empty-harvest",
			promoterRun: async () => ({ promote: [], pending_replace: [], shelf: [] }),
		});
		expect(result.ok).toBe(true);
		expect(notes.some((n) => n.includes("Promoter returned nothing."))).toBe(true);
	});
	it("an empty harvest of a task-list contradiction leaves seeded law and names the empty result", async () => {
		createProject("task-list-drop", "task-list-drop");
		const law = constraint("cap-visible", "Always keep the shelf cap visible in the receipt.", "all");
		law.headline = "Shelf cap stays visible";
		law.directive = law.body;
		appendProjectRecord("task-list-drop", "seed", law);
		appendProjectRecord("task-list-drop", "seed", {
			id: "dest-happy",
			type: "destination",
			ts: "2026-09-14T10:00:01.000Z",
			session: "seed",
			headline: "Happy-path harvest",
			body: "The destination is the happy-path harvest.",
			rationale: "source: user",
		});
		const notes: string[] = [];
		const mixed = [
			"Never mention the shelf cap in the receipt.",
			"The destination is to hide the receipt cap.",
			"Line 1, a house rule you invent: one sentence that shelf records must be stored as constraints.",
			"Line 2, a finding: one sentence that the previous destination was replaced.",
			"Line 3, a destination: one sentence that the destination is now to hide the receipt cap.",
		].join("\n\n");
		const result = await runBindFlow({
			pi: { appendEntry: () => {} },
			runtime: Object.assign(new Runtime(), { sessionId: "sess-task" }),
			hitl: {
				hasUI: true,
				select: async (_t: string, options: string[]) => options.find((o) => o.startsWith("new:")) ?? options[0],
				confirm: async () => true,
				input: async () => undefined,
				notify: (message: string) => notes.push(message),
			},
			cwd: "/tmp/work",
			branch: [userMsg("u", mixed), assistantMsg("a", "Shelf records have to be kept in the form of constraints.")],
			suggestedName: "task-list-drop",
			promoterRun: async () => ({ promote: [], pending_replace: [], shelf: [] }),
		});
		expect(result.ok).toBe(true);
		expect(notes.some((n) => n.includes("Promoter returned nothing."))).toBe(true);
		const folded = foldLive(loadProjectRecords("task-list-drop"));
		expect(folded.constraints.map((c) => c.id)).toEqual(["cap-visible"]);
		expect(folded.destinations.map((d) => d.id)).toEqual(["dest-happy"]);
		expect(folded.pendingReplaces).toHaveLength(0);
	});

	it("a clean contradiction stays a pending replace and does not replace the destination", async () => {
		createProject("clean-conflict", "clean-conflict");
		const law = constraint("cap-visible", "Always keep the shelf cap visible in the receipt.", "all");
		law.headline = "Shelf cap stays visible";
		law.directive = law.body;
		appendProjectRecord("clean-conflict", "seed", law);
		appendProjectRecord("clean-conflict", "seed", {
			id: "dest-happy",
			type: "destination",
			ts: "2026-09-14T10:00:01.000Z",
			session: "seed",
			headline: "Happy-path harvest",
			body: "The destination is the happy-path harvest.",
			rationale: "source: user",
		});
		const quote = "Never mention the shelf cap in the receipt.";
		const notes: string[] = [];
		const result = await runBindFlow({
			pi: { appendEntry: () => {} },
			runtime: Object.assign(new Runtime(), { sessionId: "sess-clean" }),
			hitl: {
				hasUI: true,
				select: async (title: string, options: string[]) => {
					if (title.startsWith("Pending replace")) return "Defer this one";
					return options.find((o) => o.startsWith("new:")) ?? options[0];
				},
				confirm: async () => true,
				input: async () => undefined,
				notify: (message: string) => notes.push(message),
			},
			cwd: "/tmp/work",
			branch: [userMsg("u", quote)],
			suggestedName: "clean-conflict",
			promoterRun: async () => ({
				promote: [],
				pending_replace: [{ quote, live_id: "cap-visible" }],
				shelf: [],
			}),
		});
		expect(result.ok).toBe(true);
		expect(notes.some((n) => n.includes("Pending replace: 1."))).toBe(true);
		expect(notes.some((n) => n.includes("Promoter returned nothing."))).toBe(false);
		const folded = foldLive(loadProjectRecords("clean-conflict"));
		expect(folded.constraints.map((c) => c.id)).toEqual(["cap-visible"]);
		expect(folded.destinations.map((d) => d.id)).toEqual(["dest-happy"]);
		expect(folded.pendingReplaces.map((p) => p.parent)).toEqual(["cap-visible"]);
		expect(folded.pendingReplaces[0]?.body).toBe(quote);
	});
	it("second bind in the same session does not harvest again after latch", async () => {
		const runtime = new Runtime();
		runtime.sessionId = "sess-h2";
		const calls: unknown[] = [];
		const quote = "We don't need a CLI for the promoter.";
		const hitl = {
			hasUI: true,
			select: async (_t: string, options: string[]) => options.find((o) => o.startsWith("new:")) ?? options[0],
			confirm: async () => true,
			input: async () => undefined,
			notify: () => {},
		};
		const branch = [userMsg("u1", quote)];
		const first = await runBindFlow({
			pi: { appendEntry: () => {} },
			runtime,
			hitl,
			cwd: "/tmp/work",
			branch,
			suggestedName: "latch-app",
			promoterRun: async (input) => {
				calls.push(input);
				return { promote: [{ quote }], pending_replace: [] };
			},
		});
		expect(first.ok).toBe(true);
		expect(calls).toHaveLength(1);
		const latched = foldSession(
			[
				...branch,
				{ type: "custom", id: "b", customType: "ctx.bind", data: { project_id: "latch-app" } },
				{ type: "custom", id: "l", customType: "ctx.promoter.latch", data: { latched: true } },
			],
			"sess-h2",
		);
		expect(latched.promoterLatched).toBe(true);
	});

	it("parsePromoterResult ignores junk", () => {
		expect(parsePromoterResult({ promote: [{ quote: "x" }], pending_replace: "nope" })).toEqual({
			promote: [{ quote: "x" }],
			pending_replace: [],
			shelf: [],
		});
	});

	it("resolvePromoterModel forces xhigh", () => {
		expect(resolvePromoterModel({ ...DEFAULTS, models: {} }, { getModel: () => ({ provider: "xai", id: "grok-4.6" }) }).thinking).toBe(
			"xhigh",
		);
		expect(
			resolvePromoterModel({
				...DEFAULTS,
				models: { promoter: { provider: "xai", id: "grok-4.6", thinking: "low" } },
			}).thinking,
		).toBe("xhigh");
		expect(
			resolvePromoterModel({
				...DEFAULTS,
				models: { promoter: { provider: "xai", id: "grok-4.6", thinking: "high" } },
			}).thinking,
		).toBe("high");
	});

	it("skips quotes over 280 chars", () => {
		createProject("p280", "p280");
		const quote = `Never ${"x".repeat(280)} dump.`;
		const report = applyPromoterResult({
			projectId: "p280",
			sessionId: "sess",
			occupancy: "gated-edge",
			siblingKnob: 0,
			claimedId: null,
			existing: [],
			corpus: [quote],
			result: { promote: [{ quote }], pending_replace: [] },
		});
		expect(report.promoted).toHaveLength(0);
		expect(report.skipped.some((s) => s.includes("280"))).toBe(true);
	});

	it("promoter-worker cannot mint judgments", () => {
		const src = readFileSync(PROMOTER_EXTENSION_PATH, "utf-8");
		expect(src).toMatch(/submit_harvest/);
		expect(src).not.toMatch(/putJudgment|executeRecord|appendProjectRecord/);
		expect(src).not.toMatch(/session_before_compact/);
	});

	it("pending-replace HITL supersede mints constraint and closes pending", async () => {
		createProject("p-hitl", "p-hitl");
		const live = constraint("c1", "confirm per candidate", "all");
		live.headline = "confirm-only promotion pass";
		live.directive = live.body;
		const quote = "Bind is consent to promote what should clearly be promoted";
		const applied = applyPromoterResult({
			projectId: "p-hitl",
			sessionId: "sess",
			occupancy: "gated-edge",
			siblingKnob: 0,
			claimedId: null,
			existing: [live],
			corpus: [quote],
			result: { promote: [], pending_replace: [{ quote, live_id: "c1" }] },
		});
		expect(applied.pending).toHaveLength(1);
		const out = await runPendingReplaceHitl({
			hitl: {
				hasUI: true,
				select: async () => SUPERSEDE,
				confirm: async () => false,
				input: async () => undefined,
				notify: () => {},
			},
			projectId: "p-hitl",
			sessionId: "sess",
			occupancy: "gated-edge",
			siblingKnob: 0,
			claimedId: null,
			existing: applied.existing,
		});
		expect(out.report.superseded).toBe(1);
		const folded = foldLive(out.existing);
		expect(folded.pendingReplaces.filter((p) => folded.live.has(p.id))).toHaveLength(0);
		expect(folded.constraints.some((c) => folded.live.has(c.id) && c.body === quote)).toBe(true);
		expect(folded.live.has("c1")).toBe(false);
	});

	it("pending-replace HITL keep closes pending and leaves live law", async () => {
		createProject("p-keep", "p-keep");
		const live = constraint("c1", "never dump the buffer", "all");
		live.headline = "never dump";
		live.directive = live.body;
		const quote = "Bind is consent to promote what should clearly be promoted";
		const applied = applyPromoterResult({
			projectId: "p-keep",
			sessionId: "sess",
			occupancy: "gated-edge",
			siblingKnob: 0,
			claimedId: null,
			existing: [live],
			corpus: [quote],
			result: { promote: [], pending_replace: [{ quote, live_id: "c1" }] },
		});
		const out = await runPendingReplaceHitl({
			hitl: {
				hasUI: true,
				select: async () => KEEP,
				confirm: async () => false,
				input: async () => undefined,
				notify: () => {},
			},
			projectId: "p-keep",
			sessionId: "sess",
			occupancy: "gated-edge",
			siblingKnob: 0,
			claimedId: null,
			existing: applied.existing,
		});
		expect(out.report.kept).toBe(1);
		const folded = foldLive(out.existing);
		expect(folded.live.has("c1")).toBe(true);
		expect(folded.pendingReplaces.filter((p) => folded.live.has(p.id))).toHaveLength(0);
	});

	it("inject includes pending-replace slot", () => {
		const live = constraint("c1", "old law", "all");
		live.headline = "old law";
		live.directive = live.body;
		const pending = {
			id: "pr1",
			type: "pending_replace" as const,
			ts: "2026-09-14T10:00:00.000Z",
			session: "s",
			headline: "Replace: old law",
			body: "Bind is consent to promote what should clearly be promoted",
			parent: "c1",
		};
		const packed = renderInject({
			session: {
				enabled: true,
				bound: true,
				projectId: "p",
				claimedId: null,
				occupancy: "gated-edge",
				observations: [],
				recency: [],
				grantId: null,
				grantQuestionId: null,
			},
			branch: [],
			firstKeptId: "u1",
			config: DEFAULTS,
			projectRecords: [live, pending],
		});
		expect(packed.text).toContain("Pending replace");
		expect(packed.text).toContain("Bind is consent");
	});

	it("bind result JSON carries the harvest receipt: promoted headlines, pending, skipped", async () => {
		const runtime = new Runtime();
		runtime.sessionId = "sess-receipt";
		const quote = "Names are Session inject and Project law.";
		const result = await runBindFlow({
			pi: { appendEntry: () => {} },
			runtime,
			hitl: {
				hasUI: true,
				select: async (_t, options) => options.find((o) => o.startsWith("new:")) ?? options[0],
				confirm: async () => true,
				input: async () => undefined,
				notify: () => {},
			},
			cwd: "/tmp/work",
			branch: [userMsg("u1", quote)],
			suggestedName: "receipt-app",
			promoterRun: async () => ({
				promote: [{ quote }, { quote: "Not in the transcript at all." }],
				pending_replace: [],
			}),
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.harvest?.promoted).toEqual([quote]);
		expect(result.harvest?.pending).toBe(0);
		expect(result.harvest?.skipped).toBe(1);
		expect(result.harvest?.note).toBeUndefined();
	});

	it("bind result JSON counts a pending_replace left open after HITL defer", async () => {
		createProject("p-receipt", "p-receipt");
		const liveRec = constraint("c1", "confirm per candidate on bind", "all");
		liveRec.headline = "confirm-only promotion pass";
		liveRec.directive = liveRec.body;
		appendProjectRecord("p-receipt", "sess-a", liveRec, home);
		const runtime = new Runtime();
		runtime.sessionId = "sess-receipt2";
		const quote = "Bind is consent to promote what should clearly be promoted";
		const result = await runBindFlow({
			pi: { appendEntry: () => {} },
			runtime,
			hitl: {
				hasUI: true,
				select: async (_t, options) => options.find((o) => o.startsWith("existing:")) ?? undefined,
				confirm: async () => true,
				input: async () => undefined,
				notify: () => {},
			},
			cwd: "/tmp/work",
			branch: [userMsg("u1", quote)],
			suggestedName: "p-receipt",
			promoterRun: async () => ({
				promote: [],
				pending_replace: [{ quote, live_id: "c1" }],
			}),
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.harvest?.promoted).toEqual([]);
		expect(result.harvest?.pending).toBe(1);
		expect(result.harvest?.skipped).toBe(0);
	});

	it("reopens pending-replace HITL after 3 settled parent turns, not tool rounds", async () => {
		createProject("p-turns", "p-turns");
		const live = constraint("c1", "never dump the buffer", "all");
		live.headline = "never dump";
		live.directive = live.body;
		appendProjectRecord("p-turns", "seed", live);
		const quote = "Bind is consent to promote what should clearly be promoted";
		applyPromoterResult({
			projectId: "p-turns",
			sessionId: "sess",
			occupancy: "gated-edge",
			siblingKnob: 0,
			claimedId: null,
			existing: [live],
			corpus: [quote],
			result: { promote: [], pending_replace: [{ quote, live_id: "c1" }] },
		});
		const runtime = new Runtime();
		runtime.bound = true;
		runtime.projectId = "p-turns";
		runtime.sessionId = "sess";
		const branch: { type: string; id: string; customType?: string; data?: unknown; message?: { role?: string; stopReason?: string } }[] = [];
		const counts: number[] = [];
		const pi = {
			appendEntry: (_customType: string, data?: unknown) => {
				const n = (data as { n?: number } | undefined)?.n;
				if (typeof n === "number") counts.push(n);
				branch.push({ type: "custom", id: `c${branch.length}`, customType: _customType, data });
			},
		};
		let selects = 0;
		let resolveSelect: (value: string) => void = () => {};
		const ctx = {
			hasUI: true,
			ui: {
				select: async () => {
					selects += 1;
					return new Promise<string>((resolve) => {
						resolveSelect = resolve;
					});
				},
				confirm: async () => false,
				input: async () => undefined,
				notify: () => {},
			},
			sessionManager: { getBranch: () => branch, getSessionId: () => "sess" },
		};
		const gate = { inFlight: false };
		const settle = (event?: unknown) =>
			onPendingReplaceSettled(pi as never, runtime, ctx, gate, event);

		await settle();
		await settle();
		expect(selects).toBe(0);
		expect(counts).toEqual([1, 2]);

		const third = settle();
		expect(selects).toBe(1);
		expect(gate.inFlight).toBe(true);
		await settle();
		expect(selects).toBe(1);
		expect(counts).toEqual([1, 2, 3]);

		resolveSelect(DEFER_ONE);
		await third;
		expect(counts.at(-1)).toBe(0);
		expect(gate.inFlight).toBe(false);
		const append = pi.appendEntry.bind(pi);
		pi.appendEntry = () => {
			throw new Error("This extension ctx is stale");
		};
		await expect(settle()).resolves.toBeUndefined();
		expect(gate.inFlight).toBe(false);
		pi.appendEntry = append;
		const folded = foldLive(loadProjectRecords("p-turns"));
		expect(folded.pendingReplaces.filter((p) => folded.live.has(p.id))).toHaveLength(1);
		expect(folded.live.has("c1")).toBe(true);

		await settle({ toolResults: [{}], message: { stopReason: "tool_use" } });
		await settle({ outcome: "completed", continue: true });
		branch.push({ type: "message", id: "err", message: { role: "assistant", stopReason: "error" } });
		await settle();
		expect(selects).toBe(1);
		expect(counts.filter((n) => n !== 0)).toEqual([1, 2, 3]);

		branch.pop();
		let hitZero = false;
		pi.appendEntry = (customType: string, data?: unknown) => {
			const n = (data as { n?: number } | undefined)?.n;
			if (n === 0) {
				hitZero = true;
				throw new Error("This extension ctx is stale");
			}
			append(customType, data);
		};
		await settle();
		await settle();
		const again = settle();
		expect(selects).toBe(2);
		resolveSelect(DEFER_ONE);
		await expect(again).resolves.toBeUndefined();
		expect(hitZero).toBe(true);
		expect(gate.inFlight).toBe(false);
	});

	it("does not count a tool round as a parent turn", () => {
		expect(isCompletedParentTurn(undefined)).toBe(true);
		expect(isCompletedParentTurn({ type: "agent_settled" } as never)).toBe(true);
		expect(isCompletedParentTurn({ toolResults: [{ id: "t" }] })).toBe(false);
		expect(isCompletedParentTurn({ message: { stopReason: "tool_calls" } })).toBe(false);
		expect(isCompletedParentTurn({ outcome: "error" })).toBe(false);
		expect(isCompletedParentTurn({ continue: true })).toBe(false);
	});

	it("registers the reopen counter on agent_settled", () => {
		const events: string[] = [];
		registerPendingReplaceHook({ on: (event: string) => events.push(event) } as never, new Runtime());
		expect(events).toEqual(["agent_settled"]);
	});

	it("records shelf items from the right source and does not mint them as constraints", () => {
		createProject("p-shelf", "p-shelf");
		const dest = "Ship the bind harvest without making questions into law.";
		const finding = "The observer failed because the prompt contained a null byte.";
		const report = applyPromoterResult({
			projectId: "p-shelf",
			sessionId: "sess",
			occupancy: "gated-edge",
			siblingKnob: 0,
			claimedId: null,
			existing: [],
			corpus: [dest],
			assistant: [finding],
			result: {
				promote: [{ quote: finding }],
				pending_replace: [],
				shelf: [
					{ type: "destination", quote: dest, headline: "Ship the harvest" },
					{ type: "destination", quote: dest, headline: "Second destination" },
					{ type: "question", quote: finding, headline: "Why it failed" },
					{ type: "finding", quote: finding, headline: "Null byte" },
					{ type: "finding", quote: "The model invented this.", headline: "Invented" },
				],
			},
		});
		expect(report.promoted).toHaveLength(0);
		expect(report.shelf.map((r) => r.type)).toEqual(["destination", "finding"]);
		expect(report.shelf[0].body).toBe(dest);
		expect(report.shelf[0].headline).toBe("Ship the harvest");
		expect(report.shelf[0].rationale).toBe("source: user");
		expect(report.shelf[1].rationale).toBe("source: assistant");
		expect(report.shelf.every((r) => r.type !== "constraint")).toBe(true);
		expect(report.skipped).toEqual(
			expect.arrayContaining(["promote not verbatim", "shelf destination exists", "shelf not user verbatim", "shelf not verbatim"]),
		);
		const text = receiptText({
			projectName: "p-shelf",
			promoted: [],
			pending: [],
			shelf: report.shelf,
			skipped: report.skipped,
		});
		expect(text).toContain('destination "Ship the harvest"');
		expect(text).toContain('finding "Null byte"');
		expect(text).toContain("cap 10");
		expect(text).toContain("Fog text, decisions, and findings are not injected.");
	});

	it("names an empty promoter result and not a filtered one", () => {
		const empty = receiptText({
			projectName: "p",
			promoted: [],
			pending: [],
			shelf: [],
			skipped: [],
			returnedNothing: true,
		});
		expect(empty).toContain("Promoted none.");
		expect(empty).toContain("Promoter returned nothing.");
		const quiet = receiptText({
			projectName: "p",
			promoted: [],
			pending: [],
			shelf: [],
			skipped: [],
		});
		expect(quiet).not.toContain("Promoter returned nothing.");
		const filtered = receiptText({
			projectName: "p",
			promoted: [],
			pending: [],
			shelf: [],
			skipped: ["shelf destination exists"],
		});
		expect(filtered).toContain("Skipped 1.");
		expect(filtered).not.toContain("Promoter returned nothing.");
	});
	it("keeps the harvest shape the live shelf check recorded", () => {
		createProject("p-live-shape", "p-live-shape");
		const rule = "Never store a shelf record as a constraint.";
		const dest = "The destination is to see shelf records written at bind.";
		const oos = "Rewriting the observer is out of scope.";
		const question = "Does the receipt name the finding?";
		const fog = "It is unclear whether the headline will be shortened.";
		const capQ = "Should we never mention the cap in the receipt? For now, skip evidence.";
		const decision = "The shelf cap is ten records in total.";
		const finding = "An assistant reply can be stored as a finding.";
		const afog = "I am unsure whether a second destination is skipped.";
		const parsed = parsePromoterResult({
			promote: [{ quote: rule, headline: "Shelf records are not constraints" }],
			pending_replace: [],
			shelf: [
				{ type: "destination", quote: dest, headline: "Shelf records written at bind" },
				{ type: "out_of_scope", quote: oos, headline: "Rewriting the observer" },
				{ type: "question", quote: question, headline: "Receipt names the finding" },
				{ type: "question", quote: capQ, headline: "Cap mentioned in the receipt" },
				{ type: "fog", quote: fog, headline: "Headline shortening unclear" },
				{ type: "decision", quote: decision, headline: "Shelf cap is ten total" },
				{ type: "finding", quote: finding, headline: "Assistant reply as a finding" },
				{ type: "fog", quote: afog, headline: "Second destination unsure" },
				{ type: "evidence", quote: capQ, headline: "Evidence" },
				{ type: "constraint", quote: rule, headline: "Shelf as constraint" },
			],
		});
		expect(parsed.shelf?.some((item) => item.type === "evidence" || (item.type as string) === "constraint")).toBe(false);
		const report = applyPromoterResult({
			projectId: "p-live-shape",
			sessionId: "sess",
			occupancy: "gated-edge",
			siblingKnob: 0,
			claimedId: null,
			existing: [],
			corpus: [[rule, dest, oos, question, fog, capQ].join("\n\n")],
			assistant: [[decision, finding, afog].join("\n")],
			result: parsed,
		});
		expect(report.promoted.map((r) => r.body)).toEqual([rule]);
		expect(report.shelf.map((r) => `${r.type}:${r.rationale}`)).toEqual([
			"destination:source: user",
			"out_of_scope:source: user",
			"question:source: user",
			"question:source: user",
			"fog:source: user",
			"decision:source: assistant",
			"finding:source: assistant",
			"fog:source: assistant",
		]);
		expect(report.existing.filter((r) => r.type === "constraint")).toHaveLength(1);
		expect(report.existing.some((r) => r.type === "constraint" && /cap/i.test(r.body))).toBe(false);
		expect(report.existing.some((r) => r.type === "evidence")).toBe(false);
		const text = receiptText({
			projectName: "p-live-shape",
			promoted: report.promoted,
			pending: [],
			shelf: report.shelf,
			skipped: report.skipped,
		});
		expect(text).toContain('finding "Assistant reply as a finding"');
		expect(text).toContain("cap 10");
	});

	it("rejects an invented constraint and a second destination while the conflict stays pending", () => {
		createProject("p-conflict-filters", "p-conflict-filters");
		const law = constraint("cap-visible", "Always keep the shelf cap visible in the receipt.", "all");
		law.headline = "Shelf cap stays visible";
		law.directive = law.body;
		const dest = {
			id: "dest-happy",
			type: "destination" as const,
			ts: "2026-09-14T10:00:01.000Z",
			session: "seed",
			headline: "Happy-path harvest",
			body: "The destination is the happy-path harvest.",
			rationale: "source: user",
		};
		const quote = "Never mention the shelf cap in the receipt.";
		const second = "The destination is to hide the receipt cap.";
		const invented = "Shelf records must be stored as constraints.";
		const report = applyPromoterResult({
			projectId: "p-conflict-filters",
			sessionId: "sess",
			occupancy: "gated-edge",
			siblingKnob: 0,
			claimedId: null,
			existing: [law, dest],
			corpus: [[quote, second, "Line 1, a house rule you invent."].join("\n\n")],
			assistant: ["Shelf records have to be kept in the form of constraints."],
			result: {
				promote: [{ quote: invented }],
				pending_replace: [{ quote, live_id: "cap-visible" }],
				shelf: [{ type: "destination", quote: second, headline: "Hide the cap" }],
			},
		});
		expect(report.promoted).toHaveLength(0);
		expect(report.skipped).toEqual(expect.arrayContaining(["promote not verbatim", "shelf destination exists"]));
		expect(report.pending).toHaveLength(1);
		expect(report.pending[0]?.parent).toBe("cap-visible");
		expect(report.pending[0]?.body).toBe(quote);
		const folded = foldLive(report.existing);
		expect(folded.constraints.map((c) => c.id)).toEqual(["cap-visible"]);
		expect(folded.destinations.map((d) => d.id)).toEqual(["dest-happy"]);
	});
	it("keeps assistant shelf text to user-facing replies", () => {
		const mixed = {
			type: "message" as const,
			id: "a",
			parentId: null,
			timestamp: "t",
			message: {
				role: "assistant" as const,
				content: [
					{ type: "thinking", text: "hidden plan" },
					{ type: "text", text: "Visible reply." },
				],
			},
		};
		expect(extractAssistantQuotes([mixed, assistantMsg("b", "Second reply."), userMsg("u", "user line")])).toEqual([
			"Visible reply.",
			"Second reply.",
		]);
	});

	it("drops shelf types outside the six", () => {
		expect(
			parsePromoterResult({
				shelf: [
					{ type: "constraint", quote: "Never x" },
					{ type: "evidence", quote: "file" },
					{ type: "fog", quote: "Unclear whether the cap is per type." },
				],
			}).shelf,
		).toEqual([{ type: "fog", quote: "Unclear whether the cap is per type." }]);
	});

	it("caps the shelf at 10", () => {
		createProject("p-cap", "p-cap");
		const lines = Array.from({ length: 11 }, (_, i) => `Finding number ${i} stands.`);
		const report = applyPromoterResult({
			projectId: "p-cap",
			sessionId: "sess",
			occupancy: "gated-edge",
			siblingKnob: 0,
			claimedId: null,
			existing: [],
			corpus: [],
			assistant: [lines.join(" ")],
			result: {
				promote: [],
				pending_replace: [],
				shelf: lines.map((quote, i) => ({ type: "finding" as const, quote, headline: `F${i}` })),
			},
		});
		expect(report.shelf).toHaveLength(10);
	});
});

