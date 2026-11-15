import { describe, expect, it } from "vitest";
import { barePromptAction, settleBarePrompt } from "../src/prompt-delivery.js";

describe("bare prompt during a run", () => {
  it("queues text that was stored while idle once a run is active", async () => {
    expect(barePromptAction({ idle: true, text: "keep going" })).toBe("continue");
    expect(barePromptAction({ idle: false, text: "keep going" })).toBe("followUp");
    expect(barePromptAction({ idle: false, streamingBehavior: "steer", text: "keep going" })).toBe("continue");
    expect(barePromptAction({ idle: false, streamingBehavior: "followUp", text: "keep going" })).toBe("continue");
    expect(barePromptAction({ idle: false, text: "  " })).toBe("continue");

    const sent: string[] = [];
    const send = async (text: string) => {
      sent.push(text);
    };
    expect(await settleBarePrompt({ idle: false, text: "keep going" }, send)).toBe("handled");
    expect(sent).toEqual(["keep going"]);
    expect(await settleBarePrompt({ idle: true, text: "keep going" }, send)).toBe("continue");
    expect(await settleBarePrompt({ idle: false, streamingBehavior: "steer", text: "now" }, send)).toBe("continue");
    expect(sent).toEqual(["keep going"]);
  });
});
