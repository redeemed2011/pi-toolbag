import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ritualTurn, stripFrontmatter } from "./src/message.js";
import { RITUALS, type RitualName } from "./src/paths.js";

const packageRoot = dirname(fileURLToPath(import.meta.url));

const COMMAND_DESCRIPTION: Record<RitualName, string> = {
	"first-questions":
		"Shrink the request to one sentence and record every other requirement as kept, changed, deferred, or cut.",
	"first-principles":
		"Derive the smallest solution from sourced facts after first-questions.",
};

export type SkillReader = (name: RitualName) => string;

export function readSkill(name: RitualName, root = packageRoot): string {
	const raw = readFileSync(join(root, "skills", name, "SKILL.md"), "utf8");
	return stripFrontmatter(raw);
}

export function registerFoundations(pi: ExtensionAPI, read: SkillReader = readSkill): void {
	for (const name of RITUALS) {
		pi.registerCommand(name, {
			description: COMMAND_DESCRIPTION[name],
			handler: async (args, ctx) => {
				await runRitual(pi, ctx, name, args ?? "", read);
			},
		});
	}
}

async function runRitual(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	name: RitualName,
	args: string,
	read: SkillReader,
): Promise<void> {
	let body: string;
	try {
		body = read(name);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (ctx.hasUI) ctx.ui.notify(`${name}: ${message}`, "error");
		return;
	}
	const deliverAs = ctx.isIdle() ? undefined : ("followUp" as const);
	if (ctx.hasUI) ctx.ui.notify(`${name} started`, "info");
	try {
		await pi.sendUserMessage(ritualTurn(body, args), deliverAs ? { deliverAs } : undefined);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (ctx.hasUI) ctx.ui.notify(`${name}: ${message}`, "error");
	}
}

export default function piFoundations(pi: ExtensionAPI): void {
	registerFoundations(pi);
}
