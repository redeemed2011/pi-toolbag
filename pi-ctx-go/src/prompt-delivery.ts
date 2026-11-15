export type BarePrompt = {
  idle: boolean;
  streamingBehavior?: "steer" | "followUp";
  text: string;
};

/**
 * Text stored while the agent was idle can be sent after a run has started.
 * Queue that prompt. A prompt that already names steer or followUp is left alone.
 */
export function barePromptAction(prompt: BarePrompt): "continue" | "followUp" {
  if (prompt.streamingBehavior) return "continue";
  if (prompt.idle) return "continue";
  if (!prompt.text.trim()) return "continue";
  return "followUp";
}

/** Re-sends a bare prompt as a follow-up. A prompt that already has a delivery is not sent again. */
export async function settleBarePrompt(prompt: BarePrompt, send: (text: string) => Promise<void>): Promise<"continue" | "handled"> {
  if (barePromptAction(prompt) !== "followUp") return "continue";
  await send(prompt.text);
  return "handled";
}
