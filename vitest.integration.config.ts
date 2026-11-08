import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["integration-tests/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 30_000,
  },
});
