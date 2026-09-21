import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBindFlow } from "../src/commands/bind.js";
import { DEFAULTS, resolvePromoterModel } from "../src/config.js";
import { foldLive, foldSession } from "../src/fold.js";
import { applyPromoterResult } from "../src/promoter/apply.js";
import { pendingReplaceSection } from "../src/promoter/inject.js";
import { extractUserQuotes, quoteInCorpus } from "../src/promoter/quotes.js";
import { promoterKickoffPrompt } from "../src/promoter/io.js";
import { PROMOTER_EXTENSION_PATH } from "../src/promoter/run.js";
import { KEEP, SUPERSEDE, runPendingReplaceHitl } from "../src/promoter/hitl.js";
import { parsePromoterResult } from "../src/promoter/schema.js";
import { renderInject } from "../src/render/inject.js";
import { Runtime } from "../src/runtime.js";
import { appendProjectRecord, createProject, loadProjectRecords } from "../src/store/project.js";
import { constraint, userMsg } from "./fixtures.js";
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

});

