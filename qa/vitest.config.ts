import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: [path.resolve(__dirname, "setup-jsdom-polyfills.ts")],
    include: ["qa/tests/**/*.test.ts", "qa/tests/**/*.test.tsx", "qa/tests/**/*.spec.ts"],
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
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared"),
      "@": path.resolve(__dirname, "../client/src"),
    },
  },
});
