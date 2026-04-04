import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

// ===========================================================================
// 1. Backfill Migration Exists and Is Complete
// ===========================================================================
describe("VO/Change Request Finance Backfill Migration", () => {
  const migrationPath = "migrations/20260403_f10_backfill_finance_records_change_requests.sql";

  it("F10 backfill migration file exists", () => {
    expect(fs.existsSync(path.join(process.cwd(), migrationPath))).toBe(true);
  });

  it("backfill targets finance.finance_records", () => {
    const sql = readFile(migrationPath);
    expect(sql).toContain("INSERT INTO finance.finance_records");
  });

  it("uses financial_type = 'variation_order'", () => {
    const sql = readFile(migrationPath);
    expect(sql).toContain("'variation_order'");
  });

  it("maps legacy_entity_table to 'public.change_requests'", () => {
    const sql = readFile(migrationPath);
    expect(sql).toContain("'public.change_requests'");
  });

  it("resolves project_instance_id from legacy project_id", () => {
    const sql = readFile(migrationPath);
    expect(sql).toContain("core.project_instances");
    expect(sql).toContain("legacy_project_id");
  });

  it("resolves party_id from project_instances.client_party_id", () => {
    const f = readFile(migrationPath);
    expect(f).toContain("party_id");
    expect(f).toContain("client_party_id");
  });

  it("determines direction from cost_impact sign", () => {
    const sql = readFile(migrationPath);
    expect(sql).toContain("'inflow'");
    expect(sql).toContain("'outflow'");
  });

  it("only backfills active (non-deleted) change_requests", () => {
    const sql = readFile(migrationPath);
    expect(sql).toContain("cr.deleted_at IS NULL");
  });

  it("is idempotent via ON CONFLICT", () => {
    const sql = readFile(migrationPath);
    expect(sql).toContain("ON CONFLICT");
    expect(sql).toContain("DO UPDATE");
  });

  it("stores enriched fields in record_data JSONB", () => {
    const sql = readFile(migrationPath);
    expect(sql).toContain("change_type");
    expect(sql).toContain("revenue_impact");
    expect(sql).toContain("cos_impact");
    expect(sql).toContain("margin_impact");
    expect(sql).toContain("impact_summary");
    expect(sql).toContain("evidence_link");
  });

  it("creates finance_record_events for backfilled VOs", () => {
    const sql = readFile(migrationPath);
    expect(sql).toContain("INSERT INTO finance.finance_record_events");
    expect(sql).toContain("'backfill_imported'");
  });
});

// ===========================================================================
// 2. Bridge Writer: syncChangeRequest
// ===========================================================================
describe("Bridge Writer: syncChangeRequest", () => {
  const bridgeFile = readFile("server/bridge/bridge-writer.ts");

  it("exports syncChangeRequest function", () => {
    expect(bridgeFile).toContain("export async function syncChangeRequest");
  });

  it("uses financial_type 'variation_order'", () => {
    const idx = bridgeFile.indexOf("syncChangeRequest");
    const section = bridgeFile.slice(idx, idx + 2500);
    expect(section).toContain("'variation_order'");
  });

  it("maps to legacy_entity_table 'public.change_requests'", () => {
    const idx = bridgeFile.indexOf("syncChangeRequest");
    const section = bridgeFile.slice(idx, idx + 2500);
    expect(section).toContain("'public.change_requests'");
  });

  it("resolves project_instance_id from legacy_project_id", () => {
    const idx = bridgeFile.indexOf("syncChangeRequest");
    const section = bridgeFile.slice(idx, idx + 2500);
    expect(section).toContain("core.project_instances");
    expect(section).toContain("legacy_project_id");
  });

  it("resolves party_id from client_party_id", () => {
    const idx = bridgeFile.indexOf("syncChangeRequest");
    const section = bridgeFile.slice(idx, idx + 2500);
    expect(section).toContain("client_party_id");
    expect(section).toContain("party_id");
  });

  it("determines direction from costImpact sign", () => {
    const idx = bridgeFile.indexOf("syncChangeRequest");
    const section = bridgeFile.slice(idx, idx + 2500);
    expect(section).toContain("'inflow'");
    expect(section).toContain("'outflow'");
  });

  it("uses ON CONFLICT for idempotent upsert", () => {
    const idx = bridgeFile.indexOf("syncChangeRequest");
    const section = bridgeFile.slice(idx, idx + 2500);
    expect(section).toContain("ON CONFLICT");
  });

  it("stores enriched fields in record_data", () => {
    const idx = bridgeFile.indexOf("syncChangeRequest");
    const section = bridgeFile.slice(idx, idx + 2500);
    expect(section).toContain("change_type");
    expect(section).toContain("revenue_impact");
    expect(section).toContain("cos_impact");
    expect(section).toContain("margin_impact");
  });

  it("creates lifecycle event after sync", () => {
    const idx = bridgeFile.indexOf("syncChangeRequest");
    const section = bridgeFile.slice(idx, idx + 3000);
    expect(section).toContain("finance.finance_record_events");
    expect(section).toContain("'bridge_synced'");
  });

  it("uses withRetry for resilience", () => {
    const idx = bridgeFile.indexOf("syncChangeRequest");
    const section = bridgeFile.slice(idx, idx + 600);
    expect(section).toContain("withRetry");
  });
});

