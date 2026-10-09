import {
	AssistantMessageComponent,
	renderDiff,
	ToolExecutionComponent,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { renderHashlineResult, type HashlinePainters } from "./diff-render.ts";
import { loadSplitPaint } from "./split-paint.ts";

/**
 * Fold a consecutive run of read, search, and list tool calls into one row.
 * The finished line counts each kind, in the order it first appeared:
 * `Searched 2 patterns, Listed 1 dir, Read 1 file`.
 * While any call in the run is still going, the verbs stay progressive.
 * A shell command is its own `Ran` row and splits the run.
 * A thought is its own row, and so is any other tool. Consecutive edits of one file become `Edited <file> +N/-M`.
 * pi-droid-styling owns the working row. Its default badge then replaces any
 * non-builtin result with the raw text, so a finished hashline edit puts the
 * rich diff back. A changed diff shape keeps that raw text.
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

/** Lines in a finished write. The expanded card counts `content.split("\n")` the same way. */
function writtenLineCount(row: ToolView): number | undefined {
	if (row.toolName !== "write" || phase(row) !== "done") return undefined;
	const content = argsOf(row).content;
	if (typeof content !== "string" || content.length === 0) return undefined;
	return content.split("\n").length;
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
		if (typeof metrics?.added_lines === "number") added += metrics.added_lines;
		else added += writtenLineCount(row) ?? 0;
		removed += metrics?.removed_lines ?? 0;
		if (phase(row) === "error") failed += 1;
	}
	const name = file ? baseName(file) : `${rows.length} ${rows.length === 1 ? "call" : "calls"}`;
	return { text: `${running ? "Editing" : "Edited"} ${name}`, running, failed, added, removed };
}

