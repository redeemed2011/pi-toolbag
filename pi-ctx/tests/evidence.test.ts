import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { foldLive } from "../src/fold.js";
import { putJudgment } from "../src/mint.js";
import { readEvidenceFile, sha256Hex, storeBlob } from "../src/store/blobs.js";
import { lineToJudgment } from "../src/store/jsonl.js";
import { blobPath, writerLogPath } from "../src/store/paths.js";
import { appendProjectRecord, loadProjectRecords } from "../src/store/project.js";
import { defaultRetrieve, lookupRecord } from "../src/tools/get.js";
import type { JudgmentRecord } from "../src/types.js";
import { constraint, question } from "./fixtures.js";

const HASH = "ab".repeat(32);
const NOW = Date.parse("2026-01-01T00:00:00.000Z");

const base = {
	occupancy: "gated-edge" as const,
	siblingKnob: 0 as const,
	claimedId: null as string | null,
};

function evidenceInput(id: string, expires_at = "2099-01-01T00:00:00.000Z") {
	return {
		type: "evidence" as const,
		id,
		headline: "lab note",
		producer: "meter",
		expires_at,
		blob_hash: HASH,
		byte_size: 4,
		session: "s",
	};
}

describe("evidence", () => {
	it("refuses evidence missing producer, expiry, hash, or size, and does not default applies_to", () => {
		const input = evidenceInput("e1");
		const missingProducer = putJudgment({
			...base,
			existing: [],
			input: { ...input, producer: "  " },
		});
		expect(missingProducer.ok).toBe(false);
		if (!missingProducer.ok) expect(missingProducer.error).toBe("producer required");

		const missingExpiry = putJudgment({
			...base,
			existing: [],
			input: { ...input, expires_at: "tomorrow" },
		});
		expect(missingExpiry.ok).toBe(false);
		if (!missingExpiry.ok) expect(missingExpiry.error).toBe("expires_at required");

		const missingHash = putJudgment({
			...base,
			existing: [],
			input: { ...input, blob_hash: "abc" },
		});
		expect(missingHash.ok).toBe(false);
		if (!missingHash.ok) expect(missingHash.error).toBe("blob_hash required");

		const missingSize = putJudgment({
			...base,
			existing: [],
			input: { ...input, byte_size: 1.5 },
		});
		expect(missingSize.ok).toBe(false);
		if (!missingSize.ok) expect(missingSize.error).toBe("byte_size required");

		const ok = putJudgment({ ...base, existing: [], input });
		expect(ok.ok).toBe(true);
		if (ok.ok) {
			expect(ok.record.applies_to).toBeUndefined();
			expect(ok.record.blob_hash).toBe(HASH);
			expect(JSON.stringify(ok.line)).not.toContain("blob bytes");
		}
	});

	it("refuses to supersede or block, so the file write cannot retire a rule", () => {
		const kept = constraint("c1", "keep the rule");
		const sup = putJudgment({
			...base,
			existing: [kept],
			input: { ...evidenceInput("e1"), supersedes: "c1", reason_class: "decision_change" },
		});
		expect(sup.ok).toBe(false);
		if (!sup.ok) expect(sup.error).toBe("evidence cannot supersede");
		expect(foldLive([kept]).live.has("c1")).toBe(true);

		const blocked = putJudgment({
			...base,
			existing: [question("q1", "work")],
			input: { ...evidenceInput("e2"), blocks: ["q1"] },
		});
		expect(blocked.ok).toBe(false);
		if (!blocked.ok) expect(blocked.error).toBe("evidence cannot block");
	});

	it("does not count toward the gate and is not a live-headline conflict", () => {
		const existing = [
			question("q1", "do the thing"),
			...Array.from({ length: 20 }, (_, i) => constraint(`c${i}`, "x")),
		];
		const first = putJudgment({ ...base, existing, input: evidenceInput("e1") });
		expect(first.ok).toBe(true);
		if (!first.ok) return;
		const second = putJudgment({
			...base,
			existing: [...existing, first.record],
			input: evidenceInput("e2"),
		});
		expect(second.ok).toBe(true);
		const live = foldLive([...(first.ok ? [first.record] : []), ...(second.ok ? [second.record] : [])]);
		expect(live.constraints).toEqual([]);
		const ge = defaultRetrieve({
			bound: true,
			occupancy: "gated-edge",
			claimedId: null,
			live: foldLive([...existing, first.record]),
			recency: [],
		}) as { constraints: Array<{ id: string }> };
		expect(ge.constraints.map((c) => c.id)).not.toContain("e1");
		expect(ge.constraints).toHaveLength(20);
	});

	it("keeps a citing constraint live when the file is expired, and ignores a bare filename", () => {
		const expired = putJudgment({
			...base,
			existing: [],
			input: evidenceInput("e1", "2020-01-01T00:00:00.000Z"),
		});
		expect(expired.ok).toBe(true);
		if (!expired.ok) return;
		const rule = putJudgment({
			...base,
			existing: [expired.record],
			input: {
				type: "constraint",
				id: "c1",
				headline: "keep the rule",
				directive: "keep the rule",
				applies_to: "all",
				citation_target: "e1",
				session: "s",
			},
		});
		expect(rule.ok).toBe(true);
		if (!rule.ok) return;
		const live = foldLive([expired.record, rule.record]);
		expect(live.live.has("c1")).toBe(true);
		expect(live.constraints.map((c) => c.id)).toEqual(["c1"]);
		const support = lookupRecord("c1", live, [...live.byId.values()], [], NOW);
		expect(support.live).toBe(true);
		expect(support.support_expired).toBe(true);
		const file = lookupRecord("e1", live, [...live.byId.values()], [], NOW);
		expect(file.expired).toBe(true);
		expect(file.blob_hash).toBe(HASH);
		expect(JSON.stringify(file)).not.toContain("secret-bytes");

		const named = putJudgment({
			...base,
			existing: [],
			input: {
				type: "constraint",
				id: "c2",
				headline: "filename is not a copy",
				directive: "see notes.txt",
				applies_to: "all",
				citation_target: "notes.txt",
				session: "s",
			},
		});
		expect(named.ok).toBe(true);
		if (!named.ok) return;
		const namedLive = foldLive([named.record]);
		const view = lookupRecord("c2", namedLive, [named.record], [], NOW);
		expect(view.support_expired).toBeUndefined();
		expect(view.live).toBe(true);
	});

	it("stores the file once by hash and does not put the bytes on the log line", () => {
		const home = mkdtempSync(join(tmpdir(), "ctx-evidence-"));
		const src = join(home, "note.txt");
		const secret = "secret-bytes-not-in-log";
		writeFileSync(src, secret);
		const read = readEvidenceFile(src);
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		storeBlob("p", read.hash, read.bytes, home);
		storeBlob("p", read.hash, read.bytes, home);
		expect(readFileSync(blobPath("p", read.hash, home)).toString()).toBe(secret);

		const put = putJudgment({
			...base,
			existing: [],
			input: {
				type: "evidence",
				id: "e1",
				headline: "note",
				producer: "meter",
				expires_at: "2099-01-01T00:00:00.000Z",
				blob_hash: read.hash,
				byte_size: read.size,
				session: "s",
			},
		});
		expect(put.ok).toBe(true);
		if (!put.ok) return;
		appendProjectRecord("p", "s", put.line, home);
		const log = readFileSync(writerLogPath("p", "s", home), "utf-8");
		expect(log).not.toContain(secret);
		expect(log).toContain(read.hash);
		const loaded = loadProjectRecords("p", home);
		expect(loaded.map((r) => r.blob_hash)).toEqual([read.hash]);
		expect(loaded[0]?.byte_size).toBe(secret.length);

		appendProjectRecord(
			"p",
			"s2",
			{
				id: "bad",
				type: "evidence",
				ts: "1",
				session: "s2",
				headline: "missing meta",
				body: "missing meta",
			},
			home,
		);
		const again = loadProjectRecords("p", home);
		expect(again.map((r) => r.id)).toEqual(["e1"]);
		expect(lineToJudgment({ id: "bad", type: "evidence", ts: "1", session: "s2" })).toBeUndefined();
	});

	it("refuses a blob path whose bytes are not that hash, and a missing source file", () => {
		const home = mkdtempSync(join(tmpdir(), "ctx-evidence-"));
		const bytes = Buffer.from("real-bytes");
		const hash = sha256Hex(bytes);
		const dest = blobPath("p", hash, home);
		mkdirSync(join(home, "projects", "p", "blobs"), { recursive: true });
		writeFileSync(dest, Buffer.from("nope"));
		expect(() => storeBlob("p", hash, bytes, home)).toThrow(/blob_corrupt/);
		expect(readEvidenceFile(join(home, "missing")).ok).toBe(false);
		expect(readEvidenceFile(home).ok).toBe(false);
	});

	it("reports unexpired support as fresh", () => {
		const fresh = putJudgment({ ...base, existing: [], input: evidenceInput("e1") });
		expect(fresh.ok).toBe(true);
		if (!fresh.ok) return;
		const rule = putJudgment({
			...base,
			existing: [fresh.record],
			input: {
				type: "constraint",
				id: "c1",
				headline: "keep the rule",
				directive: "keep the rule",
				applies_to: "all",
				citation_target: "e1",
				session: "s",
			},
		});
		expect(rule.ok).toBe(true);
		if (!rule.ok) return;
		const live = foldLive([fresh.record, rule.record]);
		const support = lookupRecord("c1", live, [rule.record, fresh.record], [], NOW);
		expect(support.support_expired).toBe(false);
		expect(support.live).toBe(true);
		expect((fresh.record satisfies JudgmentRecord).type).toBe("evidence");
	});
});
