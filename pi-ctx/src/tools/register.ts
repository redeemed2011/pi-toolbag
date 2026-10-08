import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { runBindFlow } from "../commands/bind.js";
import { runRecordFlow } from "../commands/record.js";
import { foldLive, parseAppliesTo, resolveOccupancy } from "../fold.js";
import { hitlFromCtx } from "../hitl.js";
import { appendProjectRecord } from "../store/project.js";
import type { Runtime } from "../runtime.js";
import { CTX_CLAIM, isReasonClass, type Entry } from "../types.js";
import { applyClaim } from "./claim.js";
import { executeFrontier } from "./frontier.js";
import { executeGet } from "./get.js";
import { dropKeys, jsonResult } from "./result.js";
import { executeZoom } from "./zoom.js";
import {
	BIND_GUIDELINE,
	CLAIM_GUIDELINE,
	FRONTIER_GUIDELINE,
	GET_GUIDELINE,
	RECORD_GUIDELINE,
	ZOOM_GUIDELINE,
} from "./guidelines.js";

function sync(runtime: Runtime, ctx: ExtensionContext) {
	const branch = ctx.sessionManager.getBranch() as Entry[];
	const sessionId = ctx.sessionManager.getSessionId();
	return { fold: runtime.restoreFromBranch(branch, sessionId), branch };
}

function occupancyOf(runtime: Runtime) {
	return resolveOccupancy({ occupancy: runtime.occupancy }, runtime.config.occupancy);
}

function liveOf(runtime: Runtime) {
	return runtime.projectLive ?? foldLive(runtime.projectRecords);
}

