/**
 * Smart Import — recognition-data invariants (PR 3 audit).
 *
 * Locks in that the import path preserves the inputs the canonical
 * line-level revenue/COS/GP API depends on (AGENT_GUARDRAILS § 3.3):
 *
 *   - column H (forecastPaymentDate) → planned-only, per § 3.7
 *   - column T (invoiceRaisedDate)   → recognition date, on actuals child
 *   - column W (paidDate) + BLACK    → realised cash, per § 3.7
 *   - column R (poNumber)            → committed-state indicator
 *   - column J (revenueAllocation)   → category_revenue_allocations
 *   - column X (sum of Q in cat)     → NOT independently imported
 *   - column U (per-line revenue)    → dual-written today, derived going forward
 *
 * These are static-analysis assertions on the import source. A failure
 * here means the import path is no longer producing the data shape the
 * line-level API expects, and Mondi's GP page will silently zero out.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

const normalizerCode = read("server/lib/import/normalizer.ts");
const smartImportRoutes = read("server/smart-import-routes.ts");
const synonymsCode = read("server/lib/import/synonyms.ts");

describe("PR 3 audit — column J is imported as category_revenue_allocations", () => {
  it("synonyms recognise 'Total Revenue' and friends as category_revenue_allocation", () => {
    // Synonyms keyed by the canonical field name; the normalizer reads
    // header text and looks up the key.
    expect(synonymsCode).toMatch(/category_revenue_allocation:.*total revenue/i);
  });

  it("normalizer exposes categoryAllocations with revenueAllocation field", () => {
    expect(normalizerCode).toContain("categoryAllocations");
    expect(normalizerCode).toContain("revenueAllocation: number | null");
  });

  it("normalizer reads col J from the Expenditure Breakdown sheet", () => {
    // The normalizer looks up the category-revenue-allocation column index.
    expect(normalizerCode).toMatch(/getBudgetColIndex\(bm,\s*["']category_revenue_allocation["']\)/);
  });

  it("S09 stage soft-closes existing allocations and inserts new ones", () => {
    // If the import ever regresses to upsert-without-soft-close, the
    // snapshot guard breaks (§ 3.1) and aggregates double-count.
    expect(smartImportRoutes).toContain("// ── S09: Write category_revenue_allocations");
    expect(smartImportRoutes).toContain("update(categoryRevenueAllocations)");
    expect(smartImportRoutes).toContain("set({ effectiveTo: commitTimestamp })");
    expect(smartImportRoutes).toContain("insert(categoryRevenueAllocations)");
  });

  it("S09 writes revenueAllocation as the column-J value", () => {
    expect(smartImportRoutes).toMatch(/revenueAllocation:\s*ca\.revenueAllocation/);
  });
});

describe("PR 3 audit — column T is imported as actuals child invoice_date", () => {
  it("normalizer maps invoice_date through synonyms", () => {
    expect(synonymsCode).toMatch(/invoice_date:/i);
  });

  it("normalizer extracts an invoiceDate column for the right-hand actuals pane", () => {
    expect(normalizerCode).toMatch(/invoiceDateCol\s*=\s*getColIndex/);
  });
});

describe("PR 3 audit — column W (paidDate) + BLACK colour realisation", () => {
  it("synonyms recognise payment_date column variants", () => {
    expect(synonymsCode).toMatch(/payment_date:/i);
  });

  it("normalizer reads paidDate and font colour from the actuals pane", () => {
    // PR #841 fix — paid_date_font_color and paid_date_confirmed must
    // continue to be derived from the source workbook, not silently
    // dropped.
    expect(normalizerCode).toMatch(/paidDate(?:FontColor|Confirmed)/);
  });
});

describe("PR 3 audit — column R (PO number) preserved", () => {
  it("normalizer extracts a poNumber column index", () => {
    expect(normalizerCode).toMatch(/poCol\s*=\s*getColIndex/);
  });
});

describe("PR 3 audit — S10 links cost lines to category allocations", () => {
  // S10 moved to the SHARED implementation in
  // server/lib/import/allocation-relink.ts (finance-linkage orphan fix):
  // one matcher for the wizard path, the scheduler path, and the prod
  // remediation backfill, invoked UNCONDITIONALLY (not only when the run
  // extracted allocations) so stale FKs from earlier rotations are repaired
  // and unresolvable lines are flagged instead of silently orphaned.
  const allocationRelink = read("server/lib/import/allocation-relink.ts");
  const schedulerCommit = read("server/services/scheduler-commit.ts");

  it("S10 stage populates categoryKey + categoryAllocationId on NCL rows", () => {
    expect(smartImportRoutes).toContain("relinkCategoryAllocationsForProject(tx, projectId)");
    expect(allocationRelink).toContain("categoryAllocationId: match.id");
    expect(allocationRelink).toContain("normalizedCostLines");
  });

  it("S10 covers ALL active rows (including UNCHANGED) so re-imports re-link", () => {
    // Soft-close + re-insert pattern means the FK always needs refreshing.
    // If S10 ever filters to "only changed rows", historical rows orphan.
    expect(allocationRelink).toContain("isNull(normalizedCostLines.effectiveTo)");
    expect(allocationRelink).toMatch(/every active cost line/i);
  });

  it("S10 runs unconditionally on BOTH commit paths (wizard + scheduler)", () => {
    // The pre-fix inline blocks ran only when the current run extracted
    // allocations (`catAllocIdByKey.size > 0`), so commits without a budget
    // pane never repaired stale FKs — most prod projects ended up unlinked.
    expect(smartImportRoutes).toMatch(/Runs UNCONDITIONALLY/i);
    expect(schedulerCommit).toContain("relinkCategoryAllocationsForProject(tx, projectId)");
  });

  it("unresolvable lines are flagged, never silently orphaned", () => {
    expect(allocationRelink).toContain("noRevenueLinked: true");
  });
});

describe("PR 3 audit — column X (category total Q) is NOT independently imported", () => {
  it("the schema has no `category_total_actual` column on category_revenue_allocations", () => {
    const financeSchema = read("shared/schema/finance.ts");
    // The canonical column is `budget_total` (planned X). The actual X
    // is derived at read time. If a future agent introduces a column
    // for actual X, this test fires — surface and discuss.
    expect(financeSchema).not.toMatch(/category_total_actual/i);
    expect(financeSchema).not.toMatch(/categoryTotalActualTotal:\s*decimal/);
  });
});

describe("PR 3 audit — dual-write of revenue_recognition_amount remains in place", () => {
  it("normalizedCostLines still has revenue_recognition_amount column", () => {
    const financeSchema = read("shared/schema/finance.ts");
    expect(financeSchema).toMatch(/revenueRecognitionAmount:\s*text\("revenue_recognition_amount"\)/);
  });

  it("normalizedCostLineActuals still has revenue_recognition_amount column", () => {
    const financeSchema = read("shared/schema/finance.ts");
    expect(financeSchema).toMatch(/revenueRecognitionAmount:\s*decimal\("revenue_recognition_amount"/);
  });

  it("normalizer reads the U column from the source workbook", () => {
    expect(normalizerCode).toContain('getColIndex(mapping, "revenue_recognition_amount")');
  });
});

describe("PR 3 audit — § 3.3 single read path is enforced in guardrails", () => {
  it("AGENT_GUARDRAILS still names finance-line-level-repository as the single read path", () => {
    const guardrails = read("docs/AGENT_GUARDRAILS.md");
    expect(guardrails).toContain("finance-line-level-repository.ts");
    expect(guardrails).toMatch(/category-scoped/i);
    expect(guardrails).toMatch(/perLineRevenue\s*=\s*\(line\.actualTotal\s*\/\s*category\.totalActualTotal\)/);
  });

  it("§ 3.3.1 forbids cross-project pooling", () => {
    const guardrails = read("docs/AGENT_GUARDRAILS.md");
    expect(guardrails).toContain("§ 3.3.1");
    expect(guardrails).toMatch(/never pooled across projects|no cross-project pooling/i);
  });
});
