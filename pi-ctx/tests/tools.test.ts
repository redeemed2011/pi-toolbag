import { describe, expect, it } from "vitest";
import { foldLive } from "../src/fold.js";
import { Runtime } from "../src/runtime.js";
import { applyClaim } from "../src/tools/claim.js";
import { executeFrontier, FRONTIER_CAP } from "../src/tools/frontier.js";
import { defaultRetrieve, executeGet, RETRIEVE_HEADLINE_CAP } from "../src/tools/get.js";
import { registerTools } from "../src/tools/register.js";
import { dropKeys } from "../src/tools/result.js";
import { constraint, obs, question } from "./fixtures.js";

const live = foldLive([
	constraint("c-all", "never reopen packing", "all"),
	constraint("c-q2", "only for q2", ["q2"]),
	question("q1", "claimed work"),
	question("q2", "other work"),
]);

describe("get / zoom", () => {
	it("returns the body on get(id) and not_found for unknown", () => {
		const hit = executeGet({
			id: "c-all",
			enabled: true,
			bound: true,
			occupancy: "gated-edge",
			claimedId: "q1",
			live,
			records: [...live.byId.values()],
			observations: [],
			recency: [],
		}) as { body: string; live: boolean };
		expect(hit.body).toContain("never reopen packing");
		expect(hit.live).toBe(true);
		expect(
			executeGet({
				id: "missing",
				enabled: true,
				bound: true,
				occupancy: "gated-edge",
				claimedId: null,
				live,
				records: [],
				observations: [],
				recency: [],
			}),
		).toEqual({ error: "not_found", id: "missing" });
	});

	it("default retrieve is unbound recency + no project bound; GE dumps bodies; CS is an index", () => {
		const recency = [obs("o1", "did the thing", "u1")];
		const unbound = defaultRetrieve({
			bound: false,
			occupancy: "gated-edge",
			claimedId: null,
			live: foldLive([]),
			recency,
		}) as { message: string };
		expect(unbound.message).toBe("no project bound");

		const ge = defaultRetrieve({
			bound: true,
			occupancy: "gated-edge",
			claimedId: "q1",
			live,
			recency,
		}) as { occupancy: string; constraints: Array<{ id: string }> };
		expect(ge.occupancy).toBe("gated-edge");
		expect(ge.constraints.map((c) => c.id).sort()).toEqual(["c-all", "c-q2"]);

		const cs = defaultRetrieve({
			bound: true,
			occupancy: "claim-strip",
			claimedId: "q1",
			live,
			recency,
		}) as { law_index: Array<{ id: string }>; unapplied: number };
		expect(cs.law_index.map((c) => c.id).sort()).toEqual(["c-all", "c-q2"]);
		expect(cs.unapplied).toBe(1);
	});

	it("does not fold search-like keys into id", () => {
		const cleaned = dropKeys({ q: "foo", similar: "x", id: "c-all" }, ["q", "similar", "related", "search"]);
		expect(cleaned).toEqual({ id: "c-all" });
	});

	it("registers no ranking API", () => {
		const names: string[] = [];
		registerTools(
			{
				registerTool: (tool: { name: string }) => {
					names.push(tool.name);
				},
			} as never,
			new Runtime(),
		);
		expect(names).toEqual(["ctx_get", "ctx_zoom", "ctx_frontier", "ctx_claim", "ctx_bind", "ctx_record"]);
		expect(names).not.toContain("search_similar");
	});

	it("caps recency headlines", () => {
		const recency = Array.from({ length: 40 }, (_, i) => obs(`o${i}`, `h${i}`, "u"));
		const got = defaultRetrieve({
			bound: false,
			occupancy: "gated-edge",
			claimedId: null,
			live: foldLive([]),
			recency,
		}) as { recency: unknown[] };
		expect(got.recency).toHaveLength(RETRIEVE_HEADLINE_CAP);
	});
});

describe("frontier", () => {
	it("returns mint-time order, cap, and elided; refuses unbound", () => {
		expect(executeFrontier({ enabled: true, bound: false, claimedId: null, live })).toEqual({
			error: "no project bound",
		});
		const questions = Array.from({ length: 22 }, (_, i) =>
			question(`q${String(i).padStart(2, "0")}`, "q"),
		);
		const folded = foldLive(questions);
		const got = executeFrontier({
			enabled: true,
			bound: true,
			claimedId: "q00",
			live: folded,
		}) as { items: Array<{ id: string }>; elided: number; claim_empty: number };
		expect(got.items).toHaveLength(FRONTIER_CAP);
		expect(got.items[0]?.id).toBe("q01");
		expect(got.elided).toBe(1);
		expect(got.claim_empty).toBe(0);
	});
});

describe("claim tool", () => {
	it("sets when empty, no-ops same id, refuses silent swap, close does not pick", () => {
		const common = {
			enabled: true,
			bound: true,
			live,
			occupancy: "gated-edge" as const,
			siblingKnob: 0 as const,
		};
		const claimed = applyClaim({ ...common, action: "claim", question_id: "q1", claimedId: null });
		expect(claimed).toMatchObject({ ok: true, claimed_id: "q1" });
		expect(
			applyClaim({ ...common, action: "claim", question_id: "q1", claimedId: "q1" }),
		).toMatchObject({ ok: true, noop: true });
		expect(
			applyClaim({ ...common, action: "claim", question_id: "q2", claimedId: "q1" }),
		).toEqual({ ok: false, error: "close first or user /ctx claim" });
		expect(applyClaim({ ...common, action: "close", claimedId: "q1" })).toEqual({
			ok: true,
			claimed_id: null,
			claim_empty: 1,
		});
	});

	it("refuses when ctx is off or unbound", () => {
		expect(
			applyClaim({
				action: "status",
				enabled: false,
				bound: true,
				claimedId: null,
				live,
				occupancy: "gated-edge",
				siblingKnob: 0,
			}),
		).toEqual({ ok: false, error: "ctx is off" });
		expect(
			applyClaim({
				action: "claim",
				question_id: "q1",
				enabled: true,
				bound: false,
				claimedId: null,
				live,
				occupancy: "gated-edge",
				siblingKnob: 0,
			}),
		).toEqual({ ok: false, error: "no project bound" });
	});
});
