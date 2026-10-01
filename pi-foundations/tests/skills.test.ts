import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readSkill } from "../index.js";
import { stripFrontmatter } from "../src/message.js";
import { PRINCIPLES_CONTRACT, QUESTIONS_CONTRACT, RITUALS } from "../src/paths.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function skill(name: string): string {
	return readFileSync(join(root, "skills", name, "SKILL.md"), "utf8");
}

describe("ritual skills", () => {
	it("names both rituals", () => {
		expect(RITUALS).toEqual(["first-questions", "first-principles"]);
	});

	it("keeps the first-questions finished state", () => {
		const text = skill("first-questions");
		expect(text).toContain(QUESTIONS_CONTRACT);
		expect(text).toContain("KEPT");
		expect(text).toContain("MODIFIED to X");
		expect(text).toContain("DELETED");
		expect(text).toContain("DEFERRED");
		expect(text).toContain("The user really wants this");
		expect(stripFrontmatter(text).startsWith("# /first-questions")).toBe(true);
	});

	it("routes first-questions when warranted, not for every task", () => {
		const raw = skill("first-questions");
		const frontmatter = raw.slice(0, raw.indexOf("\n---\n", 4));
		const description = frontmatter
			.split("\n")
			.slice(1)
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith("name:") && !line.startsWith("description:"))
			.join(" ");
		expect(description).toContain("more than one outcome");
		expect(description).toContain("Do not use for one bounded task");
		expect(description).toContain("Start with /first-questions only in those cases.");
		expect(description).not.toContain("Before planning, research, design, or code");
	});

	it("keeps the first-principles finished state", () => {
		const text = skill("first-principles");
		expect(text).toContain(PRINCIPLES_CONTRACT);
		expect(text).toContain(QUESTIONS_CONTRACT);
		expect(text).toContain("Reconstructed minimal solution");
		expect(text).toContain("Explicitly rejected approaches");
		expect(text).toContain("Hypothesis (needs research)");
		expect(text).toContain("run `/first-questions`");
	});

	it("finishes the file before any ctx write, and does not wait on bind", () => {
		for (const name of RITUALS) {
			const text = skill(name);
			expect(text).toContain("The file is the contract.");
			expect(text).toContain("Do not stop the ritual to run `/ctx bind`.");
			expect(text).toContain('`applies_to` is `"all"`.');
			expect(text).toContain("Do not mint one record per");
			expect(text).toContain("On `gate`, do not supersede");
			expect(text).toContain("Mint only when `ctx_get` returns `gate` 0.");
			expect(text).toContain("refuse write");
			expect(text).not.toContain("bind before");
		}
	});

	it("loads the procedure the command sends", () => {
		expect(readSkill("first-questions").startsWith("# /first-questions")).toBe(true);
		expect(readSkill("first-principles").startsWith("# /first-principles")).toBe(true);
		expect(skill("first-questions")).toContain("oldest six");
	});
});