/** ` +N`, ` -M`, or ` +N` plus `/-M`. The slash only separates both counts. */
export function editCountParts(added: number, removed: number): { added: string; removed: string } {
	if (added > 0 && removed > 0) return { added: ` +${added}`, removed: `/-${removed}` };
	if (added > 0) return { added: ` +${added}`, removed: "" };
	if (removed > 0) return { added: "", removed: ` -${removed}` };
	return { added: "", removed: "" };
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
			const verb = paint(this.theme, line.failed ? "error" : "toolTitle", bold(this.theme, line.verb));
			const command = line.command ? ` ${paint(this.theme, "dim", line.command)}` : "";
			return { text: `${verb}${command}`, running: line.running, failed: line.failed };
		}
		if (this.mode === "edit") {
			const summary = summarizeEdit(this.rows);
			const body = paint(this.theme, "toolTitle", bold(this.theme, summary.text));
			const counts = editCountParts(summary.added, summary.removed);
			const stat = !summary.running
				? `${counts.added ? paint(this.theme, "success", counts.added) : ""}${counts.removed ? paint(this.theme, "error", counts.removed) : ""}`
				: "";
			const fail = summary.failed > 0 ? paint(this.theme, "error", ` · ${summary.failed} failed`) : "";
			return { text: `${body}${stat}${summary.running ? "…" : ""}${fail}`, running: summary.running, failed: summary.failed > 0 };
		}
		if (this.mode === "tool") {
			const row = this.rows[0]!;
			const running = phase(row) === "running";
			const failed = phase(row) === "error";
			const name = paint(this.theme, failed ? "error" : "toolTitle", bold(this.theme, formatToolName(row.toolName)));
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
		const body = paint(this.theme, "toolTitle", bold(this.theme, summary.text));
		const fail = summary.failed > 0 ? paint(this.theme, "error", ` · ${summary.failed} failed`) : "";
		return { text: `${body}${summary.running ? "…" : ""}${fail}`, running: summary.running, failed: summary.failed > 0 };
	}

	setExpanded(expanded: boolean): void {
		this.state.expanded = expanded;
		this.invalidate();
	}

	/** A global expand writes the tool flag. A click on this row writes group state. Keep whichever changed. */
	private syncExpanded(): void {
		const host = this.rows[0];
		if (host && host.expanded !== this.state.lastHostExpanded) this.state.expanded = host.expanded;
		revealTools(this.rows, this.state.expanded);
		this.state.lastHostExpanded = this.state.expanded;
	}

	render(width: number): string[] {
		this.syncExpanded();
		if (this.state.expanded) {
			const lines = this.mode === "thought" ? renderThoughtBody(this.members, this.theme, width) : this.members.flatMap((member) => renderMember(this.mode, member, width));
			if (this.mode !== "thought" || lines.length > 0) {
				if (lines.length === 0 || lines[lines.length - 1] !== "") lines.push("");
				return lines;
			}
		}
		const title = this.title();
		const frames = ["◐", "◓", "◑", "◒"];
		const quiet = this.mode === "thought";
		const markChar = title.failed ? "✗" : title.running ? frames[Math.floor(Date.now() / 160) % frames.length]! : quiet ? "•" : "●";
		const mark = paint(this.theme, title.failed ? "error" : title.running ? "accent" : quiet ? "dim" : "success", markChar);
		return [truncateToWidth(`${mark} ${title.text}`, Math.max(1, width), "…"), ""];
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
			const spacers = pending;
			pending = [];
			const thoughtMembers = [...spacers, child] as Member[];
			if (thoughtStreaming(thoughtMembers) || thoughtText(thoughtMembers)) {
				grouped.push(new SummaryGroup("thought", [], thoughtMembers, stateFor(child, states), theme));
			} else if (spacers.length > 0) grouped.push(...spacers);
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

const DIFF_PATCH = Symbol.for("pi.tool-groups.hashline-diff");
const DIFF_TOOLS = new Set(["replace", "replace_match", "insert", "copy", "move", "undo_last_change"]);
type ResultRenderer = (result: unknown, options: unknown, theme: unknown, context: unknown) => { render?: (width: number) => string[] } | undefined;

let splitPaint: HashlinePainters["split"] | undefined;

function unifiedPaint(gutter: string): string[] | null {
	try {
		const text = renderDiff(gutter);
		return typeof text === "string" && text.length > 0 ? text.split("\n") : null;
	} catch {
		return null;
	}
}

function loadSplitPainter(): void {
	if (splitPaint !== undefined) return;
	splitPaint = null;
	void loadSplitPaint().then((paint) => {
		splitPaint = paint;
	}).catch(() => {
		splitPaint = null;
	});
}

function installDiffRenderer(): void {
	const proto = ToolExecutionComponent.prototype as unknown as {
		getResultRenderer?: ((this: { toolName?: string }, ...args: unknown[]) => ResultRenderer | undefined) & Record<PropertyKey, unknown>;
	};
	const current = proto.getResultRenderer;
	if (typeof current !== "function" || current[DIFF_PATCH] === true) return;
	function wrapped(this: { toolName?: string }, ...args: unknown[]) {
		const original = current!.apply(this, args);
		if (!DIFF_TOOLS.has(this.toolName ?? "")) return original;
		return (result: unknown, options: unknown, theme: unknown, context: unknown) => ({
			render(width: number) {
				return renderHashlineResult(result as { details?: { diff?: unknown; diffLineNumbers?: unknown } }, width, theme, {
					split: splitPaint ?? null,
					unified: (gutter) => unifiedPaint(gutter),
				}, () => {
					try {
						const lines = original?.(result, options, theme, context)?.render?.(width);
						return Array.isArray(lines) ? lines : [];
					} catch {
						return [];
					}
				});
			},
			invalidate() {},
		});
	}
	(wrapped as { [DIFF_PATCH]?: boolean })[DIFF_PATCH] = true;
	proto.getResultRenderer = wrapped as typeof current;
}

const DISPLAY_PATCH = Symbol.for("pi.tool-groups.hashline-display");
let activeTheme: Theme | undefined;

type DiffShell = { clear?: () => void; addChild?: (child: unknown) => void };
type DiffHost = {
	toolName?: string;
	args?: unknown;
	result?: { content?: unknown; details?: { diff?: unknown; diffLineNumbers?: unknown; warnings?: string[] }; isError?: boolean };
	isPartial?: boolean;
	contentBox?: DiffShell;
	selfRenderContainer?: DiffShell;
	getRenderShell?: () => string;
};

function resultLines(result: DiffHost["result"]): string[] {
	const content = result?.content;
	if (!Array.isArray(content)) return [];
	const text = content
		.filter((block): block is { type: string; text?: string } => Boolean(block) && typeof block === "object" && (block as { type?: string }).type === "text")
		.map((block) => String(block.text ?? ""))
		.join("\n")
		.replace(/\r/g, "")
		.trimEnd();
	return text.length > 0 ? text.split("\n") : [];
}

function paramLine(args: unknown): string {
	if (!args || typeof args !== "object" || Array.isArray(args)) return "";
	const parts: string[] = [];
	for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
		if (typeof value !== "string" || value.length === 0) continue;
		const flat = value.replace(/\s+/g, " ");
		const shown = flat.length > 60 ? `${flat.slice(0, 57)}…` : flat;
		const spaced = key.replace(/[_-]+/g, " ").trim();
		const label = spaced.length > 0 ? spaced[0]!.toUpperCase() + spaced.slice(1) : key;
		parts.push(`${label}: ${shown}`);
	}
	return parts.join(" ");
}

