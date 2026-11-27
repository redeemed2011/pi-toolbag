import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	OPERATOR,
	agentAuthor,
	appendProjectRecord,
	authorOf,
	byAgent,
	configureAuthorDisplay,
	configureStore,
	createProject,
	ctxHome,
	executeFrontier,
	executeGet,
	executeZoom,
	foldLive,
	followClaim,
	loadProjectRecords,
	putJudgment,
	renderClaimStrip,
	renderGatedEdge,
	renameProject,
	resetStoreConfig,
	resolveProjectId,
	writerDevice,
	writerLogPath,
	type JudgmentRecord,
	type SessionFold,
} from "../src/index.js";

const EMPTY_SESSION: SessionFold = {
	enabled: true,
	bound: true,
	projectId: "demo",
	claimedId: null,
	occupancy: "gated-edge",
	observations: [],
	recency: [],
	grantId: null,
	grantQuestionId: null,
};

const dirs: string[] = [];
function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-ctx-lib-test-"));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	resetStoreConfig();
	configureAuthorDisplay(false);
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("pi-ctx-lib shared kernel", () => {
	it("configures store home and writer file naming and resets cleanly", () => {
		const home = tempDir();
		const prevCtx = process.env.CTX_HOME;
		const prevPiCtx = process.env.PI_CTX_HOME;
		delete process.env.CTX_HOME;
		delete process.env.PI_CTX_HOME;
		try {
			configureStore({
				defaultHome: () => home,
				writerFile: (sessionId) => `${writerDevice()}-${sessionId}.jsonl`,
			});
			expect(ctxHome()).toBe(home);
			expect(writerLogPath("demo", "s1")).toBe(join(home, "projects", "demo", "logs", `${writerDevice()}-s1.jsonl`));
			resetStoreConfig();
			expect(writerLogPath("demo", "s1", home)).toBe(join(home, "projects", "demo", "logs", "s1.jsonl"));
		} finally {
			if (prevCtx !== undefined) process.env.CTX_HOME = prevCtx;
			if (prevPiCtx !== undefined) process.env.PI_CTX_HOME = prevPiCtx;
		}
	});

	it("preserves monotonic timestamps and author through JSONL persistence", () => {
		const home = tempDir();
		createProject("Demo", "demo", home);
		const author = agentAuthor("Master One", "m1");
		const first = putJudgment({
			occupancy: "gated-edge",
			siblingKnob: 2,
			claimedId: null,
			existing: [],
			input: { type: "question", headline: "First", body: "one", session: "m1", author },
		});
		expect(first.ok).toBe(true);
		if (!first.ok) return;
		const second = putJudgment({
			occupancy: "gated-edge",
			siblingKnob: 2,
			claimedId: null,
			existing: [first.record],
			input: { type: "question", headline: "Second", body: "two", session: "m1", author },
		});
		expect(second.ok).toBe(true);
		if (!second.ok) return;
		expect(second.record.ts > first.record.ts).toBe(true);
		appendProjectRecord("demo", "m1", first.line, home);
		appendProjectRecord("demo", "m1", second.line, home);
		const loaded = loadProjectRecords("demo", home);
		expect(loaded).toHaveLength(2);
		expect(loaded[0].author).toBe(author);
		expect(authorOf(loaded[0])).toBe(author);
		expect(byAgent(loaded[0])).toBe(true);
		expect(authorOf({ session: "operator-web" })).toBe(OPERATOR);
		expect(byAgent({ session: "operator-web" })).toBe(false);
	});

	it("follows superseded claims only when a single live question succeeds", () => {
		const q1: JudgmentRecord = {
			id: "q1",
			type: "question",
			ts: "2026-01-01T00:00:00.000Z",
			session: "s1",
			headline: "Old",
			body: "old",
		};
		const q2: JudgmentRecord = {
			id: "q2",
			type: "question",
			ts: "2026-01-01T00:00:01.000Z",
			session: "s1",
			headline: "New",
			body: "new",
			supersedes: ["q1"],
		};
		const live = foldLive([q1, q2]);
		expect(followClaim(live, "q1")).toBe("q2");
		const dec: JudgmentRecord = {
			id: "d1",
			type: "decision",
			ts: "2026-01-01T00:00:02.000Z",
			session: "s1",
			headline: "Settled",
			body: "done",
			supersedes: ["q2"],
		};
		expect(followClaim(foldLive([q1, q2, dec]), "q1")).toBe(null);
	});

	it("renders author attribution only when enabled", () => {
		const c: JudgmentRecord = {
			id: "c1",
			type: "constraint",
			ts: "2026-01-01T00:00:00.000Z",
			session: "operator-1",
			headline: "No fakes",
			directive: "Use real paths.",
			body: "Use real paths.",
			applies_to: "all",
			author: OPERATOR,
		};
		const live = foldLive([c]);
		const withoutAuthor = renderGatedEdge({
			live,
			session: EMPTY_SESSION,
			firstKeptId: "e1",
			branch: [],
			siblingKnob: 2,
			observations: [],
		});
		expect(withoutAuthor.text).toContain("### No fakes (c1)");
		expect(withoutAuthor.text).not.toContain("by operator");

		configureAuthorDisplay(true);
		const withAuthorGe = renderGatedEdge({
			live,
			session: EMPTY_SESSION,
			firstKeptId: "e1",
			branch: [],
			siblingKnob: 2,
			observations: [],
		});
		expect(withAuthorGe.text).toContain("### No fakes (c1, by operator)");

		const withAuthorCs = renderClaimStrip({
			live,
			session: { ...EMPTY_SESSION, occupancy: "claim-strip" },
			firstKeptId: "e1",
			branch: [],
			observations: [],
		});
		expect(withAuthorCs.text).toContain("### No fakes (c1, by operator)");

		const zoomed = executeZoom({ id: "c1", enabled: true, live, records: [c], observations: [] });
		expect(zoomed.author).toBe(OPERATOR);
		const got = executeGet({
			enabled: true,
			bound: true,
			occupancy: "gated-edge",
			claimedId: null,
			live,
			records: [c],
			observations: [],
			recency: [],
		});
		expect((got.constraints as Array<{ author?: string }>)[0]?.author).toBe(OPERATOR);
	});

	it("supports frontier pagination, type filtering, and project aliases", () => {
		const home = tempDir();
		createProject("Old Name", "old-name", home);
		const renamed = renameProject("old-name", "New Name", home);
		expect(renamed.ok).toBe(true);
		expect(resolveProjectId("old-name", home)).toBe("new-name");

		const recs: JudgmentRecord[] = [];
		for (let i = 0; i < 25; i++) {
			recs.push({
				id: `q-${String(i).padStart(2, "0")}`,
				type: "question",
				ts: `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
				session: "s1",
				headline: `Question ${i}`,
				body: `Body ${i}`,
			});
		}
		recs.push({
			id: "d-01",
			type: "decision",
			ts: "2026-01-01T00:01:00.000Z",
			session: "s1",
			headline: "A decision",
			body: "Decided",
		});
		const live = foldLive(recs);
		const page1 = executeFrontier({ enabled: true, bound: true, claimedId: null, live });
		expect(page1.total).toBe(25);
		expect(page1.elided).toBe(5);
		expect(page1.next_offset).toBe(20);
		const page2 = executeFrontier({ enabled: true, bound: true, claimedId: null, live, offset: 20 });
		expect((page2.items as unknown[]).length).toBe(5);
		expect(page2.elided).toBe(0);
		const decisions = executeFrontier({ enabled: true, bound: true, claimedId: null, live, type: "decision" });
		expect(decisions.type).toBe("decision");
		expect((decisions.items as Array<{ id: string }>).map((x) => x.id)).toEqual(["d-01"]);
	});
});
