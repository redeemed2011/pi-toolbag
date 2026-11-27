import type { PackedInject } from "../types.js";
import { INJECT_CAP, injectTokens } from "./estimate.js";

export function joinSections(parts: Array<string | undefined | null>): string {
	return parts
		.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
		.join("\n\n")
		.trimEnd();
}

function truncatable(text: string): boolean {
	return text.trim().length > 0;
}

function truncateTail(text: string): string {
	if (text.length <= 4) return "";
	return text.slice(0, text.length - 4).replace(/\s+$/u, "");
}

export type OverflowInput = {
	headers: string;
	dest: string;
	claimed: string;
	counts: string;
	banner?: string;
};

/** Overflow: gate=1, zero constraint bodies. Truncate claim last as a safety net. */
export function renderOverflow(input: OverflowInput): PackedInject {
	let claimed = input.claimed;
	let claim_truncated: 0 | 1 = 0;
	const assemble = (c: string) =>
		joinSections([input.headers, input.dest, "gate=1", c, input.counts, input.banner]);
	let text = assemble(claimed);
	while (injectTokens(text) > INJECT_CAP && truncatable(claimed)) {
		claimed = truncateTail(claimed);
		claim_truncated = 1;
		text = assemble(claimed);
	}
	if (injectTokens(text) > INJECT_CAP) {
		text = joinSections([input.headers, "gate=1", input.counts]).slice(0, INJECT_CAP * 4);
	}
	return { text, gate: 1, claim_truncated };
}

export type PackInput = {
	headers: string;
	dest: string;
	bodiesMd: string;
	claimedMd: string;
	counts: string;
	banner?: string;
	fill: string[];
	overflow?: OverflowInput;
};

/**
 * Mandatory first; truncate claim before dropping GATE=0 bodies; fill last.
 * Never leftover-fill. Never drop bodies to fit recency/siblings.
 */
export function packInject(input: PackInput): PackedInject {
	let claimed = input.claimedMd;
	let claim_truncated: 0 | 1 = 0;
	const assemble = (c: string, filled: string[] = []) =>
		joinSections([input.headers, input.dest, input.bodiesMd, c, input.counts, input.banner, ...filled]);

	while (injectTokens(assemble(claimed)) > INJECT_CAP && truncatable(claimed)) {
		claimed = truncateTail(claimed);
		claim_truncated = 1;
	}

	if (injectTokens(assemble(claimed)) > INJECT_CAP) {
		return renderOverflow(
			input.overflow ?? {
				headers: input.headers,
				dest: input.dest,
				claimed,
				counts: input.counts,
				banner: input.banner,
			},
		);
	}

	const filled: string[] = [];
	for (const line of input.fill) {
		const trial = assemble(claimed, [...filled, line]);
		if (injectTokens(trial) > INJECT_CAP) break;
		filled.push(line);
	}
	return { text: assemble(claimed, filled), gate: 0, claim_truncated };
}
