/** Pi 0.84.4 compactionSummary / inject billing: chars/4, ceil. */
export function injectTokens(summary: string): number {
	return Math.ceil(summary.length / 4);
}

/** Same estimator for rendered constraint / question wording. */
export function textTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

export const INJECT_CAP = 8_000;
export const GATE_BODY_TOKENS = 3_500;
export const GATE_BODY_COUNT = 20;
export const CLAIMED_SLOT_CS = 1_200;
export const CLAIMED_SLOT_GE = 1_500;
export const SIBLING_RESERVE = 200;
