/**
 * Turn a hashline anchored diff into the gutter text pi and droid already parse.
 * Returns null unless every line is the current hashline shape, so a format
 * change keeps the tool's own renderer instead of a half-parsed diff.
 *
 * A row is `+btfd│bravo`, `-    │bravo`, or ` abcd│alpha`: one prefix, a
 * 4-letter anchor or four spaces, U+2502, then the line text.
 */

const ANCHOR_ROW = /^([+ -])([A-Za-z]{4}| {4})│(.*)$/;
const BATCH_HEADER = /^batch \d+:$/;
const ELLIPSIS = " ...";
const TRUNCATION = /^\[diff truncated at .+; use read to see the rest\.\]$/;

export type HashlineDisplay = {
	gutter: string;
	header?: string;
	notice?: string;
};

function blankNumber(value: unknown): boolean {
	return value === null || value === undefined;
}

function lineNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : undefined;
}

export function hashlineDiffToGutter(diff: unknown, lineNumbers: unknown): HashlineDisplay | null {
	if (typeof diff !== "string" || diff.length === 0 || !diff.includes("│")) return null;
	if (!Array.isArray(lineNumbers)) return null;
	const lines = diff.split("\n");
	if (lineNumbers.length !== lines.length) return null;

	let header: string | undefined;
	let notice: string | undefined;
	const gutter: string[] = [];
	let anchored = 0;

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		const rawNumber = lineNumbers[index];
		if (index === 0 && BATCH_HEADER.test(line)) {
			if (!blankNumber(rawNumber)) return null;
			header = line;
			continue;
		}
		if (line === ELLIPSIS) {
			if (!blankNumber(rawNumber)) return null;
			gutter.push(ELLIPSIS);
			continue;
		}
		if (TRUNCATION.test(line)) {
			if (index !== lines.length - 1 || !blankNumber(rawNumber) || notice !== undefined) return null;
			notice = line;
			continue;
		}
		const match = ANCHOR_ROW.exec(line);
		const number = lineNumber(rawNumber);
		if (!match || number === undefined) return null;
		anchored += 1;
		gutter.push(`${match[1]}${number} ${match[3] ?? ""}`);
	}

	if (anchored === 0) return null;
	return {
		gutter: gutter.join("\n"),
		...(header !== undefined ? { header } : {}),
		...(notice !== undefined ? { notice } : {}),
	};
}
