import { defineConfig, configDefaults } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "bot/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
    setupFiles: ["./bot/__tests__/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
