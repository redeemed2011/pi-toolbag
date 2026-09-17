import { describe, expect, it } from "vitest";
import { coverageCommit } from "../src/commit.js";
import { CTX_OBSERVATIONS_EMPTY_COVER, CTX_OBSERVATIONS_RECORDED } from "../src/types.js";
import { obs } from "./fixtures.js";

describe("observer watermark", () => {
	it("does not advance committed coverage on worker failure", () => {
		expect(
			coverageCommit({
				ok: false,
				observations: [obs("o1", "x", "u1")],
				coversUpToId: "u1",
			}),
		).toBeNull();
	});

	it("empty successful cover still advances via empty_cover", () => {
		const commit = coverageCommit({ ok: true, observations: [], coversUpToId: "u1", about_claim_id: "q1" });
		expect(commit?.customType).toBe(CTX_OBSERVATIONS_EMPTY_COVER);
		expect(commit?.data.coversUpToId).toBe("u1");
	});

	it("successful observations use recorded + dispatch stamp", () => {
		const commit = coverageCommit({
			ok: true,
			observations: [obs("o1", "x", "u1")],
			coversUpToId: "u1",
			about_claim_id: "q1",
		});
		expect(commit?.customType).toBe(CTX_OBSERVATIONS_RECORDED);
	});
});
