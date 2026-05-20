import { describe, it, expect } from "vitest";
import { isAllowed } from "../auth";

describe("isAllowed", () => {
  it("returns true for listed user", () => {
    expect(isAllowed(111, new Set([111, 222]))).toBe(true);
  });
  it("returns false for non-listed user", () => {
    expect(isAllowed(333, new Set([111, 222]))).toBe(false);
  });
  it("returns false for empty whitelist", () => {
    expect(isAllowed(111, new Set())).toBe(false);
  });
});
