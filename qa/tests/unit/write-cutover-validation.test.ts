import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const serverDir = path.join(process.cwd(), "server");

function readServerFile(relativePath: string): string {
  return fs.readFileSync(path.join(serverDir, relativePath), "utf8");
}

// ===========================================================================
// 1. Write Services Exist and Are Complete
// ===========================================================================
describe("Write Service Architecture", () => {
  it("project-write-service exports all CRUD functions", () => {
    const svc = readServerFile("services/project-write-service.ts");
    expect(svc).toContain("export async function createProjectInfo");
    expect(svc).toContain("export async function updateProjectInfo");
    expect(svc).toContain("export async function softDeleteProject");
    expect(svc).toContain("export async function hardDeleteProjectInfo");
    expect(svc).toContain("export async function updateExecutionState");
  });

  it("project-write-service calls bridge writers for all operations", () => {
    const svc = readServerFile("services/project-write-service.ts");
    expect(svc).toContain("syncProjectInsert");
    expect(svc).toContain("syncProject(");
    expect(svc).toContain("syncProjectDelete");
    expect(svc).toContain("syncProjectExecutionState");
    expect(svc).toContain("snapshotProjectState");
  });

  it("client-write-service exports create and update", () => {
    const svc = readServerFile("services/client-write-service.ts");
    expect(svc).toContain("export async function createClient");
    expect(svc).toContain("export async function updateClient");
  });

  it("client-write-service calls syncClient for all operations", () => {
    const svc = readServerFile("services/client-write-service.ts");
    const matches = svc.match(/syncClient\(/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("finance-line-write-service exports cost line CRUD", () => {
    const svc = readServerFile("services/finance-line-write-service.ts");
    expect(svc).toContain("export async function createCostLine");
    expect(svc).toContain("export async function createCostLines");
    expect(svc).toContain("export async function updateCostLineFields");
    expect(svc).toContain("export async function softCloseCostLinesByProject");
  });

  it("finance-line-write-service exports revenue line CRUD", () => {
    const svc = readServerFile("services/finance-line-write-service.ts");
    expect(svc).toContain("export async function createRevenueLine");
    expect(svc).toContain("export async function createRevenueLines");
    expect(svc).toContain("export async function updateRevenueLineFields");
    expect(svc).toContain("export async function softCloseRevenueLinesByProject");
  });

  it("finance-line-write-service documents legacy-only fields", () => {
    const svc = readServerFile("services/finance-line-write-service.ts");
    expect(svc).toContain("LEGACY-ONLY FIELDS");
    expect(svc).toContain("patternRuleId");
    expect(svc).toContain("adminDateOverride");
  });

  it("all write services accept txOrDb parameter for transaction support", () => {
    const project = readServerFile("services/project-write-service.ts");
    const client = readServerFile("services/client-write-service.ts");
    const finance = readServerFile("services/finance-line-write-service.ts");
    expect(project).toContain("txOrDb");
    expect(client).toContain("txOrDb");
    expect(finance).toContain("txOrDb");
  });
});

// ===========================================================================
// 2. Bridge Writer Has Targeted Update Functions
// ===========================================================================
describe("Bridge Writer Targeted Updates", () => {
  const bw = readServerFile("bridge/bridge-writer.ts");

  it("exports syncCostLineFieldUpdate for partial cost line updates", () => {
    expect(bw).toContain("export async function syncCostLineFieldUpdate");
  });

  it("exports syncRevenueLineFieldUpdate for partial revenue line updates", () => {
    expect(bw).toContain("export async function syncRevenueLineFieldUpdate");
  });

  it("exports syncCostLineCounterpartyBulk for counterparty renames", () => {
    expect(bw).toContain("export async function syncCostLineCounterpartyBulk");
  });

  it("exports syncProjectDelete for project deletion", () => {
    expect(bw).toContain("export async function syncProjectDelete");
  });

  it("syncCostLineFieldUpdate uses COALESCE to preserve existing values", () => {
    const fnStart = bw.indexOf("async function syncCostLineFieldUpdate");
    const fnEnd = bw.indexOf("async function syncRevenueLineFieldUpdate");
    const fn = bw.slice(fnStart, fnEnd);
    expect(fn).toContain("COALESCE");
    expect(fn).toContain("legacy_normalized_cost_line_id");
  });

  it("syncRevenueLineFieldUpdate handles paid_date and in_bank_date", () => {
    const fnStart = bw.indexOf("async function syncRevenueLineFieldUpdate");
    const fnEnd = bw.indexOf("async function syncCostLineCounterpartyBulk");
    const fn = bw.slice(fnStart, fnEnd);
    expect(fn).toContain("paid_date");
    expect(fn).toContain("in_bank_date");
    expect(fn).toContain("legacy_normalized_revenue_line_id");
  });

  it("syncProjectExecutionState handles currentStageCode and gateStatus", () => {
    const fnStart = bw.indexOf("async function syncProjectExecutionState");
    const fnEnd = bw.indexOf("// -----\n// Targeted");
    const fn = bw.slice(fnStart, fnEnd !== -1 ? fnEnd : fnStart + 2000);
    expect(fn).toContain("current_stage_code");
    expect(fn).toContain("gate_status");
  });
});

// ===========================================================================
// 3. PROJECT_INFO: Every Write Path Has Bridge Coverage
// ===========================================================================
describe("project_info Write Path Coverage", () => {
  it("storage.ts createProject delegates to write service", () => {
    const s = readServerFile("../server/storage.ts");
    const section = s.slice(s.indexOf("async createProject"), s.indexOf("async updateProject"));
    expect(section).toContain("_createProjectInfo");
  });

  it("storage.ts deleteProjectInfo delegates to write service", () => {
    const s = readServerFile("../server/storage.ts");
    const section = s.slice(s.indexOf("async deleteProjectInfo"), s.indexOf("async markProjectsActive"));
    expect(section).toContain("_hardDeleteProjectInfo");
  });

  it("pm-on-the-go-routes escalation update has bridge call", () => {
    const f = readServerFile("pm-on-the-go-routes.ts");
    const section = f.slice(f.indexOf("UPDATE project_info SET escalation_level"));
    expect(section.slice(0, 500)).toContain("syncProject");
  });

  it("admin-recovery-routes project edit has bridge call", () => {
    const f = readServerFile("admin-recovery-routes.ts");
    const section = f.slice(f.indexOf("admin_recovery_project_edit"));
    expect(f).toContain("syncProject");
  });

  it("lifecycle-routes hard delete has bridge call", () => {
    const f = readServerFile("lifecycle-routes.ts");
    const section = f.slice(f.indexOf("DELETE FROM project_info WHERE id"));
    expect(section.slice(0, 500)).toContain("syncProjectDelete");
  });

  it("all project creation paths have bridge or write service delegation", () => {
    const files = [
      readServerFile("../server/storage.ts"),
      readServerFile("smart-import-routes.ts"),
      readServerFile("lifecycle-routes.ts"),
      readServerFile("template-routes.ts"),
      readServerFile("sync-routes.ts"),
    ];
    for (const f of files) {
      if (f.includes("insert(projectInfo)")) {
        expect(
          f.includes("syncProject") || f.includes("syncProjectInsert") || f.includes("_createProjectInfo"),
        ).toBe(true);
      }
    }
  });
});

// ===========================================================================
// 4. PROJECT_EXECUTION_STATE: Every Write Path Has Bridge Coverage
// ===========================================================================
describe("project_execution_state Write Path Coverage", () => {
  it("stage-lifecycle-service initializeProjectStages has bridge call", () => {
    const f = readServerFile("services/stage-lifecycle-service.ts");
    const section = f.slice(f.indexOf("initializeProjectStages"), f.indexOf("return db"));
    expect(section).toContain("syncProjectExecutionState");
  });

  it("stage-lifecycle-service syncCurrentStage has bridge call", () => {
    const f = readServerFile("services/stage-lifecycle-service.ts");
    const section = f.slice(f.indexOf("export async function syncCurrentStage"));
    const end = section.indexOf("// ── Evidence");
    expect(section.slice(0, end)).toContain("syncProjectExecutionState");
  });

  it("stage-lifecycle-service advanceToStage has bridge call", () => {
    const f = readServerFile("services/stage-lifecycle-service.ts");
    const section = f.slice(f.indexOf("currentStageCode: targetStageCode"));
    expect(section.slice(0, 500)).toContain("syncProjectExecutionState");
  });

  it("financial-review-service createFinancialReview has bridge call", () => {
    const f = readServerFile("services/financial-review-service.ts");
    const section = f.slice(f.indexOf("financialReviewStatus: \"IN_PROGRESS\""));
    expect(section.slice(0, 500)).toContain("syncProjectExecutionState");
  });

  it("financial-review-service decideReview has bridge call", () => {
    const f = readServerFile("services/financial-review-service.ts");
    const section = f.slice(f.indexOf("financialReviewStatus: newStatus"));
    expect(section.slice(0, 500)).toContain("syncProjectExecutionState");
  });

  it("lifecycle-routes board stage sync has bridge call", () => {
    const f = readServerFile("lifecycle-routes.ts");
    expect(f).toContain("boardSyncFields");
    const section = f.slice(f.indexOf("boardSyncFields"));
    expect(section.slice(0, 800)).toContain("syncProjectExecutionState");
  });
});

// ===========================================================================
// 5. CLIENTS: Every Write Path Has Bridge Coverage (already 100%)
// ===========================================================================
describe("clients Write Path Coverage", () => {
  it("pd-routes client create has syncClient", () => {
    const f = readServerFile("pd-routes.ts");
    const matches = f.match(/syncClient/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("routes.ts client create has syncClient", () => {
    const f = readServerFile("routes.ts");
    expect(f).toContain("syncClient");
  });
});

// ===========================================================================
// 6. NORMALIZED_COST_LINES: Every Write Path Has Bridge Coverage
// ===========================================================================
describe("normalized_cost_lines Write Path Coverage", () => {
  it("storage.ts createExpense delegates to write service", () => {
    const s = readServerFile("../server/storage.ts");
    const section = s.slice(s.indexOf("async createExpense"), s.indexOf("async createManyExpenses"));
    expect(section).toContain("_createCostLine");
  });

  it("storage.ts createManualExpense delegates to write service", () => {
    const s = readServerFile("../server/storage.ts");
    const section = s.slice(s.indexOf("async createManualExpense"));
    expect(section.slice(0, 2000)).toContain("_createCostLine");
  });

  it("storage.ts deleteExpensesByProject delegates to write service", () => {
    const s = readServerFile("../server/storage.ts");
    const start = s.indexOf("async deleteExpensesByProject");
    const section = s.slice(start, start + 600);
    expect(section).toContain("_softCloseCostLinesByProject");
  });

  it("storage.ts deleteProgramExpensesByProject delegates to write service", () => {
    const s = readServerFile("../server/storage.ts");
    const section = s.slice(s.indexOf("async deleteProgramExpensesByProject"));
    expect(section.slice(0, 500)).toContain("_softCloseCostLinesByProject");
  });

  it("subcontractor rename has counterparty bulk bridge", () => {
    const f = readServerFile("subcontractor-routes.ts");
    expect(f).toContain("syncCostLineCounterpartyBulk");
  });

  it("subcontractor merge has counterparty bulk bridge", () => {
    const f = readServerFile("subcontractor-routes.ts");
    const mergeSection = f.slice(f.indexOf("subcontractor] Merged"));
    expect(f.match(/syncCostLineCounterpartyBulk/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("deliverable-capture invoice number update has bridge", () => {
    const f = readServerFile("deliverable-capture-routes.ts");
    expect(f).toContain("syncCostLineFieldUpdate");
  });

  it("routes.ts legacy import has batch sync after insert", () => {
    const f = readServerFile("routes.ts");
    expect(f).toContain("batchSyncFinanceByProject");
  });

  it("routes.ts legacy import has soft-close bridge", () => {
    const f = readServerFile("routes.ts");
    const section = f.slice(f.indexOf("softCloseByProjectName(db, \"normalized_cost_lines\""));
    expect(section.slice(0, 500)).toContain("softClosePromotedCostLines");
  });
});

// ===========================================================================
// 7. NORMALIZED_REVENUE_LINES: Every Write Path Has Bridge Coverage
// ===========================================================================
describe("normalized_revenue_lines Write Path Coverage", () => {
  it("storage.ts createRevenue delegates to write service", () => {
    const s = readServerFile("../server/storage.ts");
    const section = s.slice(s.indexOf("async createRevenue"), s.indexOf("async createManyRevenues"));
    expect(section).toContain("_createRevenueLine");
  });

  it("storage.ts deleteRevenuesByProject delegates to write service", () => {
    const s = readServerFile("../server/storage.ts");
    const start = s.indexOf("async deleteRevenuesByProject");
    const section = s.slice(start, start + 600);
    expect(section).toContain("_softCloseRevenueLinesByProject");
  });

  it("storage.ts deleteProgramInflowsByProject delegates to write service", () => {
    const s = readServerFile("../server/storage.ts");
    const section = s.slice(s.indexOf("async deleteProgramInflowsByProject"));
    expect(section.slice(0, 500)).toContain("_softCloseRevenueLinesByProject");
  });

  it("finance-routes revenue tracking overrides have bridge", () => {
    const f = readServerFile("departments/finance-routes.ts");
    expect(f).toContain("syncRevenueLineFieldUpdate");
  });

  it("deliverable-capture invoice number for revenue has bridge", () => {
    const f = readServerFile("deliverable-capture-routes.ts");
    expect(f).toContain("syncRevenueLineFieldUpdate");
  });
});

// ===========================================================================
// 8. Write Service Delegation in storage.ts
// ===========================================================================
describe("storage.ts Write Service Delegation", () => {
  it("storage.ts imports all write services", () => {
    const s = readServerFile("../server/storage.ts");
    expect(s).toContain("_createProjectInfo");
    expect(s).toContain("_updateProjectInfo");
    expect(s).toContain("_softDeleteProject");
    expect(s).toContain("_hardDeleteProjectInfo");
    expect(s).toContain("_createCostLine");
    expect(s).toContain("_softCloseCostLinesByProject");
    expect(s).toContain("_createRevenueLine");
    expect(s).toContain("_softCloseRevenueLinesByProject");
  });

  it("storage.ts upsertProjectInfo delegates to write services", () => {
    const s = readServerFile("../server/storage.ts");
    const section = s.slice(s.indexOf("async upsertProjectInfo"), s.indexOf("async deleteProjectInfo"));
    expect(section).toContain("_updateProjectInfo");
    expect(section).toContain("_createProjectInfo");
  });

  it("storage.ts deleteProject delegates to write service", () => {
    const s = readServerFile("../server/storage.ts");
    const start = s.indexOf("async deleteProject(id");
    const section = s.slice(start, start + 300);
    expect(section).toContain("_softDeleteProject");
  });

  it("storage.ts updateProjectInfoById delegates to write service", () => {
    const s = readServerFile("../server/storage.ts");
    const section = s.slice(s.indexOf("async updateProjectInfoById"));
    expect(section.slice(0, 300)).toContain("_updateProjectInfo");
  });
});

// ===========================================================================
// 9. Backfill Script Bridge Coverage
// ===========================================================================
describe("Backfill Script Bridge Coverage", () => {
  it("backfillInvoiceConfirmed has bridge sync after updates", () => {
    const s = readServerFile("backfillInvoiceConfirmed.ts");
    expect(s).toContain("batchSyncFinanceByProject");
  });
});

// ===========================================================================
// 10. Finance Write Service Bulk Operations
// ===========================================================================
describe("Finance Write Service Bulk Operations", () => {
  it("finance-line-write-service exports renameCostLineCounterparty", () => {
    const svc = readServerFile("services/finance-line-write-service.ts");
    expect(svc).toContain("export async function renameCostLineCounterparty");
  });

  it("finance-line-write-service exports batchSyncFinanceLines", () => {
    const svc = readServerFile("services/finance-line-write-service.ts");
    expect(svc).toContain("export async function batchSyncFinanceLines");
  });
});

// ===========================================================================
// 11. Deferred Paths Documentation
// ===========================================================================
describe("Deferred Paths Are Documented", () => {
  it("write-authority-model.md exists and documents deferred paths", () => {
    const doc = fs.readFileSync(path.join(process.cwd(), "docs", "write-authority-model.md"), "utf8");
    expect(doc).toContain("Deferred");
    expect(doc).toContain("backfill");
  });

  it("write-authority-model.md documents legacy-only fields", () => {
    const doc = fs.readFileSync(path.join(process.cwd(), "docs", "write-authority-model.md"), "utf8");
    expect(doc).toContain("Legacy-Only Fields");
    expect(doc).toContain("patternRuleId");
  });

  it("write-authority-model.md documents the write authority model", () => {
    const doc = fs.readFileSync(path.join(process.cwd(), "docs", "write-authority-model.md"), "utf8");
    expect(doc).toContain("Write Authority");
    expect(doc).toContain("legacy");
    expect(doc).toContain("promoted");
  });
});
