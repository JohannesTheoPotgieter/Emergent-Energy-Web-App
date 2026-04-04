import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Validates that bridge write calls use bridgeCatch instead of bare .catch(() => {}).
 * Bare catch swallows bridge failures silently — bridgeCatch logs a structured
 * warning, increments a counter, persists to internal.bridge_sync_failures,
 * and keeps a ring buffer for the health endpoint.
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
    "storage.ts",
    "sync-routes.ts",
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

  it("bridgeCatch logs structured JSON warning and increments counter", () => {
    const bridgeWriterPath = path.join(serverDir, "bridge/bridge-writer.ts");
    const src = fs.readFileSync(bridgeWriterPath, "utf-8");
    expect(src).toContain("console.warn(JSON.stringify");
    expect(src).toContain("_bridgeFailureCount++");
    expect(src).toContain("bridge_catch_failure");
  });

  it("bridgeCatch persists failures to internal.bridge_sync_failures", () => {
    const bridgeWriterPath = path.join(serverDir, "bridge/bridge-writer.ts");
    const src = fs.readFileSync(bridgeWriterPath, "utf-8");
    expect(src).toContain("persistBridgeCatchFailure");
    expect(src).toContain("INSERT INTO internal.bridge_sync_failures");
  });

  it("bridgeCatch keeps an in-memory ring buffer of recent failures", () => {
    const bridgeWriterPath = path.join(serverDir, "bridge/bridge-writer.ts");
    const src = fs.readFileSync(bridgeWriterPath, "utf-8");
    expect(src).toContain("_recentFailures");
    expect(src).toContain("MAX_RECENT_FAILURES");
    expect(src).toContain("export function getRecentBridgeFailures");
  });
});

describe("Bridge retry queue", () => {
  const serverDir = path.resolve(__dirname, "../../../server");

  it("processBridgeRetryQueue is exported", () => {
    const src = fs.readFileSync(path.join(serverDir, "bridge/bridge-writer.ts"), "utf-8");
    expect(src).toContain("export async function processBridgeRetryQueue");
  });

  it("retry queue has max retry limit (no infinite loops)", () => {
    const src = fs.readFileSync(path.join(serverDir, "bridge/bridge-writer.ts"), "utf-8");
    // Must have a max retry check
    expect(src).toMatch(/retryCount\s*>=\s*3/);
    // Must mark permanently failed after max retries
    expect(src).toContain("permanently_failed");
  });

  it("retry queue fetches only unresolved failures older than 30 seconds", () => {
    const src = fs.readFileSync(path.join(serverDir, "bridge/bridge-writer.ts"), "utf-8");
    expect(src).toContain("WHERE resolved_at IS NULL");
    expect(src).toContain("INTERVAL '30 seconds'");
  });

  it("retry queue has concurrency guard (no overlapping runs)", () => {
    const src = fs.readFileSync(path.join(serverDir, "bridge/bridge-writer.ts"), "utf-8");
    expect(src).toContain("_retryRunning");
    expect(src).toContain("if (_retryRunning)");
  });

  it("scheduler functions are exported for startup wiring", () => {
    const src = fs.readFileSync(path.join(serverDir, "bridge/bridge-writer.ts"), "utf-8");
    expect(src).toContain("export function startBridgeRetryScheduler");
    expect(src).toContain("export function stopBridgeRetryScheduler");
  });

  it("retry scheduler is wired into startup-orchestrator", () => {
    const src = fs.readFileSync(path.join(serverDir, "bootstrap/startup-orchestrator.ts"), "utf-8");
    expect(src).toContain("startBridgeRetryScheduler");
    expect(src).toContain("Bridge retry scheduler started");
  });
});

describe("Bridge health observability", () => {
  const serverDir = path.resolve(__dirname, "../../../server");

  it("health endpoint is registered at /api/admin/bridge-health", () => {
    const src = fs.readFileSync(path.join(serverDir, "admin-control-routes.ts"), "utf-8");
    expect(src).toContain('"/api/admin/bridge-health"');
    expect(src).toContain("getBridgeFailureCount");
    expect(src).toContain("getBridgeSuccessCount");
    expect(src).toContain("getRecentBridgeFailures");
  });

  it("manual retry trigger is registered at /api/admin/bridge-retry", () => {
    const src = fs.readFileSync(path.join(serverDir, "admin-control-routes.ts"), "utf-8");
    expect(src).toContain('"/api/admin/bridge-retry"');
    expect(src).toContain("processBridgeRetryQueue");
  });

  it("health endpoint reports healthy vs degraded status", () => {
    const src = fs.readFileSync(path.join(serverDir, "admin-control-routes.ts"), "utf-8");
    expect(src).toContain('"healthy"');
    expect(src).toContain('"degraded"');
  });

  it("success counter tracks successful bridge writes", () => {
    const src = fs.readFileSync(path.join(serverDir, "bridge/bridge-writer.ts"), "utf-8");
    expect(src).toContain("export function getBridgeSuccessCount");
    expect(src).toContain("_bridgeSuccessCount");
  });
});

describe("Bridge failure persistence migration", () => {
  const migrationsDir = path.resolve(__dirname, "../../../migrations");

  it("migration adds retry_count and last_retry_at columns", () => {
    const sql = fs.readFileSync(
      path.join(migrationsDir, "20260404_bridge_sync_failures_retry_columns.sql"),
      "utf-8",
    );
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS retry_count");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS last_retry_at");
  });

  it("migration runs in a transaction", () => {
    const sql = fs.readFileSync(
      path.join(migrationsDir, "20260404_bridge_sync_failures_retry_columns.sql"),
      "utf-8",
    );
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql).toMatch(/^COMMIT;/m);
  });

  it("migration creates partial unique index for unresolved failures", () => {
    const sql = fs.readFileSync(
      path.join(migrationsDir, "20260404_bridge_sync_failures_retry_columns.sql"),
      "utf-8",
    );
    expect(sql).toContain("idx_bridge_sync_failures_unique_unresolved");
    expect(sql).toContain("WHERE resolved_at IS NULL");
  });
});