// ===========================================================================
// 3. Bridge Writer: softDeleteChangeRequestFinanceRecord
// ===========================================================================
describe("Bridge Writer: softDeleteChangeRequestFinanceRecord", () => {
  const bridgeFile = readFile("server/bridge/bridge-writer.ts");

  it("exports softDeleteChangeRequestFinanceRecord function", () => {
    expect(bridgeFile).toContain("export async function softDeleteChangeRequestFinanceRecord");
  });

  it("sets status to 'cancelled' on soft-delete", () => {
    const idx = bridgeFile.indexOf("softDeleteChangeRequestFinanceRecord");
    const section = bridgeFile.slice(idx, idx + 2500);
    expect(section).toContain("'cancelled'");
  });

  it("stores delete metadata in record_data", () => {
    const idx = bridgeFile.indexOf("softDeleteChangeRequestFinanceRecord");
    const section = bridgeFile.slice(idx, idx + 2500);
    expect(section).toContain("deleted_at");
    expect(section).toContain("deleted_by");
    expect(section).toContain("delete_reason");
  });

  it("creates soft_deleted lifecycle event", () => {
    const idx = bridgeFile.indexOf("softDeleteChangeRequestFinanceRecord");
    const section = bridgeFile.slice(idx, idx + 2500);
    expect(section).toContain("finance.finance_record_events");
    expect(section).toContain("'soft_deleted'");
  });

  it("uses withRetry for resilience", () => {
    const idx = bridgeFile.indexOf("softDeleteChangeRequestFinanceRecord");
    const section = bridgeFile.slice(idx, idx + 600);
    expect(section).toContain("withRetry");
  });
});

