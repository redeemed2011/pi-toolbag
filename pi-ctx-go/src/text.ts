export function twoLines(text: string): string {
  return text.split("\n").slice(0, 2).join("\n").trim();
}

export function messageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const rec = part as { type?: string; text?: string };
    if (rec.type === "text" && typeof rec.text === "string" && rec.text.length > 0) parts.push(rec.text);
  }
  return parts.join("\n");
}
