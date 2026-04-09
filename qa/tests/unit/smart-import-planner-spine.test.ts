/**
 * Smart Import v2 Planner — Spine Alignment Tests
 *
 * Verifies that:
 * 1. The planner reads from canonical section sources, not derivative tables.
 * 2. PLAN comparison uses work_items (the proven canonical store), not normalizedPlanTasks.
 * 3. Revenue uses milestoneNo when available for identity confidence.
 * 4. The planner is projectId-first.
 * 5. Planner output includes canonical source metadata.
 * 6. Row-matcher produces correct classifications.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// ---------------------------------------------------------------------------
// 1. Canonical source alignment — code-level proof
// ---------------------------------------------------------------------------

describe("Planner canonical source alignment", () => {
  it("CANONICAL_SOURCES declares work_items for PLAN", () => {
    const plannerCode = read("server/lib/import/planner.ts");
    expect(plannerCode).toContain('PLAN: "work_items"');
  });

  it("CANONICAL_SOURCES declares normalized_revenue_lines for REVENUE", () => {
    const plannerCode = read("server/lib/import/planner.ts");
    expect(plannerCode).toContain('REVENUE: "normalized_revenue_lines"');
  });

  it("CANONICAL_SOURCES declares normalized_cost_lines for EXPENDITURE", () => {
    const plannerCode = read("server/lib/import/planner.ts");
    expect(plannerCode).toContain('EXPENDITURE: "normalized_cost_lines"');
  });

  it("SectionPlan type includes canonicalSource field", () => {
    const plannerCode = read("server/lib/import/planner.ts");
    expect(plannerCode).toContain("canonicalSource: string");
  });
});

// ---------------------------------------------------------------------------
// 2. PLAN baseline loader queries work_items, not normalizedPlanTasks
// ---------------------------------------------------------------------------

describe("PLAN baseline loader uses work_items", () => {
  const baselineCode = read("server/lib/import/baseline.ts");

  it("imports workItems from schema", () => {
    expect(baselineCode).toContain("workItems");
  });

  it("loadCurrentPlanRows queries work_items table", () => {
    expect(baselineCode).toContain("loadCurrentPlanRows");
    expect(baselineCode).toContain("workItems");
    // Must filter by source and workstream
    expect(baselineCode).toContain("SMART_IMPORT");
    expect(baselineCode).toContain('"PM"');
  });

  it("does NOT import or query normalizedPlanTasks", () => {
    expect(baselineCode).not.toContain("normalizedPlanTasks");
  });

  it("filters by projectId (spine-first)", () => {
    expect(baselineCode).toContain("workItems.projectId");
  });

  it("filters for active rows via deletedAt IS NULL", () => {
    expect(baselineCode).toContain("deletedAt");
  });
});

// ---------------------------------------------------------------------------
// 3. REVENUE baseline loader uses normalized_revenue_lines
// ---------------------------------------------------------------------------

describe("REVENUE baseline loader uses normalizedRevenueLines", () => {
  const baselineCode = read("server/lib/import/baseline.ts");

  it("imports normalizedRevenueLines from schema", () => {
    expect(baselineCode).toContain("normalizedRevenueLines");
  });

  it("loadCurrentRevenueRows queries with effectiveTo IS NULL", () => {
    expect(baselineCode).toContain("loadCurrentRevenueRows");
    expect(baselineCode).toContain("effectiveTo");
  });

  it("filters by projectId (spine-first)", () => {
    expect(baselineCode).toContain("normalizedRevenueLines.projectId");
  });

  it("does NOT use programInflows as canonical source", () => {
    expect(baselineCode).not.toContain("programInflows");
  });
});

// ---------------------------------------------------------------------------
// 4. EXPENDITURE baseline loader uses normalized_cost_lines
// ---------------------------------------------------------------------------

describe("EXPENDITURE baseline loader uses normalizedCostLines", () => {
  const baselineCode = read("server/lib/import/baseline.ts");

  it("imports normalizedCostLines from schema", () => {
    expect(baselineCode).toContain("normalizedCostLines");
  });

  it("loadCurrentCostRows queries with effectiveTo IS NULL", () => {
    expect(baselineCode).toContain("loadCurrentCostRows");
    expect(baselineCode).toContain("effectiveTo");
  });

  it("filters by projectId (spine-first)", () => {
    expect(baselineCode).toContain("normalizedCostLines.projectId");
  });

  it("does NOT use programExpense as canonical source", () => {
    expect(baselineCode).not.toContain("programExpense");
  });
});

// ---------------------------------------------------------------------------
// 5. Revenue milestone_no is preserved through normalization
// ---------------------------------------------------------------------------

describe("Revenue milestoneNo preserved in normalizer", () => {
  const normalizerCode = read("server/lib/import/normalizer.ts");

  it("NormalizationResult type includes milestoneNo field", () => {
    expect(normalizerCode).toContain("milestoneNo: string | null");
  });

  it("NormalizationResult type includes milestonePercent field", () => {
    expect(normalizerCode).toContain("milestonePercent: string | null");
  });

  it("extracts milestoneNo column index from mapping", () => {
    expect(normalizerCode).toContain('getColIndex(mapping, "milestone_no")');
  });

  it("extracts milestonePercent column index from mapping", () => {
    expect(normalizerCode).toContain('getColIndex(mapping, "percent")');
  });
});

// ---------------------------------------------------------------------------
// 6. Row matcher — revenue identity uses milestoneNo for confidence
// ---------------------------------------------------------------------------

describe("Revenue row matcher uses milestoneNo for confidence", () => {
  const matcherCode = read("server/lib/import/row-matcher.ts");

  it("revenueBusinessKey accepts milestoneNo parameter", () => {
    expect(matcherCode).toContain("milestoneNo?: string | null");
  });

  it("upgrades to HIGH confidence when milestoneNo is available", () => {
    // The function should check hasMilestoneNo and set confidence accordingly
    expect(matcherCode).toContain("hasMilestoneNo");
    expect(matcherCode).toMatch(/matchConfidence.*HIGH/);
  });

  it("milestonePercent is in REVENUE_COMPARE_FIELDS (compared, not identity)", () => {
    expect(matcherCode).toContain('"milestonePercent"');
  });
});

// ---------------------------------------------------------------------------
// 7. Row matcher — unit tests for matching logic
// ---------------------------------------------------------------------------

describe("Row matcher classifications", () => {
  // Dynamic import to test the actual logic
  let matchRows: any;
  let planBusinessKey: any;
  let revenueBusinessKey: any;
  let expenditureBusinessKey: any;

  it("can be imported", async () => {
    const mod = await import("../../../server/lib/import/row-matcher");
    matchRows = mod.matchRows;
    planBusinessKey = mod.planBusinessKey;
    revenueBusinessKey = mod.revenueBusinessKey;
    expenditureBusinessKey = mod.expenditureBusinessKey;
  });

  it("PLAN: uses taskNo as PRIMARY key when available", async () => {
    const bk = planBusinessKey(1, { taskNo: "1.2.3", taskName: "Install", phase: "Construction", subProjectName: null });
    expect(bk.keyType).toBe("PRIMARY");
    expect(bk.matchConfidence).toBe("HIGH");
    expect(bk.key).toContain("1.2.3");
  });

  it("PLAN: falls back to taskName with LOW confidence when taskNo missing", async () => {
    const bk = planBusinessKey(1, { taskNo: null, taskName: "Install Panels", phase: "Construction", subProjectName: null });
    expect(bk.keyType).toBe("FALLBACK");
    expect(bk.matchConfidence).toBe("LOW");
    expect(bk.key).toContain("install panels");
  });

  it("REVENUE: upgrades to HIGH confidence when milestoneNo present", async () => {
    const bk = revenueBusinessKey(1, { milestoneNo: "3", milestoneName: "Milestone 3", subProjectName: null });
    expect(bk.keyType).toBe("PRIMARY");
    expect(bk.matchConfidence).toBe("HIGH");
  });

  it("REVENUE: MEDIUM confidence when only milestoneName", async () => {
    const bk = revenueBusinessKey(1, { milestoneNo: null, milestoneName: "Milestone 3", subProjectName: null });
    expect(bk.keyType).toBe("FALLBACK");
    expect(bk.matchConfidence).toBe("MEDIUM");
  });

  it("REVENUE: keys match between file (with milestoneNo) and DB (without)", async () => {
    // File row has milestoneNo, DB row doesn't — both should produce the same key
    const fileKey = revenueBusinessKey(1, { milestoneNo: "3", milestoneName: "Milestone 3", subProjectName: null });
    const dbKey = revenueBusinessKey(1, { milestoneNo: null, milestoneName: "Milestone 3", subProjectName: null });
    expect(fileKey.key).toBe(dbKey.key);
  });

  it("EXPENDITURE: uses invoiceNumber as PRIMARY key", async () => {
    const bk = expenditureBusinessKey(1, { invoiceNumber: "INV-001", description: "Inverter", costCategory: "Electrical", counterpartyName: "SMA", subProjectName: null });
    expect(bk.keyType).toBe("PRIMARY");
    expect(bk.matchConfidence).toBe("HIGH");
  });

  it("EXPENDITURE: falls back to category+counterparty+description", async () => {
    const bk = expenditureBusinessKey(1, { invoiceNumber: null, description: "Inverter", costCategory: "Electrical", counterpartyName: "SMA", subProjectName: null });
    expect(bk.keyType).toBe("FALLBACK");
    expect(bk.matchConfidence).toBe("MEDIUM");
  });

  it("matchRows: identical rows → UNCHANGED", async () => {
    const file = [{ taskName: "T1", taskNo: "1.1", subProjectName: null, phase: null, startDate: "2026-01-01", endDate: "2026-02-01", durationDays: null, actualStartDate: null, actualEndDate: null, actualDurationDays: null, owner: null, status: "Not Started", pctComplete: null, expectedPctComplete: null, comment: null, isMilestone: false, parentTaskNo: null }];
    const existing = [{ id: 1, taskName: "T1", taskNo: "1.1", subProjectName: null, phase: null, startDate: "2026-01-01", endDate: "2026-02-01", durationDays: null, actualStartDate: null, actualEndDate: null, actualDurationDays: null, owner: null, status: "Not Started", pctComplete: 0, expectedPctComplete: null, comment: null, isMilestone: false, parentTaskNo: null }];
    const result = matchRows("PLAN", 1, file, existing);
    expect(result[0].classification).toBe("UNCHANGED");
  });

  it("matchRows: changed field → CHANGED", async () => {
    const file = [{ taskName: "T1", taskNo: "1.1", subProjectName: null, phase: null, startDate: "2026-01-01", endDate: "2026-03-01", durationDays: null, actualStartDate: null, actualEndDate: null, actualDurationDays: null, owner: null, status: "Not Started", pctComplete: null, expectedPctComplete: null, comment: null, isMilestone: false, parentTaskNo: null }];
    const existing = [{ id: 1, taskName: "T1", taskNo: "1.1", subProjectName: null, phase: null, startDate: "2026-01-01", endDate: "2026-02-01", durationDays: null, actualStartDate: null, actualEndDate: null, actualDurationDays: null, owner: null, status: "Not Started", pctComplete: 0, expectedPctComplete: null, comment: null, isMilestone: false, parentTaskNo: null }];
    const result = matchRows("PLAN", 1, file, existing);
    expect(result[0].classification).toBe("CHANGED");
    expect(result[0].changedFields.some((f: any) => f.fieldName === "endDate")).toBe(true);
  });

  it("matchRows: new row in file → NEW", async () => {
    const file = [{ taskName: "T1", taskNo: "1.1", subProjectName: null, phase: null, startDate: "2026-01-01", endDate: "2026-02-01", durationDays: null, actualStartDate: null, actualEndDate: null, actualDurationDays: null, owner: null, status: null, pctComplete: null, expectedPctComplete: null, comment: null, isMilestone: false, parentTaskNo: null }];
    const result = matchRows("PLAN", 1, file, []);
    expect(result[0].classification).toBe("NEW");
  });

  it("matchRows: existing row not in file → MISSING_FROM_UPLOAD", async () => {
    const existing = [{ id: 1, taskName: "T1", taskNo: "1.1", subProjectName: null, phase: null, startDate: "2026-01-01", endDate: "2026-02-01", durationDays: null, actualStartDate: null, actualEndDate: null, actualDurationDays: null, owner: null, status: null, pctComplete: null, expectedPctComplete: null, comment: null, isMilestone: false, parentTaskNo: null }];
    const result = matchRows("PLAN", 1, [], existing);
    expect(result[0].classification).toBe("MISSING_FROM_UPLOAD");
  });

  it("projectId is embedded in business keys (projectId-first)", async () => {
    const bk1 = planBusinessKey(10, { taskNo: "1.1", taskName: "T1", subProjectName: null });
    const bk2 = planBusinessKey(20, { taskNo: "1.1", taskName: "T1", subProjectName: null });
    expect(bk1.key).not.toBe(bk2.key);
    expect(bk1.key).toContain("10");
    expect(bk2.key).toContain("20");
  });
});

// ---------------------------------------------------------------------------
// 8. Planner uses same path for file and folder uploads
// ---------------------------------------------------------------------------

describe("File and folder upload use same planner", () => {
  it("both upload paths go through POST /api/smart-import/upload", () => {
    const routesCode = read("server/smart-import-routes.ts");
    // There should be exactly one upload endpoint
    const uploadRoutes = routesCode.match(/router\.(post|get)\("\/api\/smart-import\/upload"/g);
    expect(uploadRoutes).not.toBeNull();
    expect(uploadRoutes!.length).toBe(1);
  });

  it("the plan endpoint is accessible for any import run regardless of source", () => {
    const routesCode = read("server/smart-import-routes.ts");
    expect(routesCode).toContain('"/api/smart-import/:runId/plan"');
    // The plan endpoint does not check upload source — it works on any runId
    const planEndpoint = routesCode.slice(routesCode.indexOf('"/api/smart-import/:runId/plan"'));
    expect(planEndpoint).not.toContain("uploadSource");
    expect(planEndpoint).not.toContain("folderUpload");
  });
});