// ===========================================================================
// 4. Route Handlers Wire to Bridge
// ===========================================================================
describe("Change Control Routes Bridge Wiring", () => {
  const routeFile = readFile("server/change-control-routes.ts");

  it("POST /api/change-requests calls syncChangeRequest", () => {
    const postIdx = routeFile.indexOf('app.post("/api/change-requests"');
    const postSection = routeFile.slice(postIdx, routeFile.indexOf("app.patch", postIdx));
    expect(postSection).toContain("syncChangeRequest");
  });

  it("PATCH /api/change-requests/:id calls syncChangeRequest", () => {
    const patchIdx = routeFile.indexOf('app.patch("/api/change-requests/:id"');
    const patchSection = routeFile.slice(patchIdx, routeFile.indexOf("app.delete", patchIdx));
    expect(patchSection).toContain("syncChangeRequest");
  });

  it("DELETE /api/change-requests/:id calls softDeleteChangeRequestFinanceRecord", () => {
    const deleteIdx = routeFile.indexOf('app.delete("/api/change-requests/:id"');
    const deleteSection = routeFile.slice(deleteIdx, deleteIdx + 1500);
    expect(deleteSection).toContain("softDeleteChangeRequestFinanceRecord");
  });

  it("bridge calls are fire-and-forget (.catch)", () => {
    // All three bridge calls should use .catch(() => {})
    const postIdx = routeFile.indexOf('app.post("/api/change-requests"');
    const postSection = routeFile.slice(postIdx, routeFile.indexOf("app.patch", postIdx));
    expect(postSection).toContain(".catch(() => {})");

    const patchIdx = routeFile.indexOf('app.patch("/api/change-requests/:id"');
    const patchSection = routeFile.slice(patchIdx, routeFile.indexOf("app.delete", patchIdx));
    expect(patchSection).toContain(".catch(() => {})");

    const deleteIdx = routeFile.indexOf('app.delete("/api/change-requests/:id"');
    const deleteSection = routeFile.slice(deleteIdx, deleteIdx + 1500);
    expect(deleteSection).toContain(".catch(() => {})");
  });
});

// ===========================================================================
// 5. Batch Sync Support
// ===========================================================================
describe("Batch Sync for Change Requests", () => {
  it("batchSyncChangeRequestsByProject exists in batch-bridge-sync", () => {
    const f = readFile("server/bridge/batch-bridge-sync.ts");
    expect(f).toContain("batchSyncChangeRequestsByProject");
  });

  it("batch sync only processes active (non-deleted) CRs", () => {
    const f = readFile("server/bridge/batch-bridge-sync.ts");
    const idx = f.indexOf("batchSyncChangeRequestsByProject");
    const section = f.slice(idx, idx + 2500);
    expect(section).toContain("deleted_at IS NULL");
  });
});

// ===========================================================================
// 6. Reconciliation Pack Coverage
// ===========================================================================
describe("Reconciliation Pack: VO/Change Request Checks", () => {
  const packFile = readFile("server/services/reconciliation-pack.ts");

  it("checks change_requests_row_parity", () => {
    expect(packFile).toContain("change_requests_row_parity");
  });

  it("row parity excludes cancelled finance_records", () => {
    const idx = packFile.indexOf("change_requests_row_parity");
    // Look backward to find the promoted count query
    const section = packFile.slice(Math.max(0, idx - 300), idx + 200);
    expect(section).toContain("status != 'cancelled'");
  });

  it("checks change_requests_stale_cancelled (soft-delete drift)", () => {
    expect(packFile).toContain("change_requests_stale_cancelled");
  });

  it("checks change_requests_amount_parity (cost_impact sum)", () => {
    expect(packFile).toContain("change_requests_amount_parity");
    expect(packFile).toContain("cost_impact");
  });

  it("amount parity is HARD_FAIL severity", () => {
    const idx = packFile.indexOf("change_requests_amount_parity");
    const section = packFile.slice(idx, idx + 200);
    expect(section).toContain("HARD_FAIL");
  });

  it("checks change_requests_null_party_id", () => {
    expect(packFile).toContain("change_requests_null_party_id");
    expect(packFile).toContain("party_id IS NULL");
  });
});

// ===========================================================================
// 7. Reconciliation Runner Coverage
// ===========================================================================
describe("Reconciliation Runner: Change Request Check", () => {
  const runnerFile = readFile("server/bridge/reconciliation-runner.ts");

  it("checks change_requests_missing", () => {
    expect(runnerFile).toContain("change_requests_missing");
  });

  it("only checks active (non-deleted) change_requests", () => {
    const idx = runnerFile.indexOf("change_requests_missing");
    const section = runnerFile.slice(idx, idx + 600);
    expect(section).toContain("deleted_at IS NULL");
  });

  it("joins on legacy_entity_table = 'public.change_requests'", () => {
    const idx = runnerFile.indexOf("change_requests_missing");
    const section = runnerFile.slice(idx, idx + 600);
    expect(section).toContain("'public.change_requests'");
  });
});

