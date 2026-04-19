/**
 * Smart Import — Post-Commit project_revenue_summary Refresh + Link Re-Linking Tests (S12, S13)
 *
 * Verifies:
 * 1. S12: derivative-materializer.ts exists and only updates project_revenue_summary
 *    (the program_expense / program_inflows materialization was retired in the PE/PI cutover)
 * 2. S12: v2 commit path calls materializeDerivatives
 * 3. S12: refresh is non-blocking (failure doesn't break commit)
 * 4. S12: file does not write to the retired program_expense / program_inflows tables
 * 5. S13: v2 commit re-links canonical_expense_id after expenditure changes
 * 6. S13: re-linking uses old→new ID map from commit executor result
 * 7. S13: orphaned canonical IDs are cleared (set to null)
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// ---------------------------------------------------------------------------
// S12: Post-commit project_revenue_summary refresh module
// (formerly the "derivative materializer" — gutted to PRS-only when
//  program_expense / program_inflows were retired)
// ---------------------------------------------------------------------------
describe("S12: post-commit project_revenue_summary refresh module", () => {
  const matCode = read("server/lib/import/derivative-materializer.ts");

  it("exports materializeDerivatives function (name kept for caller stability)", () => {
    expect(matCode).toContain("export async function materializeDerivatives");
  });

  it("exports MaterializerContext and MaterializerResult types", () => {
    expect(matCode).toContain("export interface MaterializerContext");
    expect(matCode).toContain("export interface MaterializerResult");
  });

  it("upserts project_revenue_summary from norm.costedSummary", () => {
    expect(matCode).toContain("projectRevenueSummary");
    expect(matCode).toContain("norm.costedSummary");
    expect(matCode).toContain("tx.update(projectRevenueSummary)");
    expect(matCode).toContain("tx.insert(projectRevenueSummary)");
  });

  it("returns a result flag for project_revenue_summary updates", () => {
    expect(matCode).toContain("projectRevenueSummaryUpdated");
  });

  it("does NOT import or reference the retired program_expense table", () => {
    expect(matCode).not.toContain("programExpense");
    expect(matCode).not.toContain("program_expense");
  });

  it("does NOT import or reference the retired program_inflows table", () => {
    expect(matCode).not.toContain("programInflows");
    expect(matCode).not.toContain("program_inflows");
  });

  it("does NOT call softCloseByProjectName for the retired tables", () => {
    expect(matCode).not.toContain('softCloseByProjectName(tx, "program_inflows"');
    expect(matCode).not.toContain('softCloseByProjectName(tx, "program_expense"');
  });

  it("documents the historical scope and the post-cutover scope", () => {
    expect(matCode).toContain("project_revenue_summary");
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

  it("calls materializeDerivatives inside the commit transaction", () => {
    // Must be inside the transaction (after the v2 header comment, before commit finalize)
    const v2Start = routesCode.indexOf("// ── Smart Import v2: Incremental commit path ──");
    const finalizeMarker = routesCode.indexOf("// Finalize: mark as committed");
    const matCall = routesCode.indexOf("await materializeDerivatives(");
    expect(v2Start).toBeGreaterThan(-1);
    expect(finalizeMarker).toBeGreaterThan(-1);
    expect(matCall).toBeGreaterThan(v2Start);
    expect(matCall).toBeLessThan(finalizeMarker);
  });

  it("PRS refresh failure is non-blocking", () => {
    expect(routesCode).toContain("project_revenue_summary refresh failed (non-blocking)");
  });

  it("passes correct context to materializer", () => {
    expect(routesCode).toContain("tx, projectId, projectName, runId, commitTimestamp, norm");
  });

  it("logs project_revenue_summary refresh result", () => {
    expect(routesCode).toContain("v2 project_revenue_summary refresh:");
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
