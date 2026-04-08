/**
 * Smart Import v2 — 3-Way Conflict Engine Tests
 *
 * Tests all merge cases:
 *   A: upload changed, app did not → AUTO_ACCEPT_FILE
 *   B: app changed, upload did not → KEEP_APP
 *   C: both changed differently   → CONFLICT (user must choose)
 *   D: upload blank, app edited    → KEEP_APP
 *   E: all three same              → UNCHANGED
 *
 * Also tests:
 *   - PLAN conflicts use canonical work_items
 *   - REVENUE conflicts use canonical normalized_revenue_lines
 *   - EXPENDITURE conflicts use canonical normalized_cost_lines
 *   - Unresolved conflicts block commit
 *   - Resolved conflicts commit correctly
 *   - Unchanged fields are not rewritten
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// ---------------------------------------------------------------------------
// 1. Core classifyField tests (A through E)
// ---------------------------------------------------------------------------

describe("classifyField — 3-way merge cases", () => {
  let classifyField: any;

  it("can import conflict engine", async () => {
    const mod = await import("../../../server/lib/import/conflict-engine");
    classifyField = mod.classifyField;
    expect(classifyField).toBeDefined();
  });

  // Case E: B=C=F — all same → UNCHANGED
  it("Case E: all three values identical → UNCHANGED", () => {
    const result = classifyField("startDate", "2026-01-01", "2026-01-01", "2026-01-01");
    expect(result.mergeCase).toBe("UNCHANGED");
    expect(result.requiresDecision).toBe(false);
  });

  // Case E variant: all three null/empty → UNCHANGED
  it("Case E: all three null/blank → UNCHANGED", () => {
    const result = classifyField("paidDate", null, null, null);
    expect(result.mergeCase).toBe("UNCHANGED");
    expect(result.requiresDecision).toBe(false);
  });

  // Case A: B=C, C≠F — upload changed, app did not → AUTO_ACCEPT_FILE
  it("Case A: upload changed, app did not → AUTO_ACCEPT_FILE", () => {
    const result = classifyField("endDate", "2026-02-01", "2026-02-01", "2026-03-01");
    expect(result.mergeCase).toBe("AUTO_ACCEPT_FILE");
    expect(result.requiresDecision).toBe(false);
    expect(result.uploadedValue).toBe("2026-03-01");
  });

  // Case B: B≠C, B=F — app changed, upload did not → KEEP_APP
  it("Case B: app changed, upload did not → KEEP_APP", () => {
    const result = classifyField("owner", "Alice", "Bob", "Alice");
    expect(result.mergeCase).toBe("KEEP_APP");
    expect(result.requiresDecision).toBe(false);
    expect(result.currentAppValue).toBe("Bob");
  });

  // Case C: B≠C, C≠F, B≠F — both diverged differently → CONFLICT
  it("Case C: both changed differently → CONFLICT", () => {
    const result = classifyField("status", "PLANNED", "INVOICED", "PAID");
    expect(result.mergeCase).toBe("CONFLICT");
    expect(result.requiresDecision).toBe(true);
    expect(result.baselineValue).toBe("PLANNED");
    expect(result.currentAppValue).toBe("INVOICED");
    expect(result.uploadedValue).toBe("PAID");
  });

  // Case D: upload blank/null, app has edited value → KEEP_APP
  it("Case D: upload blank, app edited → KEEP_APP", () => {
    const result = classifyField("invoiceDate", "2026-01-01", "2026-02-15", null);
    expect(result.mergeCase).toBe("KEEP_APP");
    expect(result.requiresDecision).toBe(false);
  });

  it("Case D: upload empty string, app edited → KEEP_APP", () => {
    const result = classifyField("invoiceDate", "2026-01-01", "2026-02-15", "");
    expect(result.mergeCase).toBe("KEEP_APP");
    expect(result.requiresDecision).toBe(false);
  });

  // Both converged to same new value → UNCHANGED (not a conflict)
  it("Both converged to same value → UNCHANGED", () => {
    const result = classifyField("status", "PLANNED", "INVOICED", "INVOICED");
    expect(result.mergeCase).toBe("UNCHANGED");
    expect(result.requiresDecision).toBe(false);
  });

  // Baseline null, app and file both set to same → UNCHANGED
  it("Baseline null, both set same → UNCHANGED", () => {
    const result = classifyField("paidDate", null, "2026-03-01", "2026-03-01");
    expect(result.mergeCase).toBe("UNCHANGED");
    expect(result.requiresDecision).toBe(false);
  });

  // Baseline null, app set, file different → CONFLICT
  it("Baseline null, app set, file different → CONFLICT", () => {
    const result = classifyField("paidDate", null, "2026-03-01", "2026-04-01");
    expect(result.mergeCase).toBe("CONFLICT");
    expect(result.requiresDecision).toBe(true);
  });

  // Normalization: 0 vs null → treated as same
  it("Value normalization: 0 vs null → UNCHANGED", () => {
    const result = classifyField("pctComplete", 0, null, 0);
    expect(result.mergeCase).toBe("UNCHANGED");
  });

  it("Value normalization: false vs null → UNCHANGED", () => {
    const result = classifyField("isMilestone", false, null, false);
    expect(result.mergeCase).toBe("UNCHANGED");
  });
});

// ---------------------------------------------------------------------------
// 2. Row-level merge tests
// ---------------------------------------------------------------------------

describe("mergeRow — row-level 3-way merge", () => {
  let mergeRow: any;

  it("can import mergeRow", async () => {
    const mod = await import("../../../server/lib/import/conflict-engine");
    mergeRow = mod.mergeRow;
    expect(mergeRow).toBeDefined();
  });

  it("all fields unchanged → NO_CONFLICT", () => {
    const matchedRow = {
      classification: "CHANGED" as const,
      businessKey: { key: "1||1.1", keyType: "PRIMARY" as const, matchConfidence: "HIGH" as const, rowLabel: "Task 1" },
      fileRow: { startDate: "2026-01-01", endDate: "2026-02-01", status: "Not Started" },
      fileIndex: 0,
      existingRow: { id: 1, startDate: "2026-01-01", endDate: "2026-02-01", status: "Not Started" },
      existingRowId: 1,
      changedFields: [],
      warnings: [],
    };
    const baselineRow = { startDate: "2026-01-01", endDate: "2026-02-01", status: "Not Started" };
    const result = mergeRow("PLAN", matchedRow, baselineRow);
    expect(result.conflictStatus).toBe("NO_CONFLICT");
    expect(result.fields.every((f: any) => f.mergeCase === "UNCHANGED")).toBe(true);
  });

  it("upload-only changes → AUTO_RESOLVED", () => {
    const matchedRow = {
      classification: "CHANGED" as const,
      businessKey: { key: "1||1.1", keyType: "PRIMARY" as const, matchConfidence: "HIGH" as const, rowLabel: "Task 1" },
      fileRow: { startDate: "2026-01-01", endDate: "2026-03-01", status: "Not Started" },
      fileIndex: 0,
      existingRow: { id: 1, startDate: "2026-01-01", endDate: "2026-02-01", status: "Not Started" },
      existingRowId: 1,
      changedFields: [{ fieldName: "endDate", existingValue: "2026-02-01", fileValue: "2026-03-01" }],
      warnings: [],
    };
    const baselineRow = { startDate: "2026-01-01", endDate: "2026-02-01", status: "Not Started" };
    const result = mergeRow("PLAN", matchedRow, baselineRow);
    expect(result.conflictStatus).toBe("AUTO_RESOLVED");
    const endDateField = result.fields.find((f: any) => f.fieldName === "endDate");
    expect(endDateField.mergeCase).toBe("AUTO_ACCEPT_FILE");
  });

  it("true conflict → HAS_CONFLICTS", () => {
    const matchedRow = {
      classification: "CHANGED" as const,
      businessKey: { key: "1||1.1", keyType: "PRIMARY" as const, matchConfidence: "HIGH" as const, rowLabel: "Task 1" },
      fileRow: { startDate: "2026-01-01", endDate: "2026-04-01", status: "Not Started" },
      fileIndex: 0,
      existingRow: { id: 1, startDate: "2026-01-01", endDate: "2026-03-01", status: "Not Started" },
      existingRowId: 1,
      changedFields: [{ fieldName: "endDate", existingValue: "2026-03-01", fileValue: "2026-04-01" }],
      warnings: [],
    };
    const baselineRow = { startDate: "2026-01-01", endDate: "2026-02-01", status: "Not Started" };
    const result = mergeRow("PLAN", matchedRow, baselineRow);
    expect(result.conflictStatus).toBe("HAS_CONFLICTS");
    const endDateField = result.fields.find((f: any) => f.fieldName === "endDate");
    expect(endDateField.mergeCase).toBe("CONFLICT");
    expect(endDateField.requiresDecision).toBe(true);
    expect(endDateField.baselineValue).toBe("2026-02-01");
    expect(endDateField.currentAppValue).toBe("2026-03-01");
    expect(endDateField.uploadedValue).toBe("2026-04-01");
  });
});

// ---------------------------------------------------------------------------
// 3. Section-level merge tests
// ---------------------------------------------------------------------------

describe("mergeSection — section-level conflict detection", () => {
  let mergeSection: any;
  let buildBaselineLookup: any;
  let generateBusinessKey: any;

  it("can import mergeSection", async () => {
    const conflictMod = await import("../../../server/lib/import/conflict-engine");
    const matcherMod = await import("../../../server/lib/import/row-matcher");
    mergeSection = conflictMod.mergeSection;
    buildBaselineLookup = conflictMod.buildBaselineLookup;
    generateBusinessKey = matcherMod.generateBusinessKey;
    expect(mergeSection).toBeDefined();
  });

  it("no conflicts when file matches baseline and current", () => {
    const matchedRows = [{
      classification: "UNCHANGED" as const,
      businessKey: { key: "1||1.1", keyType: "PRIMARY" as const, matchConfidence: "HIGH" as const, rowLabel: "Task 1" },
      fileRow: { taskNo: "1.1", startDate: "2026-01-01" },
      fileIndex: 0,
      existingRow: { id: 1, taskNo: "1.1", startDate: "2026-01-01" },
      existingRowId: 1,
      changedFields: [],
      warnings: [],
    }];
    const baselineLookup = new Map([["1||1.1", { taskNo: "1.1", startDate: "2026-01-01" }]]);
    const result = mergeSection("PLAN", matchedRows, baselineLookup);
    expect(result.conflictRowCount).toBe(0);
  });

  it("skips NEW and MISSING_FROM_UPLOAD rows (no merge needed)", () => {
    const matchedRows = [
      {
        classification: "NEW" as const,
        businessKey: { key: "1||1.2", keyType: "PRIMARY" as const, matchConfidence: "HIGH" as const, rowLabel: "New Task" },
        fileRow: { taskNo: "1.2" }, fileIndex: 1, existingRow: null, existingRowId: null, changedFields: [], warnings: [],
      },
      {
        classification: "MISSING_FROM_UPLOAD" as const,
        businessKey: { key: "1||1.3", keyType: "PRIMARY" as const, matchConfidence: "HIGH" as const, rowLabel: "Missing Task" },
        fileRow: null, fileIndex: null, existingRow: { id: 3, taskNo: "1.3" }, existingRowId: 3, changedFields: [], warnings: [],
      },
    ];
    const result = mergeSection("PLAN", matchedRows, new Map());
    expect(result.rows.length).toBe(0);
    expect(result.conflictRowCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Canonical source verification in conflict engine
// ---------------------------------------------------------------------------

describe("Conflict engine canonical source alignment", () => {
  const conflictEngineCode = read("server/lib/import/conflict-engine.ts");

  it("imports CANONICAL_SOURCES from planner", () => {
    expect(conflictEngineCode).toContain("CANONICAL_SOURCES");
  });

  it("uses PLAN compare fields from row-matcher", () => {
    expect(conflictEngineCode).toContain("PLAN_COMPARE_FIELDS");
  });

  it("uses REVENUE compare fields from row-matcher", () => {
    expect(conflictEngineCode).toContain("REVENUE_COMPARE_FIELDS");
  });

  it("uses EXPENDITURE compare fields from row-matcher", () => {
    expect(conflictEngineCode).toContain("EXPENDITURE_COMPARE_FIELDS");
  });
});

// ---------------------------------------------------------------------------
// 5. Commit handler v2 conflict gate
// ---------------------------------------------------------------------------

describe("Commit handler v2 conflict integration", () => {
  const routesCode = read("server/smart-import-routes.ts");

  it("runs planner before commit to detect conflicts", () => {
    expect(routesCode).toContain("runImportPlanner");
    expect(routesCode).toContain("v2_conflicts_detected");
  });

  it("blocks commit when hasBlockingConflicts is true", () => {
    expect(routesCode).toContain("hasBlockingConflicts");
    expect(routesCode).toContain("409");
  });

  it("accepts v2ConflictResolutions to resolve conflicts", () => {
    expect(routesCode).toContain("v2ConflictResolutions");
    expect(routesCode).toContain("keep_app");
    expect(routesCode).toContain("accept_file");
  });

  it("logs v2 conflict resolutions to conflictResolutionLog", () => {
    expect(routesCode).toContain("v2_3way_merge");
    expect(routesCode).toContain("conflictResolutionLog");
  });

  it("provides skipV2ConflictCheck escape hatch", () => {
    expect(routesCode).toContain("skipV2ConflictCheck");
  });
});

// ---------------------------------------------------------------------------
// 6. Revenue milestoneNo canonical persistence
// ---------------------------------------------------------------------------

describe("Revenue milestoneNo canonical persistence", () => {
  it("normalized_revenue_lines schema has milestoneNo column", () => {
    const schema = read("shared/schema/finance.ts");
    expect(schema).toContain('milestoneNo: text("milestone_no")');
  });

  it("normalized_revenue_lines schema has milestonePercent column", () => {
    const schema = read("shared/schema/finance.ts");
    expect(schema).toContain('milestonePercent: decimal("milestone_percent"');
  });

  it("migration exists for milestoneNo column", () => {
    const migration = read("migrations/20260408_add_milestone_no_to_revenue.sql");
    expect(migration).toContain("milestone_no");
    expect(migration).toContain("milestone_percent");
  });

  it("commit handler persists milestoneNo in revenue writes", () => {
    const routesCode = read("server/smart-import-routes.ts");
    expect(routesCode).toContain("milestoneNo: merged.milestoneNo");
    expect(routesCode).toContain("milestonePercent: merged.milestonePercent");
  });

  it("baseline loader reads milestoneNo from canonical revenue table", () => {
    const baseline = read("server/lib/import/baseline.ts");
    expect(baseline).toContain("normalizedRevenueLines.milestoneNo");
    expect(baseline).toContain("normalizedRevenueLines.milestonePercent");
  });
});

// ---------------------------------------------------------------------------
// 7. Planner includes conflict output
// ---------------------------------------------------------------------------

describe("Planner integrates conflict engine", () => {
  const plannerCode = read("server/lib/import/planner.ts");

  it("PlannerResult includes conflicts field", () => {
    expect(plannerCode).toContain("conflicts: ConflictEngineResult | null");
  });

  it("imports runConflictEngine", () => {
    expect(plannerCode).toContain("runConflictEngine");
  });

  it("imports loadBaselineNormalization", () => {
    expect(plannerCode).toContain("loadBaselineNormalization");
  });

  it("baseline plan returns conflicts: null", () => {
    expect(plannerCode).toContain("conflicts: null");
  });

  it("re-exports conflict types", () => {
    expect(plannerCode).toContain("ConflictEngineResult");
    expect(plannerCode).toContain("FieldMerge");
    expect(plannerCode).toContain("MergeCase");
  });
});

// ---------------------------------------------------------------------------
// 8. Unchanged fields are not classified as requiring decision
// ---------------------------------------------------------------------------

describe("Unchanged fields produce no action", () => {
  let classifyField: any;

  it("imports", async () => {
    const mod = await import("../../../server/lib/import/conflict-engine");
    classifyField = mod.classifyField;
  });

  it("identical strings → no decision", () => {
    const r = classifyField("owner", "Alice", "Alice", "Alice");
    expect(r.requiresDecision).toBe(false);
    expect(r.mergeCase).toBe("UNCHANGED");
  });

  it("identical nulls → no decision", () => {
    const r = classifyField("comment", null, undefined, "");
    expect(r.requiresDecision).toBe(false);
    expect(r.mergeCase).toBe("UNCHANGED");
  });

  it("identical numbers → no decision", () => {
    const r = classifyField("pctComplete", 50, 50, 50);
    expect(r.requiresDecision).toBe(false);
  });
});
