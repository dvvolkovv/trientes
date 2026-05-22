import { describe, it, expect } from "vitest";
import { parseAttachments } from "../attachments";

describe("parseAttachments", () => {
  it("returns text unchanged when no marker present", () => {
    const { text, paths } = parseAttachments("hello world");
    expect(text).toBe("hello world");
    expect(paths).toEqual([]);
  });

  it("extracts a single attachment line and removes it from text", () => {
    const input = "see attached\n📎 attach: /tmp/spec.md\nthat's it";
    const { text, paths } = parseAttachments(input);
    expect(paths).toEqual(["/tmp/spec.md"]);
    expect(text).toBe("see attached\nthat's it");
  });

  it("extracts multiple attachments in order", () => {
    const input =
      "report:\n📎 attach: /a.md\nmore notes\n📎 attach: /b.png\nend";
    const { text, paths } = parseAttachments(input);
    expect(paths).toEqual(["/a.md", "/b.png"]);
    expect(text).toBe("report:\nmore notes\nend");
  });

  it("trims whitespace around the path", () => {
    const { paths } = parseAttachments("📎 attach:    /tmp/spec.md   ");
    expect(paths).toEqual(["/tmp/spec.md"]);
  });

  it("ignores marker not at line start", () => {
    const input = "inline mention 📎 attach: /tmp/x.md should be ignored";
    const { text, paths } = parseAttachments(input);
    expect(paths).toEqual([]);
    expect(text).toBe(input);
  });

  it("collapses leading/trailing blank lines left after removal", () => {
    const input = "📎 attach: /only.md";
    const { text, paths } = parseAttachments(input);
    expect(paths).toEqual(["/only.md"]);
    expect(text).toBe("");
  });
});
