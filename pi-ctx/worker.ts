/**
 * Observer worker. Registers only record_observations.
 * Must not register orchestrator hooks (compact inject, compact trigger, observer clock).
 * Cannot construct constraint / decision / question / fog / destination / out_of_scope / pending_replace.
 */
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { attachFallback } from "pi-fallback-lib";
import { writeObserverResult, type RawObservation } from "./src/spawn/runs.js";

const RecordObservationsSchema = Type.Object({
	observations: Type.Array(
		Type.Object({
			timestamp: Type.String({
				description: "Observation time in local 'YYYY-MM-DD HH:MM' format.",
			}),
			content: Type.String({
				minLength: 1,
				description: "Single-line plain prose. No markdown, no tags.",
			}),
		}),
	),
});

export default function ctxObserverWorker(pi: ExtensionAPI): void {
	const resultPath = process.env.CTX_RESULT_PATH;
	if (!resultPath) {
		pi.registerTool({
			name: "record_observations",
			label: "Record observations",
			description: "Unavailable: CTX_RESULT_PATH is not set.",
			parameters: RecordObservationsSchema,
			async execute() {
				return { content: [{ type: "text" as const, text: "CTX_RESULT_PATH missing" }], details: {} };
			},
		});
		return;
	}

	const accumulated: RawObservation[] = [];
	const seen = new Set<string>();
	const flush = () => writeObserverResult(resultPath, { observations: accumulated });
	flush();

	pi.registerTool({
		name: "record_observations",
		label: "Record observations",
		description:
			"Record a batch of observations distilled from the conversation chunk. " +
			"Call until the chunk is covered, then emit a short confirmation.",
		parameters: RecordObservationsSchema,
		async execute(
			_id: string,
			params: { observations: RawObservation[] },
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			_ctx: ExtensionContext,
		) {
			let added = 0;
			for (const obs of params.observations) {
				const content = obs.content.replace(/[\r\n]+/g, " ").trim();
				if (!content) continue;
				const key = `${obs.timestamp}\u241e${content}`;
				if (seen.has(key)) continue;
				seen.add(key);
				accumulated.push({ timestamp: obs.timestamp, content });
				added++;
			}
			flush();
			return {
				content: [
					{
						type: "text" as const,
						text: `Recorded ${added}. Total so far: ${accumulated.length}. Continue if uncovered content remains.`,
					},
				],
				details: { added, total: accumulated.length },
			};
		},
	});

	attachFallback(pi, {
		retryAfterTools: true,
		configPath: join(getAgentDir(), "auto-fallback.json"),
	});
}
