import {
	AssistantMessageComponent,
	ToolExecutionComponent,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text, truncateToWidth } from "@earendil-works/pi-tui";

/**
 * Fold a consecutive run of read, search, and list tool calls into one row.
 * The finished line counts each kind, in the order it first appeared:
 * `Searched 2 patterns, Listed 1 dir, Read 1 file`.
 * While any call in the run is still going, the verbs stay progressive.
 * A shell command is its own `Ran` row and splits the run.
 * A thought is its own row, and so is any other tool. Consecutive edits of one file become `Edited <file> +N/-M`.
 * pi-droid-styling owns the working row; this file never touches it.
 * Droid also replaces chat.render, so the wrap is put back on each frame.
 */

const WIDGET_KEY = "tool-groups";
const HOOK_KEY = Symbol.for("pi.tool-groups.hook");
const WRAP_MARK = Symbol.for("pi.tool-groups.wrap");

type Kind = "search" | "read" | "list";
type ToolResult = { isError?: boolean; content?: unknown; details?: unknown };
type ToolView = {
	toolName: string;
	args: unknown;
	result?: ToolResult;
	isPartial: boolean;
	expanded: boolean;
	render(width: number): string[];
	invalidate(): void;
};

function toolView(child: ToolExecutionComponent): ToolView {
	return child as unknown as ToolView;
}
type Member = { render(width: number): string[]; invalidate?(): void };
type GroupState = { expanded: boolean; lastHostExpanded: boolean };
type Theme = {
	fg?: (color: string, text: string) => string;
	bold?: (text: string) => string;
};
type Slot = {
	render: (chat: Chat, width: number) => string[];
	states: WeakMap<object, GroupState>;
	theme: Theme | undefined;
};
type Chat = { children: unknown[]; render: (width: number) => string[] };
type Mode = "look" | "shell" | "thought" | "edit" | "tool";

const KIND_WORD: Record<Kind, { going: string; done: string; one: string; many: string }> = {
	search: { going: "Searching", done: "Searched", one: "pattern", many: "patterns" },
	list: { going: "Listing", done: "Listed", one: "dir", many: "dirs" },
	read: { going: "Reading", done: "Read", one: "file", many: "files" },
};

function paint(theme: Theme | undefined, color: string, text: string): string {
	if (typeof theme?.fg !== "function") return text;
	try {
		return theme.fg(color, text);
	} catch {
		return text;
	}
}

function bold(theme: Theme | undefined, text: string): string {
	if (typeof theme?.bold !== "function") return text;
	try {
		return theme.bold(text);
	} catch {
		return text;
	}
}

function argsOf(row: ToolView): Record<string, unknown> {
	return typeof row.args === "object" && row.args !== null ? (row.args as Record<string, unknown>) : {};
}

function oneLine(value: unknown): string {
	if (typeof value !== "string") return "";
	return value.replace(/\s+/g, " ").trim();
}

function lookKind(name: string): Kind | undefined {
	if (name === "read") return "read";
	if (name === "grep" || name === "find" || name === "anchor_grep") return "search";
	if (name === "ls") return "list";
	return undefined;
}

function phase(row: ToolView): "running" | "error" | "done" {
	if (row.isPartial) return "running";
	if (row.result?.isError) return "error";
	return "done";
}

function isLookup(child: unknown): child is ToolExecutionComponent {
	return child instanceof ToolExecutionComponent && lookKind(toolView(child).toolName) !== undefined;
}

function isShell(child: unknown): child is ToolExecutionComponent {
	return child instanceof ToolExecutionComponent && (toolView(child).toolName === "bash" || toolView(child).toolName === "powershell");
}

function isThinkingOnly(child: unknown): child is AssistantMessageComponent {
	if (!(child instanceof AssistantMessageComponent)) return false;
	const content = (child as unknown as { lastMessage?: { content?: Array<{ type?: string; text?: string }> } }).lastMessage?.content;
	if (!Array.isArray(content)) return true;
	return !content.some((block) => block?.type === "text" && block.text?.trim());
}

function isBlank(child: unknown): boolean {
	return child instanceof Spacer || child instanceof Text;
}

/** Count each kind once, in the order it first appeared. Past tense once every call has finished. */
export function summarizeLook(rows: readonly ToolView[]): { text: string; running: boolean; failed: number } {
	const running = rows.some((row) => phase(row) === "running");
	const seen: Kind[] = [];
	const counts: Record<Kind, number> = { search: 0, read: 0, list: 0 };
	let failed = 0;
	for (const row of rows) {
		const kind = lookKind(row.toolName);
		if (!kind) continue;
		if (!seen.includes(kind)) seen.push(kind);
		counts[kind] += 1;
		if (phase(row) === "error") failed += 1;
	}
	const text = seen
		.map((kind) => {
			const word = KIND_WORD[kind];
			const count = counts[kind];
			return `${running ? word.going : word.done} ${count} ${count === 1 ? word.one : word.many}`;
		})
		.join(", ");
	return { text, running, failed };
}

