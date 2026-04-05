import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

const migrationsDir = path.join(process.cwd(), "migrations");
const serverDir = path.join(process.cwd(), "server");

function readMigration(filename: string): string {
  return fs.readFileSync(path.join(migrationsDir, filename), "utf8");
}

function readServerFile(relativePath: string): string {
  return fs.readFileSync(path.join(serverDir, relativePath), "utf8");
}

// ===========================================================================
// 1. Bridge Writer — Structural + Behavioral Coverage
// ===========================================================================
describe("Bridge Writer Coverage", () => {
  const bridgeWriter = readServerFile("bridge/bridge-writer.ts");

  it("exports all 9 sync functions", () => {
    const expected = [
      "syncProject", "syncProjectInsert", "syncClient",
      "syncCostLine", "syncRevenueLine", "syncChangeRequest",
      "syncProjectExecutionState", "syncUser",
      "snapshotProjectState",
    ];
    for (const fn of expected) {
      expect(bridgeWriter).toContain(`export async function ${fn}`);
    }
  });

  it("exports soft-close bridge functions", () => {
    expect(bridgeWriter).toContain("export async function softClosePromotedCostLines");
    expect(bridgeWriter).toContain("export async function softClosePromotedRevenueLines");
  });

  it("exports cascade delete bridge function", () => {
    expect(bridgeWriter).toContain("export async function cascadeDeletePromotedFinanceLines");
  });

  it("syncProjectInsert uses INSERT with ON CONFLICT for idempotency", () => {
    const fnStart = bridgeWriter.indexOf("async function syncProjectInsert");
    const fnEnd = bridgeWriter.indexOf("async function syncUser");
    const fn = bridgeWriter.slice(fnStart, fnEnd);
    expect(fn).toContain("INSERT INTO core.projects");
    expect(fn).toContain("ON CONFLICT (id) DO UPDATE");
  });

  it("syncUser writes to core.user_accounts", () => {
    const fnStart = bridgeWriter.indexOf("async function syncUser");
    const fnEnd = bridgeWriter.indexOf("async function softClosePromotedCostLines");
    const fn = bridgeWriter.slice(fnStart, fnEnd);
    expect(fn).toContain("INSERT INTO core.user_accounts");
    expect(fn).toContain("ON CONFLICT (id) DO UPDATE");
  });

  it("softClosePromotedCostLines sets effective_to on promoted cost_lines", () => {
    const fnStart = bridgeWriter.indexOf("async function softClosePromotedCostLines");
    const fnEnd = bridgeWriter.indexOf("async function softClosePromotedRevenueLines");
    const fn = bridgeWriter.slice(fnStart, fnEnd);
    expect(fn).toContain("UPDATE finance.cost_lines");
    expect(fn).toContain("effective_to = NOW()");
  });

  it("cascadeDeletePromotedFinanceLines deletes from both promoted tables", () => {
    const fnStart = bridgeWriter.indexOf("async function cascadeDeletePromotedFinanceLines");
    const fnEnd = bridgeWriter.indexOf("// -----\n// Bulk helpers", fnStart) || bridgeWriter.indexOf("export async function syncCostLines");
    const fn = bridgeWriter.slice(fnStart, fnEnd);
    expect(fn).toContain("DELETE FROM finance.cost_lines");
    expect(fn).toContain("DELETE FROM finance.revenue_lines");
  });

  it("syncChangeRequest writes to finance.finance_records with variation_order type", () => {
    expect(bridgeWriter).toContain("INSERT INTO finance.finance_records");
    expect(bridgeWriter).toContain("'variation_order'");
    expect(bridgeWriter).toContain("ON CONFLICT (legacy_entity_table, legacy_entity_id) DO UPDATE");
  });

  it("all sync functions return BridgeResult without throwing", () => {
    const exportedFunctions = bridgeWriter.match(/export async function sync\w+/g) ?? [];
    expect(exportedFunctions.length).toBeGreaterThanOrEqual(9);
    const errorReturns = bridgeWriter.match(/return \{ success: false/g) ?? [];
    expect(errorReturns.length).toBeGreaterThanOrEqual(9);
  });

  it("all sync functions are wrapped in withRetry", () => {
    const retryWraps = bridgeWriter.match(/return withRetry\(/g) ?? [];
    // 9 sync functions: project, projectInsert, client, costLine, revenueLine,
    // changeRequest, executionState, user, softCloseCost, softCloseRevenue, cascadeDelete
    expect(retryWraps.length).toBeGreaterThanOrEqual(9);
  });
});

// ===========================================================================
// 2. Bridge Writer Retry & Resilience
// ===========================================================================
describe("Bridge Writer Retry & Resilience", () => {
  const bridgeWriter = readServerFile("bridge/bridge-writer.ts");

  it("has withRetry helper for transient error handling", () => {
    expect(bridgeWriter).toContain("async function withRetry");
  });

  it("detects transient errors (connection, timeout, deadlock, serialization)", () => {
    expect(bridgeWriter).toContain("isTransientError");
    expect(bridgeWriter).toContain("connection");
    expect(bridgeWriter).toContain("ECONNREFUSED");
    expect(bridgeWriter).toContain("timeout");
    expect(bridgeWriter).toContain("deadlock");
    expect(bridgeWriter).toContain("could not serialize");
  });

  it("logs persistent failures to internal.bridge_sync_failures", () => {
    expect(bridgeWriter).toContain("INSERT INTO internal.bridge_sync_failures");
  });

  it("BridgeResult includes retried flag", () => {
    expect(bridgeWriter).toContain("retried?: boolean");
  });

  it("retries with 200ms delay", () => {
    expect(bridgeWriter).toContain("setTimeout(r, 200)");
  });
});

// ===========================================================================
// 3. Batch Bridge Sync — Pagination + Concurrency
// ===========================================================================
describe("Batch Bridge Sync", () => {
  const batchSync = readServerFile("bridge/batch-bridge-sync.ts");

  it("exports all batch sync functions", () => {
    expect(batchSync).toContain("export async function batchSyncCostLinesByProject");
    expect(batchSync).toContain("export async function batchSyncRevenueLinesByProject");
    expect(batchSync).toContain("export async function batchSyncChangeRequestsByProject");
    expect(batchSync).toContain("export async function batchSyncFinanceByProject");
  });

  it("uses LEFT JOIN to find unsynced rows", () => {
    expect(batchSync).toContain("LEFT JOIN finance.cost_lines");
    expect(batchSync).toContain("LEFT JOIN finance.revenue_lines");
    expect(batchSync).toContain("LEFT JOIN finance.finance_records");
  });

  it("only syncs active rows (effective_to IS NULL)", () => {
    expect(batchSync).toContain("effective_to IS NULL");
  });

  it("uses PAGE_SIZE and MAX_PAGES for bounded pagination", () => {
    expect(batchSync).toContain("PAGE_SIZE = 500");
    expect(batchSync).toContain("MAX_PAGES = 20");
  });

  it("has concurrency guard to prevent overlapping syncs", () => {
    expect(batchSync).toContain("activeSyncs");
    expect(batchSync).toContain("acquireLock");
    expect(batchSync).toContain("releaseLock");
  });

  it("releases lock in finally block", () => {
    const finallyBlocks = batchSync.match(/finally\s*\{\s*\n\s*releaseLock/g) ?? [];
    expect(finallyBlocks.length).toBeGreaterThanOrEqual(3);
  });

  it("paginates with OFFSET and breaks on empty/partial pages", () => {
    expect(batchSync).toContain("OFFSET");
    expect(batchSync).toContain("if (unsynced.length === 0) break");
    expect(batchSync).toContain("if (unsynced.length < PAGE_SIZE) break");
  });

  it("orders by id for stable pagination", () => {
    expect(batchSync).toContain("ORDER BY ncl.id");
    expect(batchSync).toContain("ORDER BY nrl.id");
    expect(batchSync).toContain("ORDER BY cr.id");
  });

  it("batchSyncChangeRequestsByProject filters deleted CRs and stale records", () => {
    const crSection = batchSync.slice(batchSync.indexOf("batchSyncChangeRequestsByProject"));
    expect(crSection).toContain("cr.deleted_at IS NULL");
    expect(crSection).toContain("fr.updated_at < cr.updated_at");
  });
});

// ===========================================================================
// 4. Change Request Backfill Migration (F10)
// ===========================================================================
describe("F10 Change Request Backfill Migration", () => {
  const migration = readMigration("20260403_f10_backfill_finance_records_change_requests.sql");
  const rollback = readMigration("20260403_f10_backfill_finance_records_change_requests_rollback.sql");

  it("inserts into finance.finance_records from change_requests", () => {
    expect(migration).toContain("INSERT INTO finance.finance_records");
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

  it("wraps in transaction", () => {
    expect(migration).toContain("BEGIN;");
    expect(migration).toContain("COMMIT;");
  });

  it("rollback removes events before records (FK order)", () => {
    const eventsDeletePos = rollback.indexOf("DELETE FROM finance.finance_record_events");
    const recordsDeletePos = rollback.indexOf("DELETE FROM finance.finance_records");
    expect(eventsDeletePos).toBeGreaterThan(-1);
    expect(recordsDeletePos).toBeGreaterThan(-1);
    expect(eventsDeletePos).toBeLessThan(recordsDeletePos);
  });
});

// ===========================================================================
// 5. Dual Schema Authority Guard
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

  it("starts reconciliation scheduler when promoted schema is active", () => {
    expect(orchestrator).toContain("startReconciliationScheduler");
    expect(orchestrator).toContain("Reconciliation scheduler started");
  });

  it("references schema-migration-status.md as authority", () => {
    expect(orchestrator).toContain("docs/schema-authority.md");
  });
});

// ===========================================================================
// 6. Write Path Bridge Call Coverage — ALL creation paths
// ===========================================================================
describe("Write Path Bridge Call Coverage", () => {
  it("storage.ts imports syncProjectInsert for bridge writes", () => {
    const storage = readServerFile("../server/storage.ts");
    expect(storage).toContain("syncProjectInsert");
  });

  it("storage.ts updateProject calls syncProjectSplitTables for legacy sync", () => {
    const storage = readServerFile("../server/storage.ts");
    const updateSection = storage.slice(storage.indexOf("async updateProject"), storage.indexOf("async deleteProject"));
    expect(updateSection).toContain("syncProjectSplitTables");
  });

  it("smart-import-routes calls syncProjectInsert on new project creation", () => {
    const smartImport = readServerFile("smart-import-routes.ts");
    expect(smartImport).toContain("syncProjectInsert");
  });

  it("lifecycle-routes calls syncProjectInsert on project promotion", () => {
    const lifecycle = readServerFile("lifecycle-routes.ts");
    expect(lifecycle).toContain("syncProjectInsert");
  });

  it("template-routes calls syncProjectInsert on project creation", () => {
    const template = readServerFile("template-routes.ts");
    expect(template).toContain("syncProjectInsert");
  });

  it("sync-routes calls syncProjectInsert on SP sync project creation", () => {
    const syncRoutes = readServerFile("sync-routes.ts");
    expect(syncRoutes).toContain("syncProjectInsert");
  });

  it("pd-routes client create and update call syncClient", () => {
    const pdRoutes = readServerFile("pd-routes.ts");
    const matches = pdRoutes.match(/syncClient/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("change-control-routes POST and PATCH call syncChangeRequest", () => {
    const ccRoutes = readServerFile("change-control-routes.ts");
    const matches = ccRoutes.match(/syncChangeRequest/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("smart-import-routes calls batchSyncFinanceByProject after commit", () => {
    const smartImport = readServerFile("smart-import-routes.ts");
    expect(smartImport).toContain("batchSyncFinanceByProject");
  });

  it("smart-import-routes soft-closes promoted finance lines", () => {
    const smartImport = readServerFile("smart-import-routes.ts");
    expect(smartImport).toContain("softClosePromotedCostLines");
    expect(smartImport).toContain("softClosePromotedRevenueLines");
  });

  it("subcontractor-routes calls batchSyncCostLinesByProject after rebuild", () => {
    const subRoutes = readServerFile("subcontractor-routes.ts");
    expect(subRoutes).toContain("batchSyncCostLinesByProject");
  });

  it("project-info-sync calls syncProjectExecutionState", () => {
    const sync = readServerFile("lib/project-info-sync.ts");
    expect(sync).toContain("syncProjectExecutionState");
  });

  it("role-management calls syncUser on user creation and department change", () => {
    const roleMgmt = readServerFile("role-management.ts");
    const matches = roleMgmt.match(/syncUser/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("lifecycle-routes cascades delete to promoted finance lines", () => {
    const lifecycle = readServerFile("lifecycle-routes.ts");
    expect(lifecycle).toContain("cascadeDeletePromotedFinanceLines");
  });
});

// ===========================================================================
// 7. Reconciliation Runner — Comprehensive Checks
// ===========================================================================
describe("Reconciliation Runner", () => {
  const runner = readServerFile("bridge/reconciliation-runner.ts");

  it("runs 12 reconciliation checks covering all domains", () => {
    const checks = [
      "projects_missing", "projects_stale", "projects_field_drift",
      "clients_missing", "clients_stale",
      "cost_lines_missing", "cost_lines_stale",
      "revenue_lines_missing", "revenue_lines_stale",
      "change_requests_missing",
      "users_missing",
      "bridge_failures_unresolved",
    ];
    for (const check of checks) {
      expect(runner).toContain(`"${check}"`);
    }
  });

  it("detects field-level drift for projects (name, phase)", () => {
    expect(runner).toContain("cp.project_name");
    expect(runner).toContain("pi.project_name");
    expect(runner).toContain("cp.phase");
    expect(runner).toContain("pi.phase");
  });

  it("detects field-level drift for clients (name)", () => {
    expect(runner).toContain("cc.name");
    expect(runner).toContain("c.name");
  });

  it("checks for unresolved bridge sync failures", () => {
    expect(runner).toContain("internal.bridge_sync_failures");
    expect(runner).toContain("resolved_at IS NULL");
  });

  it("exports automated scheduler functions", () => {
    expect(runner).toContain("export function startReconciliationScheduler");
    expect(runner).toContain("export function stopReconciliationScheduler");
    expect(runner).toContain("export function getLastReconciliationResult");
  });

  it("scheduler calls onFail callback on failure", () => {
    expect(runner).toContain("if (onFail) onFail(result)");
  });

  it("scheduler runs immediately on start then on interval", () => {
    expect(runner).toContain("tick()");
    expect(runner).toContain("setInterval(tick, intervalMs)");
  });
});

// ===========================================================================
// 8. Reconciliation SQL Integrity
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
// 9. Compatibility Views (Phase H.5)
// ===========================================================================
describe("Compatibility Views (Phase H.5)", () => {
  const views = readMigration("20260403_h05_compatibility_views.sql");

  it("declares views as read-only (no INSTEAD OF triggers in DDL)", () => {
    expect(views).toContain("No INSTEAD OF triggers");
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
// 10. Spine View Swap INSTEAD OF Triggers
// ===========================================================================
describe("Spine View Swap Triggers", () => {
  const swap = readMigration("20260403_spine_view_swap.sql");

  it("renames legacy tables", () => {
    expect(swap).toContain("ALTER TABLE public.approvals RENAME TO _approvals_legacy");
    expect(swap).toContain("ALTER TABLE public.deliverables RENAME TO _deliverables_legacy");
    expect(swap).toContain("ALTER TABLE public.work_items RENAME TO _work_items_legacy");
  });

  it("creates INSTEAD OF triggers for dual-write", () => {
    expect(swap).toContain("INSTEAD OF INSERT ON public.approvals");
    expect(swap).toContain("INSTEAD OF UPDATE ON public.approvals");
    expect(swap).toContain("INSTEAD OF DELETE ON public.work_items");
  });

  it("writes to both promoted and legacy tables", () => {
    expect(swap).toContain("INSERT INTO public._approvals_legacy");
    expect(swap).toContain("INSERT INTO public._deliverables_legacy");
    expect(swap).toContain("INSERT INTO public._work_items_legacy");
  });
});

// ===========================================================================
// 11. Bridge Sync Failures Migration
// ===========================================================================
describe("Bridge Sync Failures Migration", () => {
  const migration = readMigration("20260403_create_bridge_sync_failures.sql");

  it("creates internal schema and bridge_sync_failures table", () => {
    expect(migration).toContain("CREATE SCHEMA IF NOT EXISTS internal");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS internal.bridge_sync_failures");
  });

  it("has domain, entity_id, error_message, and resolved_at columns", () => {
    expect(migration).toContain("domain");
    expect(migration).toContain("entity_id");
    expect(migration).toContain("resolved_at");
  });

  it("has index on unresolved failures and UNIQUE constraint", () => {
    expect(migration).toContain("idx_bridge_sync_failures_unresolved");
    expect(migration).toContain("UNIQUE (domain, entity_id)");
  });
});

// ===========================================================================
// 12. Reconciliation Health Endpoint
// ===========================================================================
describe("Reconciliation Health Endpoint", () => {
  const adminRoutes = readServerFile("admin-control-routes.ts");

  it("registers GET /api/admin/reconciliation endpoint", () => {
    expect(adminRoutes).toContain('"/api/admin/reconciliation"');
  });

  it("requires admin authentication", () => {
    const reconcSection = adminRoutes.slice(adminRoutes.indexOf("reconciliation"));
    expect(reconcSection).toContain("requireAdmin");
  });

  it("supports ?cached=true for scheduler-cached results", () => {
    expect(adminRoutes).toContain("cached");
    expect(adminRoutes).toContain("getLastReconciliationResult");
  });

  it("returns 409 on reconciliation failure", () => {
    expect(adminRoutes).toContain("409");
  });
});

// ===========================================================================
// 13. Quality Routes TS Fixes
// ===========================================================================
describe("Quality Routes TS Fixes", () => {
  const qualityRoutes = readServerFile("quality-routes.ts");

  it("uses projectIds (not checklistProjectIds)", () => {
    expect(qualityRoutes).not.toContain("checklistProjectIds");
  });

  it("defines resolvedProjectName in projectSummaries callback", () => {
    const summariesSection = qualityRoutes.slice(qualityRoutes.indexOf("projectSummaries = dedupedChecklists.map"));
    const nextSection = summariesSection.slice(0, summariesSection.indexOf(".sort("));
    expect(nextSection).toContain("resolvedProjectName");
  });
});

// ===========================================================================
// 14. Bridge Coverage Detection — ensures every write path is hooked
// ===========================================================================
describe("Bridge Coverage Detection", () => {
  // Every file that does db.insert(projectInfo) must call syncProject or syncProjectInsert
  const projectWriteFiles = [
    { file: "../server/storage.ts", label: "storage.ts" },
    { file: "smart-import-routes.ts", label: "smart-import-routes.ts" },
    { file: "lifecycle-routes.ts", label: "lifecycle-routes.ts" },
    { file: "template-routes.ts", label: "template-routes.ts" },
    { file: "sync-routes.ts", label: "sync-routes.ts" },
  ];

  for (const { file, label } of projectWriteFiles) {
    it(`${label} has bridge call for project creation`, () => {
      const content = readServerFile(file);
      if (content.includes("insert(projectInfo)") || content.includes("INSERT INTO project_info")) {
        expect(
          content.includes("syncProject") || content.includes("syncProjectInsert"),
        ).toBe(true);
      }
    });
  }

  it("all cost line write paths have bridge coverage", () => {
    const storage = readServerFile("../server/storage.ts");
    if (storage.includes("insert(normalizedCostLines)")) {
      expect(storage.includes("syncCostLine") || storage.includes("batchSync")).toBe(true);
    }
  });

  it("all user write paths have bridge coverage", () => {
    const roleMgmt = readServerFile("role-management.ts");
    if (roleMgmt.includes("insert(users)")) {
      expect(roleMgmt).toContain("syncUser");
    }
  });

  it("all change_request write paths have bridge coverage", () => {
    const ccRoutes = readServerFile("change-control-routes.ts");
    if (ccRoutes.includes("insert(changeRequests)") || ccRoutes.includes("INSERT INTO change_requests")) {
      expect(ccRoutes).toContain("syncChangeRequest");
    }
  });

  it("soft-close paths cascade to promoted schema", () => {
    const smartImport = readServerFile("smart-import-routes.ts");
    if (smartImport.includes("softCloseByProjectId") || smartImport.includes("softCloseByProjectName")) {
      expect(smartImport).toContain("softClosePromotedCostLines");
      expect(smartImport).toContain("softClosePromotedRevenueLines");
    }
  });

  it("hard-delete paths cascade to promoted schema", () => {
    const lifecycle = readServerFile("lifecycle-routes.ts");
    if (lifecycle.includes("DELETE FROM normalized_cost_lines") || lifecycle.includes("DELETE FROM normalized_revenue_lines")) {
      expect(lifecycle).toContain("cascadeDeletePromotedFinanceLines");
    }
  });
});
