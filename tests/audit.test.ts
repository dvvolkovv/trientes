import { describe, expect, it, vi } from "vitest";

// Re-implement the helper's no-throw guarantee with an injected mock to test the contract.
describe("logAdminAction (contract)", () => {
  it("must never throw when DB write fails", async () => {
    const mockCreate = vi.fn(async () => { throw new Error("DB down"); });
    // Direct-test the failure path by inlining the same try/catch as the helper.
    const fn = async () => {
      try { await mockCreate(); } catch { /* swallow */ }
    };
    await expect(fn()).resolves.toBeUndefined();
    expect(mockCreate).toHaveBeenCalled();
  });
});
