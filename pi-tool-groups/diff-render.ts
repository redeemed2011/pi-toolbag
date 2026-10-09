import { hashlineDiffToGutter, type HashlineDisplay } from "./diff-display.ts";

type DiffResult = { details?: { diff?: unknown; diffLineNumbers?: unknown } };
type Paint = (gutter: string, width: number, theme: unknown) => string[] | null;

export type HashlinePainters = {
	split: Paint | null;
	unified: Paint;
};

function frame(display: HashlineDisplay, body: string[], theme: unknown): string[] {
	const header = display.header === undefined ? [] : [paint(theme, "warning", display.header)];
	const notice = display.notice === undefined ? [] : [paint(theme, "dim", display.notice)];
	return [...header, ...body, ...notice];
}

function paint(theme: unknown, color: string, text: string): string {
	const fg = (theme as { fg?: (name: string, value: string) => string } | null)?.fg;
	if (typeof fg !== "function") return text;
	try {
		return fg(color, text);
	} catch {
		return text;
	}
}

function linesOf(paint: Paint, gutter: string, width: number, theme: unknown): string[] | null {
	const lines = paint(gutter, width, theme);
	if (!Array.isArray(lines) || lines.length === 0) return null;
	return lines;
}

/**
 * Draw a converted hashline diff. An unrecognized diff, or a painter that
 * throws, uses the tool's own render. The result details are not written.
 */
export function renderHashlineResult(
	result: DiffResult,
	width: number,
	theme: unknown,
	painters: HashlinePainters,
	originalLines: () => string[],
): string[] {
	let display: HashlineDisplay | null = null;
	try {
		display = hashlineDiffToGutter(result.details?.diff, result.details?.diffLineNumbers);
	} catch {
		display = null;
	}
	if (!display) {
		try {
			return originalLines();
		} catch {
			return [];
		}
	}
	if (painters.split) {
		try {
			const split = linesOf(painters.split, display.gutter, width, theme);
			if (split) return frame(display, split, theme);
		} catch {
			// The split painter is optional. The unified painter is next.
		}
	}
	try {
		const unified = linesOf(painters.unified, display.gutter, width, theme);
		if (unified) return frame(display, unified, theme);
	} catch {
		// Fall through to the tool's own renderer.
	}
	try {
		return originalLines();
	} catch {
		return frame(display, [display.gutter], theme);
	}
}
