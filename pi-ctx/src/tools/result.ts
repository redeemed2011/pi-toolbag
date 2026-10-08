export type ToolText = {
	content: [{ type: "text"; text: string }];
	details: unknown;
};

const EMPTY_TOOL_RESULT = { error: "empty tool result" };

export function jsonResult(data: unknown): ToolText {
	const text = JSON.stringify(data, null, 2);
	// JSON.stringify(undefined) is undefined, not a string. Pi stores that text and
	// crashes on every later request that replays the tool result.
	if (typeof text !== "string") {
		return {
			content: [{ type: "text" as const, text: JSON.stringify(EMPTY_TOOL_RESULT) }],
			details: EMPTY_TOOL_RESULT,
		};
	}
	return {
		content: [{ type: "text" as const, text }],
		details: data,
	};
}

export function dropKeys<T extends Record<string, unknown>>(args: unknown, keys: string[]): T {
	if (!args || typeof args !== "object") return {} as T;
	const rest = { ...(args as Record<string, unknown>) };
	for (const key of keys) delete rest[key];
	return rest as T;
}
