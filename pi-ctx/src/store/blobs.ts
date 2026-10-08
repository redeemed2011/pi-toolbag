import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { BLOB_HASH_RE } from "../evidence.js";
import { blobPath, projectBlobsDir } from "./paths.js";

export function sha256Hex(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

export function readEvidenceFile(
	sourcePath: string,
): { ok: true; bytes: Buffer; hash: string; size: number } | { ok: false; error: string } {
	let st;
	try {
		st = statSync(sourcePath);
	} catch {
		return { ok: false, error: "source_path not_found" };
	}
	if (!st.isFile()) return { ok: false, error: "source_path not a file" };
	const bytes = readFileSync(sourcePath);
	return { ok: true, bytes, hash: sha256Hex(bytes), size: bytes.length };
}

/**
 * Content-addressed, write-once. Same hash reuses the file.
 * A different payload already at that path refuses; it does not overwrite.
 */
export function storeBlob(projectId: string, hash: string, bytes: Buffer, home?: string): void {
	if (!BLOB_HASH_RE.test(hash) || sha256Hex(bytes) !== hash) {
		throw new Error("blob_hash mismatch");
	}
	mkdirSync(projectBlobsDir(projectId, home), { recursive: true });
	const dest = blobPath(projectId, hash, home);
	try {
		writeFileSync(dest, bytes, { flag: "wx" });
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code !== "EEXIST") throw err;
		const existing = readFileSync(dest);
		if (existing.length !== bytes.length || sha256Hex(existing) !== hash) {
			throw new Error("blob_corrupt");
		}
	}
}
