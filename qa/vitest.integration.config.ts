import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["qa/tests/integration/migration-execution.test.ts"],
    testTimeout: 300_000, // 5 min — migrations are slow
    hookTimeout: 300_000,
    reporters: ["default", "json"],
    outputFile: "qa/reports/vitest-integration-results.json",
    pool: "forks",      // Isolate from other tests; single process for DB state
    poolOptions: {
      forks: { singleFork: true },
    },
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared"),
      "@": path.resolve(__dirname, "../client/src"),
    },
  },
});
