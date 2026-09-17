export type ToolText = {
	content: [{ type: "text"; text: string }];
	details: unknown;
};

export function jsonResult(data: unknown): ToolText {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
		details: data,
	};
}

export function dropKeys<T extends Record<string, unknown>>(args: unknown, keys: string[]): T {
	if (!args || typeof args !== "object") return args as T;
	const rest = { ...(args as Record<string, unknown>) };
	for (const key of keys) delete rest[key];
	return rest as T;
}
