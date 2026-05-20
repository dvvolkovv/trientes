import { describe, it, expect } from "vitest";
import { parseStreamLine } from "../streamParser";

describe("parseStreamLine", () => {
  it("recognises init event with session_id", () => {
    const ev = parseStreamLine(
      JSON.stringify({ type: "system", subtype: "init", session_id: "abc" }),
    );
    expect(ev).toEqual({ kind: "init", sessionId: "abc" });
  });

  it("recognises assistant tool_use event", () => {
    const ev = parseStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Read",
              input: { file_path: "/x/y.ts" },
            },
          ],
        },
      }),
    );
    expect(ev).toEqual({
      kind: "tool_use",
      toolName: "Read",
      input: { file_path: "/x/y.ts" },
    });
  });

  it("recognises assistant text event", () => {
    const ev = parseStreamLine(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "hello" }] },
      }),
    );
    expect(ev).toEqual({ kind: "text", text: "hello" });
  });

  it("recognises result event", () => {
    const ev = parseStreamLine(
      JSON.stringify({ type: "result", subtype: "success", is_error: false }),
    );
    expect(ev).toEqual({ kind: "result", isError: false });
  });

  it("returns unknown for unrecognised shape", () => {
    const ev = parseStreamLine(JSON.stringify({ type: "weird" }));
    expect(ev?.kind).toBe("unknown");
  });

  it("returns null for empty / blank lines", () => {
    expect(parseStreamLine("")).toBeNull();
    expect(parseStreamLine("   ")).toBeNull();
  });

  it("returns unknown for invalid JSON (does not throw)", () => {
    const ev = parseStreamLine("{not json");
    expect(ev?.kind).toBe("unknown");
  });
});
