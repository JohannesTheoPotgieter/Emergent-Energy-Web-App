import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["qa/tests/**/*.test.ts", "qa/tests/**/*.spec.ts"],
    testTimeout: 30000,
    reporters: ["default", "json"],
    outputFile: "qa/reports/vitest-results.json",
    coverage: {
      provider: "v8",
      thresholds: {
        statements: 30,
        branches: 25,
        functions: 30,
        lines: 30,
      },
    },
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared"),
      "@": path.resolve(__dirname, "../client/src"),
    },
  },
});