export function registerTools(pi: ExtensionAPI, runtime: Runtime): void {
	pi.registerTool({
		name: "ctx_get",
		label: "ctx get",
		description: "Point lookup or default retrieve. Omit id for default retrieve. Must not scan the observation corpus.",
		promptSnippet: "Retrieve ctx default law/claim or a record by id",
		promptGuidelines: [GET_GUIDELINE],
		parameters: Type.Object({
			id: Type.Optional(Type.String({ description: "Record id. Omit for default retrieve." })),
		}),
		prepareArguments(args: unknown) {
			return dropKeys<{ id?: string }>(args, ["q", "similar", "related", "search"]);
		},
		async execute(_id: string, params: { id?: string }, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const { fold } = sync(runtime, ctx);
			return jsonResult(
				executeGet({
					id: params.id,
					enabled: runtime.enabled,
					bound: fold.bound,
					occupancy: occupancyOf(runtime),
					claimedId: fold.claimedId,
					live: liveOf(runtime),
					records: runtime.projectRecords,
					observations: fold.observations,
					recency: fold.recency,
				}),
			);
		},
	});

	pi.registerTool({
		name: "ctx_zoom",
		label: "ctx zoom",
		description: "Full body of a record by id. Never paraphrase.",
		promptSnippet: "Zoom a ctx record body by id",
		promptGuidelines: [ZOOM_GUIDELINE],
		parameters: Type.Object({
			id: Type.String({ description: "Record id" }),
		}),
		async execute(_id: string, params: { id: string }, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
			const { fold } = sync(runtime, ctx);
			return jsonResult(
				executeZoom({
					id: params.id,
					enabled: runtime.enabled,
					live: liveOf(runtime),
					records: runtime.projectRecords,
					observations: fold.observations,
				}),
			);
		},
	});

	pi.registerTool({
		name: "ctx_frontier",
		label: "ctx frontier",
		description: "Open unblocked unclaimed questions in mint-time order. Cap 20; remainder in elided.",
		promptSnippet: "List open unclaimed ctx questions",
		promptGuidelines: [FRONTIER_GUIDELINE],
		parameters: Type.Object({
			include_blocked: Type.Optional(Type.Boolean()),
		}),
		async execute(
			_id: string,
			params: { include_blocked?: boolean },
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionContext,
		) {
			const { fold } = sync(runtime, ctx);
			return jsonResult(
				executeFrontier({
					enabled: runtime.enabled,
					bound: fold.bound,
					claimedId: fold.claimedId,
					live: liveOf(runtime),
					include_blocked: params.include_blocked,
				}),
			);
		},
	});

	pi.registerTool({
		name: "ctx_claim",
		label: "ctx claim",
		description: "Read or set the session claim. Live swap refuses; close first or user /ctx claim.",
		promptSnippet: "Status, claim, or close the ctx claim",
		promptGuidelines: [CLAIM_GUIDELINE],
		parameters: Type.Object({
			action: StringEnum(["status", "claim", "close"] as const),
			question_id: Type.Optional(Type.String()),
		}),
		prepareArguments(args: unknown) {
			return dropKeys<{ action: "status" | "claim" | "close"; question_id?: string }>(
				args,
				["score", "related", "similar"],
			);
		},
		async execute(
			_id: string,
			params: { action: "status" | "claim" | "close"; question_id?: string },
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionContext,
		) {
			const { fold } = sync(runtime, ctx);
			const result = applyClaim({
				action: params.action,
				question_id: params.question_id,
				bound: fold.bound,
				enabled: runtime.enabled,
				claimedId: fold.claimedId,
				live: liveOf(runtime),
				occupancy: occupancyOf(runtime),
				siblingKnob: runtime.config.gatedEdgeSiblingHeadlines,
			});
			if (result.ok && !result.noop && params.action !== "status") {
				pi.appendEntry(CTX_CLAIM, { claimed_question_id: result.claimed_id });
				runtime.claimedId = result.claimed_id;
			}
			return jsonResult(result);
		},
	});

	pi.registerTool({
		name: "ctx_bind",
		label: "ctx bind",
		description: "Start the bind HITL flow (name, confirm). Never silent. Print mode refuses. Does not promote observations into law.",
		promptSnippet: "Bind this session to a ctx project",
		promptGuidelines: [BIND_GUIDELINE],
		parameters: Type.Object({
			name: Type.Optional(
				Type.String({ description: "Suggested project name. Collision still HITL." }),
			),
		}),
		async execute(
			_id: string,
			params: { name?: string },
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionContext,
		) {
			const { branch } = sync(runtime, ctx);
			const result = await runBindFlow({
				pi,
				runtime,
				hitl: hitlFromCtx(ctx),
				cwd: ctx.cwd,
				branch,
				suggestedName: params.name,
			});
			return jsonResult(result);
		},
	});

	pi.registerTool({
		name: "ctx_record",
		label: "ctx record",
		description: "Append a new judgment record to the bound project log. Never overwrite. Observers cannot call this.",
		promptSnippet: "Mint a ctx judgment record",
		promptGuidelines: [RECORD_GUIDELINE],
		parameters: Type.Object({
			type: StringEnum([
				"constraint",
				"decision",
				"question",
				"fog",
				"destination",
				"out_of_scope",
				"finding",
				"tombstone",
				"citation",
			] as const),
			headline: Type.String(),
			directive: Type.Optional(
				Type.String({ description: "Injected wording. Required on constraint; missing refuses." }),
			),
			rationale: Type.Optional(
				Type.String({ description: "Zoom only. Never injected. Compact hook does not split prose." }),
			),
			applies_to: Type.Optional(
				Type.Union([Type.Literal("all"), Type.Array(Type.String())], {
					description: '"all" or live question ids. A one-element ["all"] means all.',
				}),
			),
			supersedes: Type.Optional(Type.String()),
			reason_class: Type.Optional(StringEnum(["clarification", "decision_change", "conflict"] as const)),
			parent: Type.Optional(Type.String()),
			blocks: Type.Optional(Type.Array(Type.String())),
			conflicts_with: Type.Optional(Type.Array(Type.String())),
			citation_target: Type.Optional(Type.String()),
		}),
		prepareArguments(args: unknown) {
			const input = dropKeys<{
				type: "constraint" | "decision" | "question" | "fog" | "destination" | "out_of_scope" | "finding" | "tombstone" | "citation";
				headline: string;
				directive?: string;
				rationale?: string;
				applies_to?: "all" | string[];
				supersedes?: string;
				reason_class?: "clarification" | "decision_change" | "conflict";
				parent?: string;
				blocks?: string[];
				conflicts_with?: string[];
				citation_target?: string;
			}>(args, []);
			const applies = parseAppliesTo(input.applies_to);
			if (applies !== undefined) input.applies_to = applies;
			return input;
		},
		async execute(
			_id: string,
			params: {
				type: "constraint" | "decision" | "question" | "fog" | "destination" | "out_of_scope" | "finding" | "tombstone" | "citation";
				headline: string;
				directive?: string;
				rationale?: string;
				applies_to?: "all" | string[];
				supersedes?: string;
				reason_class?: string;
				parent?: string;
				blocks?: string[];
				conflicts_with?: string[];
				citation_target?: string;
			},
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionContext,
		) {
			const { fold } = sync(runtime, ctx);
			const result = await runRecordFlow({
				hitl: hitlFromCtx(ctx),
				enabled: runtime.enabled,
				bound: fold.bound,
				occupancy: occupancyOf(runtime),
				siblingKnob: runtime.config.gatedEdgeSiblingHeadlines,
				claimedId: fold.claimedId,
				existing: runtime.projectRecords,
				input: {
					type: params.type,
					headline: params.headline,
					directive: params.directive,
					rationale: params.rationale,
					applies_to: params.applies_to,
					supersedes: params.supersedes,
					reason_class: isReasonClass(params.reason_class) ? params.reason_class : undefined,
					parent: params.parent,
					blocks: params.blocks,
					conflicts_with: params.conflicts_with,
					citation_target: params.citation_target,
					session: runtime.sessionId,
				},
			});
			if (result.ok && runtime.projectId) {
				appendProjectRecord(runtime.projectId, runtime.sessionId, result.line);
				runtime.reloadProject();
			}
			return jsonResult(result);
		},
	});
}
