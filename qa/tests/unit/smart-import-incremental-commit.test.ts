/**
 * Smart Import v2 — Incremental Commit Tests
 *
 * Verifies that:
 * 1. Commit executor module exists and exports correct functions
 * 2. resolveFieldValues correctly applies merge decisions
 * 3. Route refactor gates v1 behind useV2 flag
 * 4. v2 path writes to canonical targets only
 * 5. Unchanged rows are not rewritten
 * 6. Missing rows do not trigger blanket replacement
 * 7. File and folder imports use the same v2 path
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// ---------------------------------------------------------------------------
// 1. Commit executor module structure
// ---------------------------------------------------------------------------

describe("Commit executor module exists and exports", () => {
  const code = read("server/lib/import/commit-executor.ts");

  it("exports writePlanIncremental", () => {
    expect(code).toContain("export async function writePlanIncremental");
  });

  it("exports writeRevenueIncremental", () => {
    expect(code).toContain("export async function writeRevenueIncremental");
  });

  it("exports writeExpenditureIncremental", () => {
    expect(code).toContain("export async function writeExpenditureIncremental");
  });

  it("exports resolveFieldValues", () => {
    expect(code).toContain("export function resolveFieldValues");
  });

  it("imports CANONICAL_SOURCES from planner", () => {
    expect(code).toContain("CANONICAL_SOURCES");
  });
});

// ---------------------------------------------------------------------------
// 2. resolveFieldValues unit tests
// ---------------------------------------------------------------------------

describe("resolveFieldValues — merge decision application", () => {
  let resolveFieldValues: any;

  it("can import resolveFieldValues", async () => {
    const mod = await import("../../../server/lib/import/commit-executor");
    resolveFieldValues = mod.resolveFieldValues;
    expect(resolveFieldValues).toBeDefined();
  });

  it("baseline import: uses all file values", () => {
    const file = { startDate: "2026-01-01", endDate: "2026-02-01", status: "Not Started" };
    const existing = {};
    const result = resolveFieldValues(file, existing, null, {}, ["startDate", "endDate", "status"]);
    expect(result.startDate).toBe("2026-01-01");
    expect(result.endDate).toBe("2026-02-01");
    expect(result.status).toBe("Not Started");
  });

  it("UNCHANGED fields are not included in updates", () => {
    const file = { startDate: "2026-01-01", endDate: "2026-02-01" };
    const existing = { startDate: "2026-01-01", endDate: "2026-02-01" };
    const mergeResult = {
      rowKey: "test", displayLabel: "test", section: "PLAN" as const, canonicalSource: "work_items",
      existingRowId: 1, fileIndex: 0, conflictStatus: "NO_CONFLICT" as const,
      fields: [
        { fieldName: "startDate", baselineValue: "2026-01-01", currentAppValue: "2026-01-01", uploadedValue: "2026-01-01", mergeCase: "UNCHANGED" as const, requiresDecision: false },
        { fieldName: "endDate", baselineValue: "2026-02-01", currentAppValue: "2026-02-01", uploadedValue: "2026-02-01", mergeCase: "UNCHANGED" as const, requiresDecision: false },
      ],
    };
    const result = resolveFieldValues(file, existing, mergeResult, {}, ["startDate", "endDate"]);
    expect(Object.keys(result).length).toBe(0);
  });

  it("AUTO_ACCEPT_FILE includes file value", () => {
    const mergeResult = {
      rowKey: "test", displayLabel: "test", section: "PLAN" as const, canonicalSource: "work_items",
      existingRowId: 1, fileIndex: 0, conflictStatus: "AUTO_RESOLVED" as const,
      fields: [
        { fieldName: "endDate", baselineValue: "2026-02-01", currentAppValue: "2026-02-01", uploadedValue: "2026-03-01", mergeCase: "AUTO_ACCEPT_FILE" as const, requiresDecision: false },
      ],
    };
    const result = resolveFieldValues(
      { endDate: "2026-03-01" }, { endDate: "2026-02-01" },
      mergeResult, {}, ["endDate"],
    );
    expect(result.endDate).toBe("2026-03-01");
  });

  it("KEEP_APP does not include any updates", () => {
    const mergeResult = {
      rowKey: "test", displayLabel: "test", section: "PLAN" as const, canonicalSource: "work_items",
      existingRowId: 1, fileIndex: 0, conflictStatus: "AUTO_RESOLVED" as const,
      fields: [
        { fieldName: "owner", baselineValue: "Alice", currentAppValue: "Bob", uploadedValue: "Alice", mergeCase: "KEEP_APP" as const, requiresDecision: false },
      ],
    };
    const result = resolveFieldValues(
      { owner: "Alice" }, { owner: "Bob" },
      mergeResult, {}, ["owner"],
    );
    expect(result.owner).toBeUndefined();
  });

  it("CONFLICT resolved as accept_file includes file value", () => {
    const mergeResult = {
      rowKey: "1||1.1", displayLabel: "test", section: "PLAN" as const, canonicalSource: "work_items",
      existingRowId: 1, fileIndex: 0, conflictStatus: "HAS_CONFLICTS" as const,
      fields: [
        { fieldName: "status", baselineValue: "PLANNED", currentAppValue: "INVOICED", uploadedValue: "PAID", mergeCase: "CONFLICT" as const, requiresDecision: true },
      ],
    };
    const decisions = { "1||1.1::status": "accept_file" as const };
    const result = resolveFieldValues(
      { status: "PAID" }, { status: "INVOICED" },
      mergeResult, decisions, ["status"],
    );
    expect(result.status).toBe("PAID");
  });

  it("CONFLICT resolved as keep_app does not update", () => {
    const mergeResult = {
      rowKey: "1||1.1", displayLabel: "test", section: "PLAN" as const, canonicalSource: "work_items",
      existingRowId: 1, fileIndex: 0, conflictStatus: "HAS_CONFLICTS" as const,
      fields: [
        { fieldName: "status", baselineValue: "PLANNED", currentAppValue: "INVOICED", uploadedValue: "PAID", mergeCase: "CONFLICT" as const, requiresDecision: true },
      ],
    };
    const decisions = { "1||1.1::status": "keep_app" as const };
    const result = resolveFieldValues(
      { status: "PAID" }, { status: "INVOICED" },
      mergeResult, decisions, ["status"],
    );
    expect(result.status).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Route uses v2 incremental path
// ---------------------------------------------------------------------------

describe("Commit route v2 incremental path", () => {
  const routesCode = read("server/smart-import-routes.ts");

  it("imports commit executor functions", () => {
    expect(routesCode).toContain("writePlanIncremental");
    expect(routesCode).toContain("writeRevenueIncremental");
    expect(routesCode).toContain("writeExpenditureIncremental");
  });

  it("has useV2 gate variable inside transaction", () => {
    expect(routesCode).toContain("const useV2 = !skipV2ConflictCheck && projectId");
  });

  it("v1 path is behind if (!useV2) guard", () => {
    expect(routesCode).toContain("if (!useV2)");
    expect(routesCode).toContain("end if (!useV2)");
  });

  it("v2 path calls writePlanIncremental", () => {
    expect(routesCode).toContain("await writePlanIncremental({");
  });

  it("v2 path calls writeRevenueIncremental", () => {
    expect(routesCode).toContain("await writeRevenueIncremental({");
  });

  it("v2 path calls writeExpenditureIncremental", () => {
    expect(routesCode).toContain("await writeExpenditureIncremental({");
  });

  it("v2 path loads current state via baseline module", () => {
    expect(routesCode).toContain("loadCurrentPlanRows(projectId)");
    expect(routesCode).toContain("loadCurrentRevenueRows(projectId)");
    expect(routesCode).toContain("loadCurrentCostRows(projectId)");
  });

  it("v2 path runs matchRows for each section", () => {
    const v2Section = routesCode.slice(routesCode.indexOf("Incremental commit path"));
    expect(v2Section).toContain('matchRows("PLAN"');
    expect(v2Section).toContain('matchRows("REVENUE"');
    expect(v2Section).toContain('matchRows("EXPENDITURE"');
  });

  it("v2 path still marks run as COMMITTED", () => {
    expect(routesCode).toContain('status: "COMMITTED"');
  });
});

// ---------------------------------------------------------------------------
// 4. Write targets are canonical
// ---------------------------------------------------------------------------

describe("Canonical write targets in commit executor", () => {
  const code = read("server/lib/import/commit-executor.ts");

  it("PLAN writes to work_items", () => {
    expect(code).toContain("tx.insert(workItems)");
    expect(code).toContain("tx.update(workItems)");
  });

  it("REVENUE writes to normalizedRevenueLines", () => {
    expect(code).toContain("tx.insert(normalizedRevenueLines)");
    expect(code).toContain("tx.update(normalizedRevenueLines)");
  });

  it("EXPENDITURE writes to normalizedCostLines", () => {
    expect(code).toContain("tx.insert(normalizedCostLines)");
    expect(code).toContain("tx.update(normalizedCostLines)");
  });

  it("does NOT write to programExpense as canonical target", () => {
    expect(code).not.toContain("programExpense");
  });

  it("does NOT write to programInflows as canonical target", () => {
    expect(code).not.toContain("programInflows");
  });

  it("does NOT write to normalizedPlanTasks", () => {
    expect(code).not.toContain("normalizedPlanTasks");
  });
});

// ---------------------------------------------------------------------------
// 5. UNCHANGED rows are not rewritten
// ---------------------------------------------------------------------------

describe("UNCHANGED row handling in section writers", () => {
  const code = read("server/lib/import/commit-executor.ts");

  it("PLAN writer skips UNCHANGED classification", () => {
    expect(code).toContain('if (mr.classification === "UNCHANGED")');
    expect(code).toContain("counts.unchanged++");
  });

  it("REVENUE writer skips UNCHANGED classification", () => {
    // All three writers have the same pattern
    const unchangedBlocks = code.match(/mr\.classification === "UNCHANGED"/g);
    expect(unchangedBlocks).not.toBeNull();
    expect(unchangedBlocks!.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// 6. MISSING rows do not trigger blanket replacement
// ---------------------------------------------------------------------------

describe("MISSING_FROM_UPLOAD row handling", () => {
  const code = read("server/lib/import/commit-executor.ts");

  it("MISSING rows increment missing count without delete", () => {
    expect(code).toContain('if (mr.classification === "MISSING_FROM_UPLOAD")');
    expect(code).toContain("counts.missing++");
  });

  it("MISSING handler only increments count and continues", () => {
    // Extract the MISSING handler pattern: classification check → increment → continue
    // Every section writer has: if (mr.classification === "MISSING_FROM_UPLOAD") { counts.missing++; continue; }
    const missingPattern = /MISSING_FROM_UPLOAD.*?\{[^}]*counts\.missing\+\+[^}]*continue/s;
    expect(code).toMatch(missingPattern);
  });

  it("v2 path does NOT call softCloseByProjectId for canonical tables", () => {
    // The v2 path should not have blanket soft-close
    const routesCode = read("server/smart-import-routes.ts");
    const v2Section = routesCode.slice(
      routesCode.indexOf("Smart Import v2: Incremental commit path"),
      routesCode.indexOf("End v2 incremental commit path"),
    );
    expect(v2Section).not.toContain("softCloseByProjectId");
    expect(v2Section).not.toContain("softCloseByProjectName");
  });
});

// ---------------------------------------------------------------------------
// 7. Temporal model for CHANGED rows
// ---------------------------------------------------------------------------

describe("CHANGED row temporal handling", () => {
  const code = read("server/lib/import/commit-executor.ts");

  it("REVENUE: soft-closes only the specific changed row, then inserts replacement", () => {
    // Must update effectiveTo on the specific existing row
    expect(code).toContain("effectiveTo: commitTimestamp");
    expect(code).toContain(".where(eq(normalizedRevenueLines.id, existingId))");
  });

  it("EXPENDITURE: soft-closes only the specific changed row, then inserts replacement", () => {
    expect(code).toContain(".where(eq(normalizedCostLines.id, existingId))");
  });

  it("PLAN: updates the existing work_items row in-place", () => {
    expect(code).toContain(".where(eq(workItems.id, existingId))");
  });

  it("carries forward admin date overrides on revenue replacement rows", () => {
    expect(code).toContain("adminDateOverride: existingRow.adminDateOverride");
  });

  it("carries forward app-owned fields on cost replacement rows", () => {
    expect(code).toContain("noRevenueLinked: existing.noRevenueLinked");
    expect(code).toContain("cosRealised: existing.cosRealised");
  });
});

// ---------------------------------------------------------------------------
// 8. File and folder parity
// ---------------------------------------------------------------------------

describe("File and folder imports use same v2 commit path", () => {
  const routesCode = read("server/smart-import-routes.ts");

  it("v2 path does not check upload method/source", () => {
    const v2Section = routesCode.slice(
      routesCode.indexOf("Smart Import v2: Incremental commit path"),
      routesCode.indexOf("End v2 incremental commit path"),
    );
    expect(v2Section).not.toContain("uploadSource");
    expect(v2Section).not.toContain("folderUpload");
    expect(v2Section).not.toContain("isBatch");
  });
});

// ---------------------------------------------------------------------------
// 9. Audit trail
// ---------------------------------------------------------------------------

describe("v2 commit audit trail", () => {
  const routesCode = read("server/smart-import-routes.ts");

  it("v2 path updates recordsAttempted/Succeeded on smart_import_runs", () => {
    // Inside the v2 block
    const v2Section = routesCode.slice(
      routesCode.indexOf("Smart Import v2: Incremental commit path"),
      routesCode.indexOf("End v2 incremental commit path"),
    );
    expect(v2Section).toContain("recordsAttempted");
    expect(v2Section).toContain("recordsSucceeded");
  });
});
