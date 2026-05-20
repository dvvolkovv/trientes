import type { StreamEvent } from "./types";

export function parseStreamLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return { kind: "unknown", raw: trimmed };
  }

  if (!obj || typeof obj !== "object") {
    return { kind: "unknown", raw: obj };
  }
  const o = obj as Record<string, unknown>;

  if (o.type === "system" && o.subtype === "init" && typeof o.session_id === "string") {
    return { kind: "init", sessionId: o.session_id };
  }

  if (o.type === "assistant" && o.message && typeof o.message === "object") {
    const content = (o.message as Record<string, unknown>).content;
    if (Array.isArray(content) && content.length > 0) {
      const first = content[0] as Record<string, unknown>;
      if (first.type === "tool_use" && typeof first.name === "string") {
        return {
          kind: "tool_use",
          toolName: first.name,
          input: first.input,
        };
      }
      if (first.type === "text" && typeof first.text === "string") {
        return { kind: "text", text: first.text };
      }
    }
  }

  if (o.type === "result") {
    return { kind: "result", isError: o.is_error === true };
  }

  return { kind: "unknown", raw: obj };
}