function shellLine(row: ToolView): { verb: string; command: string; running: boolean; failed: boolean } {
	const running = phase(row) === "running";
	const command = oneLine(argsOf(row).command);
	return { verb: running ? "Running" : "Ran", command, running, failed: phase(row) === "error" };
}

const EDIT_NAMES = new Set(["replace", "replace_match", "insert", "write", "copy", "move", "undo_last_change"]);

function isEdit(child: unknown): child is ToolExecutionComponent {
	return child instanceof ToolExecutionComponent && EDIT_NAMES.has(toolView(child).toolName);
}

function editFile(row: ToolView): string {
	const patch = (row.result?.details as { patch?: unknown } | undefined)?.patch;
	if (typeof patch === "string") {
		const header = patch.split("\n").find((line) => line.startsWith("+++ "));
		const file = header?.slice(4).replace(/^(?:[ab]\/)+/, "").trim();
		if (file && file !== "/dev/null") return file;
	}
	const path = argsOf(row).path;
	if (typeof path === "string" && path.trim() && !path.includes("\n")) return path.trim();
	return "";
}

function baseName(path: string): string {
	const name = path.split(/[\\/]/).pop();
	return name && name.length > 0 ? name : path;
}

/** Sum line adds and removes for one file. Past tense once every edit has finished. */
export function summarizeEdit(rows: readonly ToolView[]): { text: string; running: boolean; failed: number; added: number; removed: number } {
	const running = rows.some((row) => phase(row) === "running");
	let added = 0;
	let removed = 0;
	let failed = 0;
	let file = "";
	for (const row of rows) {
		if (!file) file = editFile(row);
		const metrics = (row.result?.details as { metrics?: { added_lines?: number; removed_lines?: number } } | undefined)?.metrics;
		added += metrics?.added_lines ?? 0;
		removed += metrics?.removed_lines ?? 0;
		if (phase(row) === "error") failed += 1;
	}
	const name = file ? baseName(file) : `${rows.length} ${rows.length === 1 ? "call" : "calls"}`;
	return { text: `${running ? "Editing" : "Edited"} ${name}`, running, failed, added, removed };
}

function revealTools(rows: readonly ToolView[], expanded: boolean): void {
	for (const row of rows) {
		if (row.expanded === expanded) continue;
		const tool = row as ToolView & { setExpanded?: (value: boolean) => void };
		if (typeof tool.setExpanded === "function") tool.setExpanded(expanded);
		else tool.expanded = expanded;
	}
}

function thoughtStreaming(members: readonly Member[]): boolean {
	return members.some((member) => (member as { isStreaming?: boolean }).isStreaming === true);
}

function thoughtText(members: readonly Member[]): string {
	const parts: string[] = [];
	for (const member of members) {
		const content = (member as { lastMessage?: { content?: Array<{ type?: string; thinking?: string; thinkingSignature?: string }> } }).lastMessage?.content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (block?.type !== "thinking") continue;
			const written = block.thinking?.trim();
			if (written) {
				parts.push(written);
				continue;
			}
			const summary = signatureSummary(block.thinkingSignature);
			if (summary) parts.push(summary);
		}
	}
	return parts.join(" ");
}

function signatureSummary(signature: string | undefined): string {
	if (!signature) return "";
	try {
		const summary = (JSON.parse(signature) as { summary?: Array<{ text?: string }> }).summary;
		if (!Array.isArray(summary)) return "";
		return summary.map((part) => part?.text?.trim() ?? "").filter(Boolean).join(" ");
	} catch {
		return "";
	}
}

function wrapPlain(text: string, width: number): string[] {
	const clean = text.replace(/\s+/g, " ").trim();
	if (!clean) return [];
	const lines: string[] = [];
	let current = "";
	for (const word of clean.split(" ")) {
		if (!current) {
			current = word;
			continue;
		}
		if (current.length + 1 + word.length > width) {
			lines.push(current);
			current = word;
		} else {
			current = `${current} ${word}`;
		}
	}
	if (current) lines.push(current);
	return lines;
}

function renderThoughtBody(members: readonly Member[], theme: Theme | undefined, width: number): string[] {
	const wrapped = wrapPlain(thoughtText(members), Math.max(1, width - 2));
	if (wrapped.length === 0) return [];
	const mark = paint(theme, "dim", "•");
	return wrapped.map((line, index) => truncateToWidth(index === 0 ? `${mark} ${line}` : `  ${line}`, Math.max(1, width), "…"));
}
function formatToolName(toolName: string): string {
	const spaced = toolName
		.replace(/[_-]+/g, " ")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
		.trim();
	return spaced.replace(/\b\w/g, (char) => char.toUpperCase()) || toolName;
}

