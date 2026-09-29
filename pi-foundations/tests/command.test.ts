import { describe, expect, it } from "vitest";
import { registerFoundations, type SkillReader } from "../index.js";
import type { RitualName } from "../src/paths.js";

type Handler = (args: string, ctx: FakeCtx) => Promise<void>;

interface FakeCtx {
	hasUI: boolean;
	isIdle: () => boolean;
	ui: { notify: (message: string, level: string) => void };
}

function harness(read: SkillReader): {
	commands: Map<string, { description?: string; handler: Handler }>;
	sent: { content: string; options: unknown }[];
} {
	const commands = new Map<string, { description?: string; handler: Handler }>();
	const sent: { content: string; options: unknown }[] = [];
	const pi = {
		registerCommand(name: string, options: { description?: string; handler: Handler }) {
			commands.set(name, options);
		},
		sendUserMessage(content: string, options?: unknown) {
			sent.push({ content, options });
		},
	};
	registerFoundations(pi as never, read);
	return { commands, sent };
}

const readOk: SkillReader = (name: RitualName) => `procedure ${name}`;

describe("registerFoundations", () => {
	it("sends the procedure as the user turn", async () => {
		const { commands, sent } = harness(readOk);
		const notes: string[] = [];
		await commands.get("first-questions")!.handler("ship the widget", {
			hasUI: true,
			isIdle: () => true,
			ui: { notify: (message) => notes.push(message) },
		});
		expect(commands.has("first-principles")).toBe(true);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.content).toContain("Topic: ship the widget");
		expect(sent[0]?.content).toContain("procedure first-questions");
		expect(sent[0]?.options).toBeUndefined();
		expect(notes).toEqual(["first-questions started"]);
	});

	it("queues behind an active turn", async () => {
		const { commands, sent } = harness(readOk);
		await commands.get("first-principles")!.handler("", {
			hasUI: false,
			isIdle: () => false,
			ui: { notify: () => undefined },
		});
		expect(sent[0]?.options).toEqual({ deliverAs: "followUp" });
		expect(sent[0]?.content).toContain("ask question 0 and stop");
	});

	it("reports a send failure after saying the ritual started", async () => {
		const commands = new Map<string, { handler: Handler }>();
		const pi = {
			registerCommand(name: string, options: { handler: Handler }) {
				commands.set(name, options);
			},
			sendUserMessage() {
				return Promise.reject(new Error("no model"));
			},
		};
		registerFoundations(pi as never, readOk);
		const notes: string[] = [];
		await commands.get("first-questions")!.handler("ship the widget", {
			hasUI: true,
			isIdle: () => true,
			ui: { notify: (message) => notes.push(message) },
		});
		expect(notes).toEqual(["first-questions started", "first-questions: no model"]);
	});

	it("does not start a turn when the procedure cannot be read", async () => {
		const { commands, sent } = harness(() => {
			throw new Error("missing skill");
		});
		const notes: string[] = [];
		await commands.get("first-questions")!.handler("", {
			hasUI: true,
			isIdle: () => true,
			ui: { notify: (message) => notes.push(message) },
		});
		expect(sent).toHaveLength(0);
		expect(notes[0]).toContain("missing skill");
	});
});
