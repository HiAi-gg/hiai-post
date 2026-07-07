import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["tests/e2e/**"],
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
