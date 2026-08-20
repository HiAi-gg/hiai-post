import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 9,
      },
    },
  },
});
