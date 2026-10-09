import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const require = createRequire(import.meta.url);

type SplitModule = {
	buildSplitRows?: (diff: string) => unknown;
	SplitDiffComponent?: new (theme: unknown, rows: unknown, maxRows: number) => { render: (width: number) => string[] };
};

export type SplitPaint = (gutter: string, width: number, theme: unknown) => string[] | null;

function packageAlias(specifier: string): string | undefined {
	try {
		return fileURLToPath(import.meta.resolve(specifier));
	} catch {
		return undefined;
	}
}

/** The droid split renderer, if that package is installed. Null is the unified fallback. */
export function splitDiffFile(): string | undefined {
	try {
		const resolved = join(dirname(require.resolve("@sting8k/pi-droid-styling/package.json")), "split-diff.ts");
		if (existsSync(resolved)) return resolved;
	} catch {
		// The styling package is installed next to the agent, not this extension.
	}
	const installed = join(getAgentDir(), "npm", "node_modules", "@sting8k", "pi-droid-styling", "split-diff.ts");
	return existsSync(installed) ? installed : undefined;
}

export async function loadSplitPaint(): Promise<SplitPaint | null> {
	const file = splitDiffFile();
	if (!file) return null;
	try {
		const jitiModule = await import("jiti") as { createJiti?: (id: string, options?: { alias?: Record<string, string> }) => { import: (path: string) => Promise<SplitModule> } };
		if (typeof jitiModule.createJiti !== "function") return null;
		const alias: Record<string, string> = {};
		for (const name of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-agent-core", "@earendil-works/pi-tui", "@earendil-works/pi-ai"]) {
			const resolved = packageAlias(name);
			if (resolved) alias[name] = resolved;
		}
		const loaded = await jitiModule.createJiti(import.meta.url, { alias }).import(file);
		const buildSplitRows = loaded.buildSplitRows;
		const SplitDiff = loaded.SplitDiffComponent;
		if (typeof buildSplitRows !== "function" || typeof SplitDiff !== "function") return null;
		return (gutter, width, theme) => {
			try {
				const rows = buildSplitRows(gutter);
				if (!Array.isArray(rows) || rows.length === 0) return null;
				const lines = new SplitDiff(theme, rows, 160).render(Math.max(20, width));
				return Array.isArray(lines) && lines.length > 0 ? lines : null;
			} catch {
				return null;
			}
		};
	} catch {
		return null;
	}
}
