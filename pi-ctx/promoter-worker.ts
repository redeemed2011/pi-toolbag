/**
 * Bind-consent promoter worker. Registers only submit_harvest.
 * Must not register orchestrator hooks. Cannot mint project law (parent writes).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { attachFallback } from "pi-fallback-lib";
import { writePromoterResult } from "./src/promoter/io.js";
import { emptyPromoterResult } from "./src/promoter/schema.js";

const Item = Type.Object({
	quote: Type.String({ minLength: 1 }),
	headline: Type.Optional(Type.String()),
	live_id: Type.Optional(Type.String()),
	reason: Type.Optional(Type.String()),
});

const HarvestSchema = Type.Object({
	promote: Type.Array(Type.Object({ quote: Type.String({ minLength: 1 }), headline: Type.Optional(Type.String()) })),
	pending_replace: Type.Array(
		Type.Object({
			quote: Type.String({ minLength: 1 }),
			live_id: Type.String({ minLength: 1 }),
			reason: Type.Optional(Type.String()),
		}),
	),
});

export default function ctxPromoterWorker(pi: ExtensionAPI): void {
	const resultPath = process.env.CTX_RESULT_PATH;
	if (!resultPath || process.env.CTX_PROMOTER_TOKEN !== "1") {
		pi.registerTool({
			name: "submit_harvest",
			label: "Submit harvest",
			description: "Unavailable: promoter token missing.",
			parameters: HarvestSchema,
			async execute() {
				return { content: [{ type: "text" as const, text: "promoter token missing" }], details: {} };
			},
		});
		return;
	}

	let kickoff = "";
	try {
		kickoff = readFileSync(join(process.cwd(), "kickoff.json"), "utf-8");
	} catch {
		kickoff = "{}";
	}

	writePromoterResult(resultPath, emptyPromoterResult());

	pi.registerTool({
		name: "submit_harvest",
		label: "Submit harvest",
		description:
			"Submit standing house-rule quotes to promote and live-law replace offers. Call once. Kickoff JSON is in cwd.",
		parameters: HarvestSchema,
		async execute(
			_id: string,
			params: { promote: { quote: string; headline?: string }[]; pending_replace: { quote: string; live_id: string; reason?: string }[] },
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			_ctx: ExtensionContext,
		) {
			writePromoterResult(resultPath, {
				promote: params.promote ?? [],
				pending_replace: params.pending_replace ?? [],
			});
			return {
				content: [{ type: "text" as const, text: `harvest recorded. kickoff_bytes=${kickoff.length}` }],
				details: {},
			};
		},
	});

	// --offline worker: a billing fetch would stall and then fail open.
	attachFallback(pi, {
		configPath: join(getAgentDir(), "auto-fallback.json"),
		retryAfterTools: true,
		checkUsage: false,
	});
}
