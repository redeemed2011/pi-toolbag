/** The provider sentence on a failed turn. A JSON error body yields its message, not the raw blob. */
export function cancelReason(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const raw = (message as { errorMessage?: unknown }).errorMessage;
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const body = JSON.parse(trimmed.slice(jsonStart)) as { error?: { message?: unknown }; message?: unknown };
      const inner = body.error?.message ?? body.message;
      if (typeof inner === "string" && inner.trim()) return inner.trim();
    } catch {
      // The raw text is the reason.
    }
  }
  return trimmed;
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
