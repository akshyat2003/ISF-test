import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Each test file creates and drops its own database, so files can run in parallel.
    fileParallelism: true,
  },
});
