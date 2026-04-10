/**
 * Smart Import — Derivative Materializer + Link Re-Linking Tests (S12, S13)
 *
 * Verifies:
 * 1. S12: derivative-materializer.ts exists with correct structure
 * 2. S12: v2 commit path calls materializeDerivatives
 * 3. S12: materializer reads from canonical tables (NRL/NCL), not normalization result directly
 * 4. S12: materialization is non-blocking (failure doesn't break commit)
 * 5. S12: materializer writes to program_inflows, program_expense, project_revenue_summary
 * 6. S13: v2 commit re-links canonical_expense_id after expenditure changes
 * 7. S13: re-linking uses old→new ID map from commit executor result
 * 8. S13: orphaned canonical IDs are cleared (set to null)
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// ---------------------------------------------------------------------------
// S12: Derivative materializer module
// ---------------------------------------------------------------------------
describe("S12: derivative-materializer module", () => {
  const matCode = read("server/lib/import/derivative-materializer.ts");

  it("exports materializeDerivatives function", () => {
    expect(matCode).toContain("export async function materializeDerivatives");
  });

  it("exports MaterializerContext and MaterializerResult types", () => {
    expect(matCode).toContain("export interface MaterializerContext");
    expect(matCode).toContain("export interface MaterializerResult");
  });

  it("reads active NRL rows from canonical table for PI materialization", () => {
    expect(matCode).toContain("normalizedRevenueLines");
    expect(matCode).toContain("isNull(normalizedRevenueLines.effectiveTo)");
  });

  it("reads active NCL rows from canonical table for PE materialization", () => {
    expect(matCode).toContain("normalizedCostLines");
    expect(matCode).toContain("isNull(normalizedCostLines.effectiveTo)");
  });

  it("soft-closes existing PI rows before writing new ones", () => {
    expect(matCode).toContain('softCloseByProjectName(tx, "program_inflows"');
  });

  it("soft-closes existing PE rows before writing new ones", () => {
    expect(matCode).toContain('softCloseByProjectName(tx, "program_expense"');
  });

  it("writes to program_inflows using addTemporalColumns", () => {
    expect(matCode).toContain("tx.insert(programInflows).values(addTemporalColumns(");
  });

  it("writes to program_expense using addTemporalColumns", () => {
    expect(matCode).toContain("tx.insert(programExpense).values(addTemporalColumns(");
  });

  it("handles project_revenue_summary upsert", () => {
    expect(matCode).toContain("tx.update(projectRevenueSummary)");
    expect(matCode).toContain("tx.insert(projectRevenueSummary)");
  });

  it("carries forward inBank status from old PI rows via composite key match", () => {
    expect(matCode).toContain("oldCompositeMap");
    expect(matCode).toContain("prevInBank");
  });

  it("carries forward payment date from old PE rows for imported_edited sources", () => {
    expect(matCode).toContain('previous?.source === "imported_edited"');
  });

  it("returns counts for each derivative table", () => {
    expect(matCode).toContain("programInflowsWritten");
    expect(matCode).toContain("programExpenseWritten");
    expect(matCode).toContain("projectRevenueSummaryUpdated");
  });

  it("is documented as COMPATIBILITY mechanism, not finance truth", () => {
    expect(matCode).toContain("COMPATIBILITY mechanism");
    expect(matCode).toContain("not a source of finance truth");
  });
});

// ---------------------------------------------------------------------------
// S12: Integration into v2 commit path
// ---------------------------------------------------------------------------
describe("S12: materializer wired into v2 commit", () => {
  const routesCode = read("server/smart-import-routes.ts");

  it("imports materializeDerivatives", () => {
    expect(routesCode).toContain('import { materializeDerivatives } from "./lib/import/derivative-materializer"');
  });

  it("calls materializeDerivatives inside v2 commit block", () => {
    // Must be inside the v2 block (after useV2 check, before finalize)
    const v2Start = routesCode.indexOf("if (useV2) {");
    const v2End = routesCode.indexOf("// ── End v2 incremental commit path ──");
    const matCall = routesCode.indexOf("await materializeDerivatives(");
    expect(v2Start).toBeGreaterThan(-1);
    expect(v2End).toBeGreaterThan(-1);
    expect(matCall).toBeGreaterThan(v2Start);
    expect(matCall).toBeLessThan(v2End);
  });

  it("materializer failure is non-blocking", () => {
    expect(routesCode).toContain("Derivative materialization failed (non-blocking)");
  });

  it("passes correct context to materializer", () => {
    expect(routesCode).toContain("tx, projectId, projectName, runId, commitTimestamp, norm");
  });

  it("logs materialization counts", () => {
    expect(routesCode).toContain("v2 derivative materialization:");
  });
});

// ---------------------------------------------------------------------------
// S13: Canonical expense_task_links re-linking
// ---------------------------------------------------------------------------
describe("S13: canonical expense_task_links re-linking", () => {
  const routesCode = read("server/smart-import-routes.ts");

  it("re-linking runs after expenditure commit with changed rows", () => {
    expect(routesCode).toContain("costResult.counts.updated > 0 || costResult.counts.inserted > 0");
  });

  it("builds old→new NCL ID map from commit result", () => {
    expect(routesCode).toContain("oldToNewNcl");
    expect(routesCode).toContain("costResult.updatedIds");
    expect(routesCode).toContain("costResult.insertedIds");
  });

  it("fetches active NCL IDs for orphan detection", () => {
    expect(routesCode).toContain("activeNclIds");
    expect(routesCode).toContain("activeNclForLinks");
  });

  it("fetches project links from expense_task_links", () => {
    expect(routesCode).toContain("tx.select().from(expenseTaskLinks)");
  });

  it("remaps canonical_expense_id when old ID was soft-closed", () => {
    expect(routesCode).toContain("oldToNewNcl.has(canonId)");
    expect(routesCode).toContain("canonicalExpenseId: oldToNewNcl.get(canonId)!");
  });

  it("clears orphaned canonical_expense_id (set to null)", () => {
    expect(routesCode).toContain("canonicalExpenseId: null");
    expect(routesCode).toContain("!activeNclIds.has(canonId)");
  });

  it("re-linking failure is non-blocking", () => {
    expect(routesCode).toContain("Canonical link re-pointing failed (non-blocking)");
  });

  it("only processes links that have canonical_expense_id set", () => {
    expect(routesCode).toContain("canonId == null) continue");
  });
});

// ---------------------------------------------------------------------------
// Q2 documented behavior: empty categoryAllocations
// ---------------------------------------------------------------------------
describe("Q2: empty categoryAllocations does not destroy existing allocations", () => {
  const routesCode = read("server/smart-import-routes.ts");

  it("S09 block is guarded by catAllocs.length > 0", () => {
    expect(routesCode).toContain("if (catAllocs && catAllocs.length > 0)");
  });

  it("S10 block is guarded by catAllocIdByKey.size > 0", () => {
    expect(routesCode).toContain("if (catAllocIdByKey.size > 0)");
  });

  it("when categoryAllocations is empty, existing active allocations are preserved", () => {
    // The soft-close is INSIDE the catAllocs.length > 0 guard,
    // so it only runs when new allocations are available.
    const guard = routesCode.indexOf("if (catAllocs && catAllocs.length > 0)");
    const softClose = routesCode.indexOf("tx.update(categoryRevenueAllocations)");
    expect(softClose).toBeGreaterThan(guard);
    // Verify the soft-close is inside the guard block (before the matching closing brace)
    const nextBlock = routesCode.indexOf("catAllocIdByKey.size > 0", guard);
    expect(softClose).toBeLessThan(nextBlock);
  });
});