function renderMember(mode: Mode, member: Member, width: number): string[] {
	const assistant = member as AssistantMessageComponent;
	const hidden = mode === "thought" && assistant instanceof AssistantMessageComponent && (assistant as unknown as { hideThinkingBlock?: boolean }).hideThinkingBlock === true;
	if (hidden) assistant.setHideThinkingBlock(false);
	const lines = member.render(width);
	if (hidden) assistant.setHideThinkingBlock(true);
	return lines;
}

class SummaryGroup extends Container {
	private readonly mode: Mode;
	private readonly rows: readonly ToolView[];
	private readonly members: readonly Member[];
	private readonly state: GroupState;
	private readonly theme: Theme | undefined;

	constructor(mode: Mode, rows: readonly ToolView[], members: readonly Member[], state: GroupState, theme: Theme | undefined) {
		super();
		this.mode = mode;
		this.rows = rows;
		this.members = members;
		this.state = state;
		this.theme = theme;
	}

	handleMouse(event: { type: string; button?: string; x: number; y: number; screenX: number; screenY: number; width: number; height: number }) {
		if (event.type !== "click" || event.button !== "left") return undefined;
		this.state.expanded = !this.state.expanded;
		return {
			handled: true as const,
			target: {
				component: this,
				originX: event.screenX - event.x,
				originY: event.screenY - event.y,
				width: event.width,
				height: event.height,
			},
		};
	}

	private title(): { text: string; running: boolean; failed: boolean } {
		if (this.mode === "shell") {
			const line = shellLine(this.rows[0]!);
			const verb = paint(this.theme, line.failed ? "error" : line.running ? "accent" : "bashMode", bold(this.theme, line.verb));
			const command = line.command ? ` ${paint(this.theme, "dim", line.command)}` : "";
			return { text: `${verb}${command}`, running: line.running, failed: line.failed };
		}
		if (this.mode === "edit") {
			const summary = summarizeEdit(this.rows);
			const body = paint(this.theme, summary.running ? "accent" : "bashMode", bold(this.theme, summary.text));
			const stat = !summary.running && (summary.added > 0 || summary.removed > 0)
				? `${paint(this.theme, "success", ` +${summary.added}`)}${paint(this.theme, "error", `/-${summary.removed}`)}`
				: "";
			const fail = summary.failed > 0 ? paint(this.theme, "error", ` · ${summary.failed} failed`) : "";
			return { text: `${body}${stat}${summary.running ? "…" : ""}${fail}`, running: summary.running, failed: summary.failed > 0 };
		}
		if (this.mode === "tool") {
			const row = this.rows[0]!;
			const running = phase(row) === "running";
			const failed = phase(row) === "error";
			const name = paint(this.theme, failed ? "error" : running ? "accent" : "bashMode", bold(this.theme, formatToolName(row.toolName)));
			return { text: `${name}${running ? "…" : ""}`, running, failed };
		}
		if (this.mode === "thought") {
			const running = thoughtStreaming(this.members);
			const label = paint(this.theme, "dim", running ? "Thinking…" : "Thinking");
			const preview = thoughtText(this.members).replace(/\s+/g, " ").trim();
			const rest = !running && preview ? ` ${paint(this.theme, "dim", "·")} ${preview}` : "";
			return { text: `${label}${rest}`, running, failed: false };
		}
		const summary = summarizeLook(this.rows);
		const body = paint(this.theme, summary.running ? "accent" : "bashMode", bold(this.theme, summary.text));
		const fail = summary.failed > 0 ? paint(this.theme, "error", ` · ${summary.failed} failed`) : "";
		return { text: `${body}${summary.running ? "…" : ""}${fail}`, running: summary.running, failed: summary.failed > 0 };
	}

	render(width: number): string[] {
		revealTools(this.rows, this.state.expanded);
		if (this.rows[0]) this.state.lastHostExpanded = this.rows[0].expanded;
		if (this.state.expanded) {
			const lines = this.mode === "thought" ? renderThoughtBody(this.members, this.theme, width) : this.members.flatMap((member) => renderMember(this.mode, member, width));
			if (this.mode !== "thought" || lines.length > 0) {
				if (lines.length === 0 || lines[0] !== "") lines.unshift("");
				return lines;
			}
		}
		const title = this.title();
		const frames = ["◐", "◓", "◑", "◒"];
		const quiet = this.mode === "thought";
		const markChar = title.failed ? "✗" : title.running ? frames[Math.floor(Date.now() / 160) % frames.length]! : quiet ? "•" : "●";
		const mark = paint(this.theme, title.failed ? "error" : title.running ? "accent" : quiet ? "dim" : "success", markChar);
		return ["", truncateToWidth(`${mark} ${title.text}`, Math.max(1, width), "…")];
	}
}

