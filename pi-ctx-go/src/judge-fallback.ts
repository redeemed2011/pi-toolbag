import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * The judge does not attach auto-fallback.
 * That chain switches models, and pi-fallback-lib only retries by switching.
 * The session model, or the operator's judge override, stays the judge.
 */
export default function ctxGoJudgeFallback(_pi: ExtensionAPI): void {}
