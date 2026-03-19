import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("Phase 2: sub_project_name on program_expense and program_inflows", () => {
  const schema = read("shared/schema.ts");

  it("program_expense has sub_project_name column", () => {
    const peBlock = schema.substring(
      schema.indexOf('pgTable("program_expense"'),
      schema.indexOf("});", schema.indexOf('pgTable("program_expense"')) + 3
    );
    expect(peBlock).toContain("sub_project_name");
  });

  it("program_inflows has sub_project_name column", () => {
    const piBlock = schema.substring(
      schema.indexOf('pgTable("program_inflows"'),
      schema.indexOf("});", schema.indexOf('pgTable("program_inflows"')) + 3
    );
    expect(piBlock).toContain("sub_project_name");
  });

  it("commit inserts sub_project_name into program_inflows", () => {
    const routes = read("server/smart-import-routes.ts");
    expect(routes).toContain("subProjectName: m.subProjectName || null,");
  });

  it("commit inserts sub_project_name into program_expense", () => {
    const routes = read("server/smart-import-routes.ts");
    // Look for the specific line in program_expense insert
    const peInsertBlock = routes.substring(
      routes.indexOf("budgetCosTotal: toStr(m.budgetCos)"),
      routes.indexOf("await tx.insert(programExpense)")
    );
    expect(peInsertBlock).toContain("subProjectName: m.subProjectName || null");
  });
});

describe("Phase 3: API endpoints support sub-project filtering", () => {
  const routes = read("server/routes.ts");

  it("program-expenses endpoint supports subProject query parameter", () => {
    expect(routes).toContain("req.query.subProject");
    expect(routes).toContain("e.subProjectName === subProject");
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
