import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-next";

describe("safeNext", () => {
  it("keeps a same-origin path", () => {
    expect(safeNext("/ru/invite/abc", "ru")).toBe("/ru/invite/abc");
  });
  it("falls back for missing or non-string input", () => {
    expect(safeNext(undefined, "en")).toBe("/en/cabinet");
    expect(safeNext(42, "en")).toBe("/en/cabinet");
  });
  it("rejects absolute URLs", () => {
    expect(safeNext("https://evil.com", "en")).toBe("/en/cabinet");
  });
  it("rejects protocol-relative URLs", () => {
    expect(safeNext("//evil.com", "en")).toBe("/en/cabinet");
    expect(safeNext("/\\evil.com", "en")).toBe("/en/cabinet");
  });
});
