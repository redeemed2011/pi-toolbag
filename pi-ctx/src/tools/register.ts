import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { runBindFlow } from "../commands/bind.js";
import { statusSink } from "../render/bound-status.js";
import { runRecordFlow } from "../commands/record.js";
import { foldLive, parseAppliesTo, resolveOccupancy } from "../fold.js";
import { hitlFromCtx } from "../hitl.js";
import { appendProjectRecord } from "../store/project.js";
import { readEvidenceFile, storeBlob } from "../store/blobs.js";
import type { Runtime } from "../runtime.js";
import { CTX_CLAIM, isReasonClass, type Entry } from "../types.js";
import { applyClaim } from "./claim.js";
import { executeFrontier } from "./frontier.js";
import { executeGet } from "./get.js";
import { dropKeys, jsonResult } from "./result.js";
import { executeZoom } from "./zoom.js";
import {
	ATTACH_GUIDELINE,
	BIND_GUIDELINE,
	CLAIM_GUIDELINE,
	FINDING_GUIDELINE,
	FRONTIER_GUIDELINE,
	GET_GUIDELINE,
	GRANT_GUIDELINE,
	RECORD_GUIDELINE,
	ZOOM_GUIDELINE,
} from "./guidelines.js";
import { executeAttach } from "./attach.js";
import { executeFinding } from "./finding.js";
import { findingRawError } from "../grant.js";
import { executeGrant } from "./grant.js";

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
			if (fold.grantId && params.action === "claim" && params.question_id !== fold.grantQuestionId) {
				return jsonResult({ ok: false, error: "worker claim limited" });
			}
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
			const setStatus = statusSink(ctx);
			const { fold, branch } = sync(runtime, ctx);
			if (fold.grantId) return jsonResult({ ok: false, error: "worker cannot bind" });
			const result = await runBindFlow({
				pi,
				runtime,
				hitl: hitlFromCtx(ctx),
				cwd: ctx.cwd,
				branch,
				suggestedName: params.name,
				status: setStatus,
			});
			return jsonResult(result);
		},
	});

	pi.registerTool({
		name: "ctx_record",
		label: "ctx record",
		description:
			"Append a new project record to the bound project log. Never overwrite. Observers cannot call this. Evidence copies a file by hash and is not a constraint.",
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
				"evidence",
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
			source_path: Type.Optional(
				Type.String({
					description: "File to copy into the blob store. Required when type is evidence. Not stored as the locator.",
				}),
			),
			producer: Type.Optional(Type.String({ description: "Who produced the file. Required on evidence." })),
			expires_at: Type.Optional(
				Type.String({
					description: "ISO expiry. Required on evidence. Read-time stale mark; does not retire a citing constraint.",
				}),
			),
		}),
		prepareArguments(args: unknown) {
			const input = dropKeys<{
				type: "constraint" | "decision" | "question" | "fog" | "destination" | "out_of_scope" | "finding" | "tombstone" | "citation" | "evidence";
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
				source_path?: string;
				producer?: string;
				expires_at?: string;
			}>(args, []);
			const applies = parseAppliesTo(input.applies_to);
			if (applies !== undefined) input.applies_to = applies;
			return input;
		},
		async execute(
			_id: string,
			params: {
				type: "constraint" | "decision" | "question" | "fog" | "destination" | "out_of_scope" | "finding" | "tombstone" | "citation" | "evidence";
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
				source_path?: string;
				producer?: string;
				expires_at?: string;
			},
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionContext,
		) {
			const { fold } = sync(runtime, ctx);
			if (fold.grantId) return jsonResult({ ok: false, error: "worker cannot record" });
			let staged: { hash: string; size: number; bytes: Buffer } | undefined;
			if (params.source_path && params.type !== "evidence") {
				return jsonResult({ ok: false, error: "source_path only on evidence" });
			}
			if (params.type === "evidence") {
				if (!params.source_path) return jsonResult({ ok: false, error: "source_path required" });
				const read = readEvidenceFile(params.source_path);
				if (!read.ok) return jsonResult(read);
				staged = { hash: read.hash, size: read.size, bytes: read.bytes };
			}
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
					blob_hash: staged?.hash,
					byte_size: staged?.size,
					producer: params.producer,
					expires_at: params.expires_at,
					session: runtime.sessionId,
				},
			});
			if (result.ok && staged && !runtime.projectId) {
				return jsonResult({ ok: false, error: "no project bound" });
			}
			if (result.ok && runtime.projectId) {
				if (staged) {
					try {
						storeBlob(runtime.projectId, staged.hash, staged.bytes);
					} catch {
						return jsonResult({ ok: false, error: "blob_corrupt" });
					}
				}
				appendProjectRecord(runtime.projectId, runtime.sessionId, result.line);
				runtime.reloadProject();
			}
			return jsonResult(result);
		},
	});
	pi.registerTool({
		name: "ctx_grant",
		label: "ctx grant",
		description: "Hand one live question to a new session. Returns a project id and a token. Does not start that session.",
		promptSnippet: "Grant one live ctx question to a new session",
		promptGuidelines: [GRANT_GUIDELINE],
		parameters: Type.Object({
			question_id: Type.String(),
		}),
		async execute(
			_id: string,
			params: { question_id?: string },
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionContext,
		) {
			const { fold } = sync(runtime, ctx);
			return jsonResult(executeGrant({
				enabled: runtime.enabled,
				bound: fold.bound,
				grantId: fold.grantId,
				projectId: runtime.projectId,
				sessionId: runtime.sessionId,
				questionId: params.question_id,
				live: liveOf(runtime),
			}));
		},
	});

	pi.registerTool({
		name: "ctx_attach",
		label: "ctx attach",
		description: "Bind a fresh session to a granted question. Refuses a session that has ever been bound. Does not harvest.",
		promptSnippet: "Attach this fresh session to a granted ctx question",
		promptGuidelines: [ATTACH_GUIDELINE],
		parameters: Type.Object({
			project_id: Type.String(),
			token: Type.String(),
		}),
		async execute(
			_id: string,
			params: { project_id?: string; token?: string },
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionContext,
		) {
			const { branch } = sync(runtime, ctx);
			return jsonResult(executeAttach({
				pi,
				runtime,
				branch,
				projectId: params.project_id,
				token: params.token,
				status: statusSink(ctx),
			}));
		},
	});

	pi.registerTool({
		name: "ctx_finding",
		label: "ctx finding",
		description: "File a finding on the granted question. Headline and body only. The server sets the type and the parent.",
		promptSnippet: "File a ctx finding on the granted question",
		promptGuidelines: [FINDING_GUIDELINE],
		parameters: Type.Object({
			headline: Type.String(),
			body: Type.String(),
		}),
		prepareArguments(args: unknown) {
			const refused = findingRawError(args);
			if (refused) return { headline: "", body: "", __refuse: refused };
			const raw = args as { headline: string; body: string };
			return { headline: raw.headline, body: raw.body };
		},
		async execute(
			_id: string,
			params: { headline?: string; body?: string; __refuse?: string },
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionContext,
		) {
			if (params.__refuse) return jsonResult({ ok: false, error: params.__refuse });
			const { fold } = sync(runtime, ctx);
			const result = executeFinding({
				enabled: runtime.enabled,
				bound: fold.bound,
				grantId: fold.grantId,
				grantQuestionId: fold.grantQuestionId,
				projectId: runtime.projectId,
				occupancy: occupancyOf(runtime),
				siblingKnob: runtime.config.gatedEdgeSiblingHeadlines,
				claimedId: fold.claimedId,
				existing: runtime.projectRecords,
				headline: params.headline ?? "",
				body: params.body ?? "",
				sessionId: runtime.sessionId,
			});
			if (result.ok && runtime.projectId) {
				appendProjectRecord(runtime.projectId, runtime.sessionId, result.line);
				runtime.reloadProject();
			}
			return jsonResult(result);
		},
	});
}
