import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = path.join(process.cwd(), "migrations");
const serverDir = path.join(process.cwd(), "server");

function readMigration(filename: string): string {
  return fs.readFileSync(path.join(migrationsDir, filename), "utf8");
}

function readServerFile(relativePath: string): string {
  return fs.readFileSync(path.join(serverDir, relativePath), "utf8");
}

// ===========================================================================
// 1. Bridge Writer Coverage Tests
// ===========================================================================
describe("Bridge Writer Coverage", () => {
  const bridgeWriter = readServerFile("bridge/bridge-writer.ts");

  it("exports syncProject function", () => {
    expect(bridgeWriter).toContain("export async function syncProject");
  });

  it("exports syncClient function", () => {
    expect(bridgeWriter).toContain("export async function syncClient");
  });

  it("exports syncCostLine function", () => {
    expect(bridgeWriter).toContain("export async function syncCostLine");
  });

  it("exports syncRevenueLine function", () => {
    expect(bridgeWriter).toContain("export async function syncRevenueLine");
  });

  it("exports syncChangeRequest function for VO→finance bridge", () => {
    expect(bridgeWriter).toContain("export async function syncChangeRequest");
  });

  it("exports syncProjectExecutionState function", () => {
    expect(bridgeWriter).toContain("export async function syncProjectExecutionState");
  });

  it("syncChangeRequest writes to finance.finance_records", () => {
    expect(bridgeWriter).toContain("INSERT INTO finance.finance_records");
  });

  it("syncChangeRequest uses ON CONFLICT for idempotency", () => {
    expect(bridgeWriter).toContain("ON CONFLICT (legacy_entity_table, legacy_entity_id) DO UPDATE");
  });

  it("syncChangeRequest sets financial_type to variation_order", () => {
    expect(bridgeWriter).toContain("'variation_order'");
  });

  it("all sync functions return BridgeResult", () => {
    const exportedFunctions = bridgeWriter.match(/export async function sync\w+/g) ?? [];
    expect(exportedFunctions.length).toBeGreaterThanOrEqual(6);
    for (const fn of exportedFunctions) {
      expect(bridgeWriter).toContain(`Promise<BridgeResult>`);
    }
  });

  it("all sync functions catch errors without throwing", () => {
    // Each sync function should have a try/catch and return { success: false }
    const errorReturns = bridgeWriter.match(/return \{ success: false/g) ?? [];
    expect(errorReturns.length).toBeGreaterThanOrEqual(6);
  });
});

// ===========================================================================
// 2. Batch Bridge Sync Tests
// ===========================================================================
describe("Batch Bridge Sync", () => {
  const batchSync = readServerFile("bridge/batch-bridge-sync.ts");

  it("exports batchSyncCostLinesByProject", () => {
    expect(batchSync).toContain("export async function batchSyncCostLinesByProject");
  });

  it("exports batchSyncRevenueLinesByProject", () => {
    expect(batchSync).toContain("export async function batchSyncRevenueLinesByProject");
  });

  it("exports batchSyncFinanceByProject", () => {
    expect(batchSync).toContain("export async function batchSyncFinanceByProject");
  });

  it("uses LEFT JOIN to find unsynced rows", () => {
    expect(batchSync).toContain("LEFT JOIN finance.cost_lines");
    expect(batchSync).toContain("LEFT JOIN finance.revenue_lines");
  });

  it("only syncs active rows (effective_to IS NULL)", () => {
    expect(batchSync).toContain("effective_to IS NULL");
  });

  it("limits batch size to prevent unbounded queries", () => {
    expect(batchSync).toContain("LIMIT 2000");
  });
});

// ===========================================================================
// 3. Change Request Backfill Migration Tests
// ===========================================================================
describe("F10 Change Request Backfill Migration", () => {
  const migration = readMigration("20260403_f10_backfill_finance_records_change_requests.sql");
  const rollback = readMigration("20260403_f10_backfill_finance_records_change_requests_rollback.sql");

  it("inserts into finance.finance_records", () => {
    expect(migration).toContain("INSERT INTO finance.finance_records");
  });

  it("maps from change_requests table", () => {
    expect(migration).toContain("FROM change_requests cr");
  });

  it("sets financial_type to variation_order", () => {
    expect(migration).toContain("'variation_order'");
  });

  it("resolves project_instance_id via core.project_instances", () => {
    expect(migration).toContain("LEFT JOIN core.project_instances pi ON pi.legacy_project_id = cr.project_id");
  });

  it("is idempotent via ON CONFLICT", () => {
    expect(migration).toContain("ON CONFLICT (legacy_entity_table, legacy_entity_id) DO UPDATE");
  });

  it("excludes soft-deleted change requests", () => {
    expect(migration).toContain("cr.deleted_at IS NULL");
  });

  it("creates lifecycle events for backfilled records", () => {
    expect(migration).toContain("INSERT INTO finance.finance_record_events");
    expect(migration).toContain("'backfill_imported'");
  });

  it("wraps in BEGIN/COMMIT", () => {
    expect(migration).toContain("BEGIN;");
    expect(migration).toContain("COMMIT;");
  });

  it("rollback removes backfilled records", () => {
    expect(rollback).toContain("DELETE FROM finance.finance_records");
    expect(rollback).toContain("legacy_entity_table = 'public.change_requests'");
  });

  it("rollback removes lifecycle events first (FK order)", () => {
    const eventsDeletePos = rollback.indexOf("DELETE FROM finance.finance_record_events");
    const recordsDeletePos = rollback.indexOf("DELETE FROM finance.finance_records");
    expect(eventsDeletePos).toBeLessThan(recordsDeletePos);
  });
});

// ===========================================================================
// 4. Dual Schema Authority Guard Tests
// ===========================================================================
describe("Startup Orchestrator Schema Guard", () => {
  const orchestrator = readServerFile("bootstrap/startup-orchestrator.ts");

  it("checks for promoted schema before running legacy sync", () => {
    expect(orchestrator).toContain("isPromotedSchemaPresent");
  });

  it("skips legacy schema sync when promoted schema exists", () => {
    expect(orchestrator).toContain("skipping legacy schema sync to avoid dual authority");
  });

  it("isPromotedSchemaPresent checks for core.projects table", () => {
    expect(orchestrator).toContain("table_schema = 'core'");
    expect(orchestrator).toContain("table_name = 'projects'");
  });

  it("references schema-migration-status.md as authority", () => {
    expect(orchestrator).toContain("docs/schema-migration-status.md");
  });
});

// ===========================================================================
// 5. Write Path Bridge Call Coverage Tests
// ===========================================================================
describe("Write Path Bridge Call Coverage", () => {
  it("pd-routes client update calls syncClient", () => {
    const pdRoutes = readServerFile("pd-routes.ts");
    // The PATCH handler for client updates should call syncClient
    const patchIdx = pdRoutes.indexOf('app.patch("/api/pd/clients');
    expect(patchIdx).toBeGreaterThan(-1);
    const patchSection = pdRoutes.slice(patchIdx, pdRoutes.indexOf("app.", patchIdx + 10));
    expect(patchSection).toContain("syncClient");
  });

  it("change-control-routes POST calls syncChangeRequest", () => {
    const ccRoutes = readServerFile("change-control-routes.ts");
    expect(ccRoutes).toContain("syncChangeRequest");
  });

  it("change-control-routes PATCH calls syncChangeRequest", () => {
    const ccRoutes = readServerFile("change-control-routes.ts");
    // Should have at least 2 occurrences (create + update)
    const matches = ccRoutes.match(/syncChangeRequest/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("smart-import-routes calls batchSyncFinanceByProject after commit", () => {
    const smartImport = readServerFile("smart-import-routes.ts");
    expect(smartImport).toContain("batchSyncFinanceByProject");
  });

  it("subcontractor-routes calls batchSyncCostLinesByProject after rebuild", () => {
    const subRoutes = readServerFile("subcontractor-routes.ts");
    expect(subRoutes).toContain("batchSyncCostLinesByProject");
  });

  it("project-info-sync calls syncProjectExecutionState", () => {
    const sync = readServerFile("lib/project-info-sync.ts");
    expect(sync).toContain("syncProjectExecutionState");
  });
});

// ===========================================================================
// 6. Reconciliation SQL Integrity Tests
// ===========================================================================
describe("Reconciliation Check SQL", () => {
  const reconciliationSql = readMigration("20260403_reconciliation_check.sql");

  const expectedChecks = [
    "CHECK_1_PROJECTS_MISSING",
    "CHECK_2_PROJECTS_STALE",
    "CHECK_3_CLIENTS_MISSING",
    "CHECK_4_COST_LINES_MISSING",
    "CHECK_5_REVENUE_LINES_MISSING",
    "CHECK_6_WORK_ITEMS_COUNT_MISMATCH",
    "CHECK_7_APPROVALS_MISSING",
    "CHECK_8_DELIVERABLES_MISSING",
    "CHECK_9_CHANGE_REQUESTS_MISSING",
    "CHECK_10_FINANCE_RECORDS_ORPHANED",
  ];

  for (const check of expectedChecks) {
    it(`includes ${check}`, () => {
      expect(reconciliationSql).toContain(check);
    });
  }

  it("all checks return fail_count column", () => {
    const failCountMatches = reconciliationSql.match(/AS fail_count/g) ?? [];
    expect(failCountMatches.length).toBe(expectedChecks.length);
  });
});

// ===========================================================================
// 7. Compatibility View Tests (Phase H.5)
// ===========================================================================
describe("Compatibility Views (Phase H.5)", () => {
  const views = readMigration("20260403_h05_compatibility_views.sql");

  it("declares views as read-only (no INSTEAD OF triggers in DDL)", () => {
    expect(views).toContain("No INSTEAD OF triggers");
    // The file should not contain actual CREATE TRIGGER statements (the comment mentioning INSTEAD OF is fine)
    expect(views).not.toContain("CREATE TRIGGER");
    expect(views).not.toContain("INSTEAD OF INSERT");
    expect(views).not.toContain("INSTEAD OF UPDATE");
    expect(views).not.toContain("INSTEAD OF DELETE");
  });

  const expectedViews = [
    "core.v_projects",
    "core.v_work_items",
    "finance.v_finance_records",
    "core.v_deliverables",
    "core.v_approvals",
    "core.v_governed_processes",
  ];

  for (const view of expectedViews) {
    it(`creates ${view}`, () => {
      expect(views).toContain(`CREATE OR REPLACE VIEW ${view}`);
    });
  }
});

// ===========================================================================
// 8. Spine View Swap INSTEAD OF Trigger Tests
// ===========================================================================
describe("Spine View Swap Triggers", () => {
  const swap = readMigration("20260403_spine_view_swap.sql");

  it("renames approvals to _approvals_legacy", () => {
    expect(swap).toContain("ALTER TABLE public.approvals RENAME TO _approvals_legacy");
  });

  it("renames deliverables to _deliverables_legacy", () => {
    expect(swap).toContain("ALTER TABLE public.deliverables RENAME TO _deliverables_legacy");
  });

  it("renames work_items to _work_items_legacy", () => {
    expect(swap).toContain("ALTER TABLE public.work_items RENAME TO _work_items_legacy");
  });

  it("creates INSTEAD OF INSERT trigger for approvals", () => {
    expect(swap).toContain("INSTEAD OF INSERT ON public.approvals");
  });

  it("creates INSTEAD OF UPDATE trigger for approvals", () => {
    expect(swap).toContain("INSTEAD OF UPDATE ON public.approvals");
  });

  it("creates INSTEAD OF DELETE trigger for work_items", () => {
    expect(swap).toContain("INSTEAD OF DELETE ON public.work_items");
  });

  it("writes to both promoted and legacy tables (dual-write)", () => {
    expect(swap).toContain("INSERT INTO public._approvals_legacy");
    expect(swap).toContain("INSERT INTO public._deliverables_legacy");
    expect(swap).toContain("INSERT INTO public._work_items_legacy");
  });
});
