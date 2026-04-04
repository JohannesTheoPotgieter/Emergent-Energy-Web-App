import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Validates that bridge write calls use bridgeCatch instead of bare .catch(() => {}).
 * Bare catch swallows bridge failures silently — bridgeCatch logs a warning
 * and increments a counter for monitoring.
 */
describe("Bridge write catch handler enforcement", () => {
  const serverDir = path.resolve(__dirname, "../../../server");

  // Files that contain bridge write calls
  const bridgeCallerFiles = [
    "services/project-write-service.ts",
    "services/finance-line-write-service.ts",
    "services/client-write-service.ts",
    "services/stage-lifecycle-service.ts",
    "lib/project-info-sync.ts",
    "change-control-routes.ts",
    "lifecycle-routes.ts",
    "smart-import-routes.ts",
    "subcontractor-routes.ts",
    "deliverable-capture-routes.ts",
    "routes.ts",
  ];

  for (const file of bridgeCallerFiles) {
    it(`${file} uses bridgeCatch instead of bare .catch(() => {}) for bridge calls`, () => {
      const filePath = path.join(serverDir, file);
      const src = fs.readFileSync(filePath, "utf-8");
      const lines = src.split("\n");

      // Find lines with bridge-related function names followed by .catch(() => {})
      const bridgeFunctionPattern =
        /sync(Project|Client|CostLine|RevenueLine|ChangeRequest|User|ProjectInsert|ProjectDelete|ProjectExecutionState|CostLineFieldUpdate|RevenueLineFieldUpdate|CostLineCounterpartyBulk)|softClose|cascadeDelete|batchSync|snapshotProjectState|softDeleteChangeRequest/;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comments
        if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;

        // Check if this line (or nearby lines) contains a bridge call with bare catch
        if (bridgeFunctionPattern.test(line) && /\.catch\(\(\)\s*=>\s*\{\s*\}\)/.test(line)) {
          throw new Error(
            `${file}:${i + 1} has a bare .catch(() => {}) on a bridge call. Use .catch(bridgeCatch) instead.\n` +
            `  Line: ${line.trim()}`,
          );
        }
      }
    });
  }

  it("bridgeCatch is exported from bridge-writer", () => {
    const bridgeWriterPath = path.join(serverDir, "bridge/bridge-writer.ts");
    const src = fs.readFileSync(bridgeWriterPath, "utf-8");
    expect(src).toContain("export function bridgeCatch");
    expect(src).toContain("export function getBridgeFailureCount");
    expect(src).toContain("export function resetBridgeFailureCount");
  });

  it("bridgeCatch logs a warning and increments counter", () => {
    const bridgeWriterPath = path.join(serverDir, "bridge/bridge-writer.ts");
    const src = fs.readFileSync(bridgeWriterPath, "utf-8");
    expect(src).toContain("console.warn");
    expect(src).toContain("_bridgeFailureCount++");
  });
});
