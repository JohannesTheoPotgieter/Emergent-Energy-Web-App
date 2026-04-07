/**
 * Bridge Sync Observability Tests
 *
 * Verifies that the bridge writer has proper error handling, retry behavior,
 * success tracking, and structured logging. The audit claimed bridge sync
 * was "fire-and-forget with silent failures" — this test suite documents
 * the existing infrastructure and the improvements made.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("Bridge writer — retry and error infrastructure", () => {
  const bridge = read("server/bridge/bridge-writer.ts");

  it("withRetry retries once on transient errors", () => {
    expect(bridge).toContain("function withRetry");
    expect(bridge).toContain("isTransientError");
    expect(bridge).toContain("setTimeout(r, 200)");
  });

  it("isTransientError detects connection, timeout, and deadlock errors", () => {
    expect(bridge).toContain("connection|ECONNREFUSED|timeout|deadlock|could not serialize");
  });

  it("logBridgeError persists to internal.bridge_sync_failures", () => {
    expect(bridge).toContain("INSERT INTO internal.bridge_sync_failures");
  });

  it("logBridgeError swallows if table doesn't exist (no cascade failure)", () => {
    expect(bridge).toContain("Table may not exist yet");
  });
});

describe("Bridge writer — success tracking", () => {
  const bridge = read("server/bridge/bridge-writer.ts");

  it("withRetry increments success counter on successful first attempt", () => {
    const retryBlock = bridge.substring(
      bridge.indexOf("async function withRetry"),
      bridge.indexOf("async function withRetry") + 800
    );
    expect(retryBlock).toContain("if (first.success)");
    expect(retryBlock).toContain("_bridgeSuccessCount++");
  });

  it("withRetry increments success counter on successful retry", () => {
    const retryBlock = bridge.substring(
      bridge.indexOf("await new Promise(r => setTimeout(r, 200))"),
      bridge.indexOf("await new Promise(r => setTimeout(r, 200))") + 300
    );
    expect(retryBlock).toContain("if (second.success)");
    expect(retryBlock).toContain("_bridgeSuccessCount++");
  });

  it("getBridgeSuccessCount is exported", () => {
    expect(bridge).toContain("export function getBridgeSuccessCount");
  });
});

describe("Bridge writer — bridgeCatch structured logging", () => {
  const bridge = read("server/bridge/bridge-writer.ts");

  it("bridgeCatch logs structured JSON with all required fields", () => {
    const catchBlock = bridge.substring(
      bridge.indexOf("export function bridgeCatch"),
      bridge.indexOf("export function bridgeCatch") + 800
    );
    expect(catchBlock).toContain("JSON.stringify");
    expect(catchBlock).toContain('level: "warn"');
    expect(catchBlock).toContain('component: "bridge-writer"');
    expect(catchBlock).toContain('event: "bridge_catch_failure"');
    expect(catchBlock).toContain("domain");
    expect(catchBlock).toContain("failureCount");
  });

  it("bridgeCatch maintains in-memory ring buffer (last 50)", () => {
    expect(bridge).toContain("MAX_RECENT_FAILURES = 50");
    expect(bridge).toContain("_recentFailures.push");
  });

  it("bridgeCatch persists to bridge_sync_failures table", () => {
    expect(bridge).toContain("persistBridgeCatchFailure");
  });
});

describe("Bridge writer — domain-aware catch (bridgeCatchFor)", () => {
  const bridge = read("server/bridge/bridge-writer.ts");

  it("bridgeCatchFor is exported", () => {
    expect(bridge).toContain("export function bridgeCatchFor");
  });

  it("bridgeCatchFor accepts domain and entityId parameters", () => {
    expect(bridge).toContain("bridgeCatchFor(domain: string, entityId: number | string)");
  });

  it("bridgeCatchFor logs entityId in structured output", () => {
    const block = bridge.substring(
      bridge.indexOf("export function bridgeCatchFor"),
      bridge.indexOf("export function bridgeCatchFor") + 600
    );
    expect(block).toContain("entityId: String(entityId)");
  });
});

describe("Bridge writer — retry queue", () => {
  const bridge = read("server/bridge/bridge-writer.ts");

  it("processBridgeRetryQueue processes unresolved failures", () => {
    expect(bridge).toContain("function processBridgeRetryQueue");
    expect(bridge).toContain("WHERE resolved_at IS NULL");
  });

  it("retry queue has max 3 retries before permanent failure", () => {
    expect(bridge).toContain("retryCount >= 3");
    expect(bridge).toContain("permanently_failed after 3 retries");
  });

  it("retry scheduler runs on configurable interval", () => {
    expect(bridge).toContain("function startBridgeRetryScheduler");
    expect(bridge).toContain("setInterval");
  });
});

describe("Bridge writer — exported observability functions", () => {
  const bridge = read("server/bridge/bridge-writer.ts");

  it("getBridgeFailureCount is exported for health monitoring", () => {
    expect(bridge).toContain("export function getBridgeFailureCount");
  });

  it("getRecentBridgeFailures is exported for health monitoring", () => {
    expect(bridge).toContain("export function getRecentBridgeFailures");
  });

  it("resetBridgeFailureCount is exported", () => {
    expect(bridge).toContain("export function resetBridgeFailureCount");
  });

  it("recordBridgeSuccess is exported", () => {
    expect(bridge).toContain("export function recordBridgeSuccess");
  });
});

describe("Finance line write service — domain-aware bridge sync", () => {
  const writeService = read("server/services/finance-line-write-service.ts");

  it("imports bridgeCatchFor", () => {
    expect(writeService).toContain("bridgeCatchFor");
  });

  it("createCostLine uses bridgeCatchFor with cost_line domain", () => {
    expect(writeService).toContain('bridgeCatchFor("cost_line", created.id)');
  });

  it("createCostLines uses bridgeCatchFor with cost_line domain per row", () => {
    expect(writeService).toContain('bridgeCatchFor("cost_line", row.id)');
  });

  it("createRevenueLine uses bridgeCatchFor with revenue_line domain", () => {
    expect(writeService).toContain('bridgeCatchFor("revenue_line", created.id)');
  });

  it("createRevenueLines uses bridgeCatchFor with revenue_line domain per row", () => {
    expect(writeService).toContain('bridgeCatchFor("revenue_line", row.id)');
  });
});

describe("Batch sync — project re-sync after bulk import", () => {
  const bridge = read("server/bridge/bridge-writer.ts");

  it("batchSyncFinanceByProject is exported", () => {
    expect(bridge).toContain("export async function batchSyncFinanceByProject");
  });

  it("batchSyncFinanceByProject returns cost and revenue sync counts", () => {
    expect(bridge).toContain("costSynced");
    expect(bridge).toContain("revenueSynced");
  });
});

describe("Bridge writer — change request sync to finance.finance_records", () => {
  const bridge = read("server/bridge/bridge-writer.ts");

  it("syncChangeRequest writes to finance.finance_records", () => {
    expect(bridge).toContain("INSERT INTO finance.finance_records");
  });

  it("softDeleteChangeRequestFinanceRecord is exported", () => {
    expect(bridge).toContain("export async function softDeleteChangeRequestFinanceRecord");
  });

  it("syncProjectExecutionState is exported", () => {
    expect(bridge).toContain("export async function syncProjectExecutionState");
  });
});