/** Header plus the rich diff. Droid's badge is replaced by this after it paints the raw text. */
export function hashlineCardLines(host: DiffHost, width: number, theme: Theme | undefined): string[] {
	const failed = host.result?.isError === true;
	const mark = paint(theme, failed ? "error" : "success", failed ? "✗" : "●");
	const title = paint(theme, failed ? "error" : "toolTitle", bold(theme, formatToolName(host.toolName ?? "edit")));
	const args = paramLine(host.args);
	const header = truncateToWidth(`${mark} ${title}${args ? ` ${args}` : ""}`, Math.max(1, width), "…");
	const body = renderHashlineResult(host.result ?? {}, Math.max(1, width - 5), theme, {
		split: splitPaint ?? null,
		unified: (gutter) => unifiedPaint(gutter),
	}, () => resultLines(host.result));
	const warnings = host.result?.details?.warnings?.filter((line) => line.length > 0) ?? [];
	return [
		header,
		...body.map((line, index) => truncateToWidth(index === 0 ? `  └─ ${line}` : `     ${line}`, Math.max(1, width), "…")),
		...warnings.map((line) => truncateToWidth(`     ${line}`, Math.max(1, width), "…")),
	];
}

export function placeRichDiff(host: DiffHost): void {
	if (!host.toolName || !DIFF_TOOLS.has(host.toolName) || !host.result || host.isPartial) return;
	const shell = host.getRenderShell?.() === "self" ? host.selfRenderContainer : host.contentBox;
	if (!shell || typeof shell.clear !== "function" || typeof shell.addChild !== "function") return;
	shell.clear();
	shell.addChild({
		invalidate() {},
		render(width: number) {
			return hashlineCardLines(host, width, activeTheme);
		},
	});
}

function installDisplayPatch(): void {
	const proto = ToolExecutionComponent.prototype as unknown as {
		updateDisplay?: ((this: DiffHost, ...args: unknown[]) => unknown) & Record<PropertyKey, unknown>;
	};
	const current = proto.updateDisplay;
	if (typeof current !== "function" || current[DISPLAY_PATCH] === true) return;
	function wrapped(this: DiffHost, ...args: unknown[]) {
		const result = current!.apply(this, args);
		try {
			placeRichDiff(this);
		} catch {
			// Droid's card stays if the diff cannot be mounted.
		}
		return result;
	}
	(wrapped as { [DISPLAY_PATCH]?: boolean })[DISPLAY_PATCH] = true;
	proto.updateDisplay = wrapped as typeof current;
}

function findChat(tui: unknown): Chat | undefined {
	const documentChildren = (tui as { children?: Array<{ children?: unknown[] }> }).children?.[0]?.children;
	const chat = Array.isArray(documentChildren) ? documentChildren.at(-1) : undefined;
	if (typeof chat !== "object" || chat === null || typeof (chat as Chat).render !== "function" || !Array.isArray((chat as Chat).children)) return undefined;
	return chat as Chat;
}

function ensureChatHook(tui: unknown, theme: Theme | undefined): void {
	activeTheme = theme;
	installDiffRenderer();
	installDisplayPatch();
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
	loadSplitPainter();
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
