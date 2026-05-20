import { vi } from "vitest";

// Allow vi.spyOn to work on node:child_process by mocking it through
// Vitest's module registry (which uses a mutable proxy instead of the
// sealed ESM namespace).
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual };
});