// ===========================================================================
// 8. Schema Definition: change_requests Has Financial Columns
// ===========================================================================
describe("Change Requests Schema: Financial Columns", () => {
  const schemaFile = readFile("shared/schema/projects.ts");

  it("change_requests table has costImpact column", () => {
    const idx = schemaFile.indexOf("changeRequests = pgTable");
    const section = schemaFile.slice(idx, idx + 2500);
    expect(section).toContain("cost_impact");
  });

  it("change_requests table has revenueImpact column", () => {
    const idx = schemaFile.indexOf("changeRequests = pgTable");
    const section = schemaFile.slice(idx, idx + 2500);
    expect(section).toContain("revenue_impact");
  });

  it("change_requests table has cosImpact column", () => {
    const idx = schemaFile.indexOf("changeRequests = pgTable");
    const section = schemaFile.slice(idx, idx + 2500);
    expect(section).toContain("cos_impact");
  });

  it("change_requests table has marginImpact column", () => {
    const idx = schemaFile.indexOf("changeRequests = pgTable");
    const section = schemaFile.slice(idx, idx + 2500);
    expect(section).toContain("margin_impact");
  });

  it("change_requests table has soft-delete columns", () => {
    const idx = schemaFile.indexOf("changeRequests = pgTable");
    const section = schemaFile.slice(idx, idx + 2500);
    expect(section).toContain("deleted_at");
    expect(section).toContain("deleted_by");
    expect(section).toContain("delete_reason");
  });

  it("change_requests table has status enum", () => {
    expect(schemaFile).toContain("changeRequestStatusEnum");
    expect(schemaFile).toContain("'approved'");
    expect(schemaFile).toContain("'rejected'");
  });
});

// ===========================================================================
// 9. Mapping Rules (Doc/Implementation Alignment)
// ===========================================================================
describe("VO-to-Finance Mapping Rules Alignment", () => {
  it("financial_type is 'variation_order' in both migration and bridge", () => {
    const migration = readFile("migrations/20260403_f10_backfill_finance_records_change_requests.sql");
    const bridge = readFile("server/bridge/bridge-writer.ts");
    expect(migration).toContain("'variation_order'");
    const idx = bridge.indexOf("syncChangeRequest");
    expect(bridge.slice(idx, idx + 2500)).toContain("'variation_order'");
  });

  it("direction logic is consistent between migration and bridge", () => {
    const migration = readFile("migrations/20260403_f10_backfill_finance_records_change_requests.sql");
    const bridge = readFile("server/bridge/bridge-writer.ts");
    // Both use: negative cost_impact → 'inflow', else → 'outflow'
    expect(migration).toContain("< 0 THEN 'inflow'");
    const idx = bridge.indexOf("syncChangeRequest");
    const section = bridge.slice(idx, idx + 2500);
    expect(section).toContain("< 0 ? 'inflow' : 'outflow'");
  });

  it("legacy_entity_table is consistent", () => {
    const migration = readFile("migrations/20260403_f10_backfill_finance_records_change_requests.sql");
    const bridge = readFile("server/bridge/bridge-writer.ts");
    const runner = readFile("server/bridge/reconciliation-runner.ts");
    expect(migration).toContain("'public.change_requests'");
    expect(bridge).toContain("'public.change_requests'");
    expect(runner).toContain("'public.change_requests'");
  });

  it("amount source is cost_impact in both migration and bridge", () => {
    const migration = readFile("migrations/20260403_f10_backfill_finance_records_change_requests.sql");
    const bridge = readFile("server/bridge/bridge-writer.ts");
    expect(migration).toContain("cr.cost_impact");
    const idx = bridge.indexOf("syncChangeRequest");
    expect(bridge.slice(idx, idx + 2500)).toContain("costImpact");
  });
});
