/** Evidence metadata. Bytes live in the blob pack, never on the record. */

export const BLOB_HASH_RE = /^[a-f0-9]{64}$/;

export type EvidenceMeta = {
	blob_hash: string;
	byte_size: number;
	producer: string;
	expires_at: string;
};

export function parseEvidenceMeta(input: {
	blob_hash?: unknown;
	byte_size?: unknown;
	producer?: unknown;
	expires_at?: unknown;
}): ({ ok: true } & EvidenceMeta) | { ok: false; error: string } {
	const producer = typeof input.producer === "string" ? input.producer.trim() : "";
	if (!producer) return { ok: false, error: "producer required" };
	const expires_at = typeof input.expires_at === "string" ? input.expires_at.trim() : "";
	if (!expires_at || Number.isNaN(Date.parse(expires_at))) return { ok: false, error: "expires_at required" };
	const blob_hash = typeof input.blob_hash === "string" ? input.blob_hash.trim() : "";
	if (!BLOB_HASH_RE.test(blob_hash)) return { ok: false, error: "blob_hash required" };
	const size = input.byte_size;
	if (typeof size !== "number" || !Number.isInteger(size) || size < 0) {
		return { ok: false, error: "byte_size required" };
	}
	return { ok: true, blob_hash, byte_size: size, producer, expires_at };
}

/** Read-time stale mark. Does not delete the blob or the citing constraint. */
export function evidenceExpired(expires_at: string, now: number): boolean {
	const t = Date.parse(expires_at);
	if (Number.isNaN(t)) return true;
	return t <= now;
}
