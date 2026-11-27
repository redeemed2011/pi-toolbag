import type { Occupancy } from "../types.js";
import {
	CLAIMED_SLOT_CS,
	CLAIMED_SLOT_GE,
	GATE_BODY_COUNT,
	GATE_BODY_TOKENS,
	SIBLING_RESERVE,
	textTokens,
} from "./estimate.js";

export function claimedSlotCap(occupancy: Occupancy, siblingKnob: 0 | 2): number {
	if (occupancy === "claim-strip") return CLAIMED_SLOT_CS;
	return siblingKnob === 0 ? CLAIMED_SLOT_GE : CLAIMED_SLOT_GE - SIBLING_RESERVE;
}

export function questionBodyTokens(q: { directive?: string; body?: string }): number {
	return textTokens(q.directive || q.body || "");
}

export function claimSlotFits(
	q: { directive?: string; body?: string },
	occupancy: Occupancy,
	siblingKnob: 0 | 2,
): boolean {
	return questionBodyTokens(q) <= claimedSlotCap(occupancy, siblingKnob);
}

export type GateCheck = { gate: 0 | 1; n: number; bodyTokens: number };

export function gateCheck(bodies: Array<{ directive?: string; body?: string }>): GateCheck {
	const n = bodies.length;
	let bodyTokens = 0;
	for (const b of bodies) bodyTokens += textTokens(b.directive || b.body || "");
	const gate: 0 | 1 = n > GATE_BODY_COUNT || bodyTokens > GATE_BODY_TOKENS ? 1 : 0;
	return { gate, n, bodyTokens };
}
