import { describe, expect, it } from "vitest";
import { foldLive } from "pi-ctx-lib";
import { executeGet } from "pi-ctx-lib";
import { executeZoom } from "pi-ctx-lib";
import { constraint, obs, question } from "./fixtures.js";

const FULL = "9851f9b8-0d1c-4a2e-9f3b-1234567890ab";
const records = [
	constraint(FULL, "the earlier design"),
	question("a0a1c135-1111-4111-8111-111111111111", "first twin"),
	question("a0a1c135-2222-4222-8222-222222222222", "second twin"),
];
const live = foldLive(records);
const observations = [obs("7c0ffee1-3333-4333-8333-333333333333", "seen", "e1")];
const base = { enabled: true, bound: true, occupancy: "gated-edge" as const, claimedId: null, live, records, observations, recency: [] };

describe("short record ids, as record text cites them", () => {
	it("ctx_zoom and ctx_get follow the first 8 characters to the one full record", () => {
		const zoomed = executeZoom({ id: "9851f9b8", enabled: true, live, records, observations });
		expect(zoomed.id).toBe(FULL);
		expect(zoomed.body).toBe("the earlier design");
		expect(executeGet({ ...base, id: "9851F9B8" }).id).toBe(FULL);
		expect(executeGet({ ...base, id: " 9851f9b8-0d1c " }).id).toBe(FULL);
		expect(executeZoom({ id: "7c0ffee1", enabled: true, live, records, observations }).type).toBe("observation");
	});

	it("a prefix two records share is ambiguous and names both, instead of guessing", () => {
		const got = executeZoom({ id: "a0a1c135", enabled: true, live, records, observations });
		expect(got.error).toBe("ambiguous");
		expect(got.candidates).toEqual(["a0a1c135-1111-4111-8111-111111111111", "a0a1c135-2222-4222-8222-222222222222"]);
	});

	it("a prefix shorter than 8 characters, a non-id, or an unknown prefix is still not found", () => {
		expect(executeZoom({ id: "9851f9b", enabled: true, live, records, observations }).error).toBe("not_found");
		expect(executeZoom({ id: "auto-update", enabled: true, live, records, observations }).error).toBe("not_found");
		expect(executeZoom({ id: "deadbeef", enabled: true, live, records, observations })).toEqual({ error: "not_found", id: "deadbeef" });
	});

	it("an exact id still wins even when it is also a prefix of another id", () => {
		const shortExact = question("abcdef12", "short exact");
		const longer = question("abcdef12-9999-4999-8999-999999999999", "longer");
		const both = [shortExact, longer];
		const got = executeZoom({ id: "abcdef12", enabled: true, live: foldLive(both), records: both, observations: [] });
		expect(got.id).toBe("abcdef12");
	});
});
