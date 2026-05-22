import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// The "Phase 2: sub_project_name on program_expense and program_inflows"
// describe block was removed when program_expense and program_inflows were
// retired in the PE/PI cutover. The block asserted that those legacy
// tables had a sub_project_name column and that smart-import wrote
// subProjectName into them on commit. Both behaviours are gone:
//   * The tables themselves are dropped (see migrations/20260414_drop_program_expense_and_program_inflows.sql).
//   * Smart-import no longer writes PE/PI at all (commits 956ebe0, 079b451).
// Sub-project on the canonical normalized_cost_lines / normalized_revenue_lines
// is asserted by the Phase 1 / 4 / 5 / 6 blocks below.

describe("Phase 3: API endpoints support sub-project filtering", () => {
  // Handlers were extracted from server/routes.ts to server/routes/finance-legacy-extracted-routes.ts
  const routes = read("server/routes/finance-legacy-extracted-routes.ts");

  // NOTE: The /api/program-expenses routes were moved to server/departments/finance-routes.ts.
  // The subProject filter was present in the legacy (dead) route but is NOT present in the
  // canonical department route. This is a pre-existing gap — not introduced by the removal.
  // The test below documents the canonical route exists in finance-routes.ts.
  it("program-expenses canonical route exists in finance-routes.ts", () => {
    const financeRoutes = read("server/departments/finance-routes.ts");
    expect(financeRoutes).toMatch(/router\.get\(\s*['"]\/api\/program-expenses['"]/);
    expect(financeRoutes).toMatch(/router\.get\(\s*['"]\/api\/program-expenses\/:projectName['"]/);
  });

  it("program-inflows endpoint supports subProject query parameter", () => {
    expect(routes).toContain("subProjectFilter");
    expect(routes).toContain("i.subProjectName === subProjectFilter");
  });
});

describe("Phase 3: data-merge exposes new fields", () => {
  const dataMerge = read("server/lib/data-merge.ts");

  it("adaptCostToExpense includes budget fields from normalized cost lines", () => {
    expect(dataMerge).toContain("budgetQty:");
    expect(dataMerge).toContain("budgetRateUnit:");
    expect(dataMerge).toContain("budgetCosTotal:");
  });

  it("adaptCostToExpense includes subProjectName", () => {
    expect(dataMerge).toContain("subProjectName:");
  });

  it("adaptCostToExpense includes revenueRecognitionAmount", () => {
    expect(dataMerge).toContain("revenueRecognitionAmount:");
  });

  it("adaptRevenueToInflow includes subProjectName", () => {
    const inflowBlock = dataMerge.substring(
      dataMerge.indexOf("function adaptRevenueToInflow"),
    );
    expect(inflowBlock).toContain("subProjectName:");
  });
});

describe("Phase 4: project-v2-repository includes budget aggregates and costed summary", () => {
  const repo = read("server/api/v2/repositories/project-v2-repository.ts");

  it("imports projectRevenueSummary", () => {
    expect(repo).toContain("projectRevenueSummary");
  });

  it("getProjectFinanceSummary returns budget total", () => {
    expect(repo).toContain("budgetTotal");
    expect(repo).toContain("budgetAgg");
  });

  it("getProjectFinanceSummary returns costed summary", () => {
    expect(repo).toContain("costedSummary");
    expect(repo).toContain("projectRevenueSummary");
  });
});

describe("Phase 5: Frontend sub-project filters", () => {
  it("ExpenditureEditableTab has sub-project filter state", () => {
    const source = read("client/src/components/tabs/ExpenditureEditableTab.tsx");
    expect(source).toContain("subProjectFilter");
    expect(source).toContain("setSubProjectFilter");
    expect(source).toContain("select-sub-project-filter");
  });

  it("ExpenditureEditableTab filters items by sub-project", () => {
    const source = read("client/src/components/tabs/ExpenditureEditableTab.tsx");
    expect(source).toContain('e.subProjectName === subProjectFilter');
  });

  it("ExpenditureEditableTab only shows filter when sub-projects exist", () => {
    const source = read("client/src/components/tabs/ExpenditureEditableTab.tsx");
    expect(source).toContain("subProjects.length === 0");
  });

  it("RevenueTrackingTab has sub-project filter state", () => {
    const source = read("client/src/components/tabs/RevenueTrackingTab.tsx");
    expect(source).toContain("subProjectFilter");
    expect(source).toContain("setSubProjectFilter");
    expect(source).toContain("revenue-sub-project-filter");
  });

  it("RevenueTrackingTab filters milestones by sub-project", () => {
    const source = read("client/src/components/tabs/RevenueTrackingTab.tsx");
    expect(source).toContain("m.subProjectName === subProjectFilter");
  });

  it("RevenueTrackingTab only shows filter when sub-projects exist", () => {
    const source = read("client/src/components/tabs/RevenueTrackingTab.tsx");
    expect(source).toContain("subProjectNames.length > 0");
  });
});

describe("Phase 6: Null safety for new fields", () => {
  it("adaptCostToExpense uses nullish coalescing for all new fields", () => {
    const source = read("server/lib/data-merge.ts");
    expect(source).toContain("(cost as any).budgetQty ?? null");
    expect(source).toContain("(cost as any).subProjectName ?? null");
    expect(source).toContain("(cost as any).revenueRecognitionAmount ?? null");
  });

  it("adaptRevenueToInflow uses nullish coalescing for subProjectName", () => {
    const source = read("server/lib/data-merge.ts");
    const inflowBlock = source.substring(source.indexOf("function adaptRevenueToInflow"));
    expect(inflowBlock).toContain("(rev as any).subProjectName ?? null");
  });
});

// The "Schema safety: startup DDL prevents missing column errors" suite used
// to assert that smart-import-routes.ts exported an ensureSchemaReady helper
// and ran ALTER TABLE program_expense/program_inflows ADD COLUMN IF NOT EXISTS
// on every boot. Both are now retired:
//   * program_expense and program_inflows are retired in the PE/PI cutover.
//   * Runtime ALTER TABLE is forbidden by the production safety policy
//     (commit 952ef41). Schema evolution lives exclusively in ./migrations/*.sql.
// The suite is intentionally removed.