function stateFor(key: object, states: WeakMap<object, GroupState>): GroupState {
	let state = states.get(key);
	if (!state) {
		const expanded = (key as { expanded?: boolean }).expanded === true;
		state = { expanded, lastHostExpanded: expanded };
		states.set(key, state);
	}
	return state;
}

export function groupChildren(children: readonly unknown[], theme: Theme | undefined, states: WeakMap<object, GroupState>): unknown[] {
	const grouped: unknown[] = [];
	let run: "look" | "edit" | undefined;
	let rows: ToolView[] = [];
	let members: unknown[] = [];
	let pending: unknown[] = [];
	let fileKey = "";
	const flush = () => {
		if (rows.length > 0 && run) {
			members.push(...pending);
			pending = [];
			grouped.push(new SummaryGroup(run, rows, members as Member[], stateFor(rows[0]!, states), theme));
		} else if (members.length > 0) grouped.push(...members);
		run = undefined;
		rows = [];
		members = [];
		fileKey = "";
	};
	const emitShell = (child: ToolExecutionComponent) => {
		flush();
		grouped.push(new SummaryGroup("shell", [toolView(child)], [...pending, child] as Member[], stateFor(child, states), theme));
		pending = [];
	};
	for (const child of children) {
		if (isLookup(child)) {
			if (run === "edit") flush();
			run = "look";
			rows.push(toolView(child));
			members.push(...pending, child);
			pending = [];
			continue;
		}
		if (isEdit(child)) {
			const path = editFile(toolView(child));
			if (run === "look" || (run === "edit" && fileKey !== "" && path !== "" && path !== fileKey)) flush();
			run = "edit";
			if (path) fileKey = path;
			rows.push(toolView(child));
			members.push(...pending, child);
			pending = [];
			continue;
		}
		if (isShell(child)) {
			emitShell(child);
			continue;
		}
		if (isThinkingOnly(child)) {
			flush();
			grouped.push(new SummaryGroup("thought", [], [...pending, child] as Member[], stateFor(child, states), theme));
			pending = [];
			continue;
		}
		if (child instanceof ToolExecutionComponent) {
			flush();
			grouped.push(new SummaryGroup("tool", [toolView(child)], [...pending, child] as Member[], stateFor(child, states), theme));
			pending = [];
			continue;
		}
		if (isBlank(child) && (rows.length > 0 || pending.length > 0)) {
			pending.push(child);
			continue;
		}
		flush();
		grouped.push(...pending, child);
		pending = [];
	}
	flush();
	grouped.push(...pending);
	return grouped;
}

function findChat(tui: unknown): Chat | undefined {
	const documentChildren = (tui as { children?: Array<{ children?: unknown[] }> }).children?.[0]?.children;
	const chat = Array.isArray(documentChildren) ? documentChildren.at(-1) : undefined;
	if (typeof chat !== "object" || chat === null || typeof (chat as Chat).render !== "function" || !Array.isArray((chat as Chat).children)) return undefined;
	return chat as Chat;
}

function ensureChatHook(tui: unknown, theme: Theme | undefined): void {
	const chat = findChat(tui) as (Chat & Record<PropertyKey, unknown>) | undefined;
	if (!chat) return;
	let slot = chat[HOOK_KEY] as Slot | undefined;
	if (!slot) {
		slot = {
			theme,
			states: new WeakMap(),
			render: () => [],
		};
		chat[HOOK_KEY] = slot;
	}
	slot.theme = theme;
	slot.render = (self, width) => {
		const previous = self.children;
		self.children = groupChildren(previous, slot!.theme, slot!.states);
		try {
			return Container.prototype.render.call(self, width);
		} finally {
			self.children = previous;
		}
	};
	const current = chat.render as ((width: number) => string[]) & Record<PropertyKey, unknown>;
	if (current?.[WRAP_MARK] === slot) return;
	const wrapped = function (this: Chat, width: number) {
		return slot!.render(this, width);
	};
	(wrapped as { [WRAP_MARK]?: Slot })[WRAP_MARK] = slot;
	chat.render = wrapped;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => ({
			render: () => {
				ensureChatHook(tui, (ctx.ui.theme as Theme | undefined) ?? (theme as Theme | undefined));
				return [];
			},
			invalidate() {},
		}), { placement: "belowEditor" });
	});

	pi.on("session_shutdown", (_event, ctx) => {
		ctx.ui.setWidget(WIDGET_KEY, undefined);
	});
}
