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
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared"),
      "@": path.resolve(__dirname, "../client/src"),
    },
  },
});
