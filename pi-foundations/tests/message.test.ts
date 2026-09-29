import { describe, expect, it } from "vitest";
import { ritualTurn, stripFrontmatter } from "../src/message.js";

describe("stripFrontmatter", () => {
	it("drops a leading frontmatter block", () => {
		const body = stripFrontmatter("---\nname: x\n---\n\n# Title\n");
		expect(body).toBe("# Title");
	});

	it("leaves a body that has no frontmatter", () => {
		expect(stripFrontmatter("# Title\n")).toBe("# Title");
	});
});

describe("ritualTurn", () => {
	it("puts the topic and the procedure in the same turn", () => {
		const text = ritualTurn("Ask question 0.", "ship the widget");
		expect(text.startsWith("Topic: ship the widget")).toBe(true);
		expect(text).toContain("Ask question 0.");
		expect(text).toContain("The contract file is the finished state.");
	});

	it("asks question 0 when no topic was passed", () => {
		expect(ritualTurn("body", "  ")).toContain("ask question 0 and stop");
	});
});
