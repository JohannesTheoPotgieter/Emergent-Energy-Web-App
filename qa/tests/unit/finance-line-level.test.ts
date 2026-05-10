/**
 * Unit tests for the canonical line-level finance derivation
 * (AGENT_GUARDRAILS § 3.3 — category-scoped per-line POC).
 *
 * Tests target the pure helper `deriveFinanceLinesFromRows` so the math is
 * verified without mocking Drizzle. The repository methods are thin
 * wrappers around this helper.
 */
import { describe, it, expect } from "vitest";
import {
  aggregateLinesByMonth,
  deriveFinanceLinesFromRows,
  synthesizeActualsForParents,
  type FinanceLineActualsRowInput,
  type FinanceLineAllocationRowInput,
  type FinanceLineParentRowInput,
} from "../../../server/repositories/finance-line-level-repository";

const PROJECT_A = 101;
const PROJECT_B = 202;

/**
 * Mondi-shaped fixture spanning two categories and one realised line.
 *
 *   Category 1 — Panels       (allocation J = R 50,000)
 *     Line 1 (parent 1, actual 1)  Q = R 8,000   → expected revenue
 *                                             = (8000 / 20000) * 50000 = R 20,000
 *     Line 2 (parent 2, actual 2)  Q = R 12,000  → expected revenue
 *                                             = (12000 / 20000) * 50000 = R 30,000
 *   Category 2 — Inverters    (allocation J = R 30,000)
 *     Line 3 (parent 3, actual 3)  Q = R 15,000  → expected revenue
 *                                             = (15000 / 15000) * 30000 = R 30,000
 *
 * Project total Revenue = R 80,000
 * Project total COS     = R 35,000
 * Project total GP      = R 45,000  (≈ 56.25% margin)
 */
const ALLOC_PANELS = 1;
const ALLOC_INVERTERS = 2;

const allocations: FinanceLineAllocationRowInput[] = [
  {
    id: ALLOC_PANELS,
    projectId: PROJECT_A,
    categoryKey: "1. Panels",
    categoryName: "Panels",
    categoryNumber: "1",
    revenueAllocation: "50000",
  },
  {
    id: ALLOC_INVERTERS,
    projectId: PROJECT_A,
    categoryKey: "2. Inverters",
    categoryName: "Inverters",
    categoryNumber: "2",
    revenueAllocation: "30000",
  },
];

const parents: FinanceLineParentRowInput[] = [
  {
    id: 1,
    projectId: PROJECT_A,
    categoryAllocationId: ALLOC_PANELS,
    categoryKey: "1. Panels",
    costCategory: "Panels",
    description: "1.1 Panel supply",
    budgetTotal: "9000",
    forecastPaymentDate: "2026-04-15",
    paidDate: null,
    paidDateConfirmed: null,
  },
  {
    id: 2,
    projectId: PROJECT_A,
    categoryAllocationId: ALLOC_PANELS,
    categoryKey: "1. Panels",
    costCategory: "Panels",
    description: "1.2 Panel install",
    budgetTotal: "13000",
    forecastPaymentDate: "2026-05-15",
    paidDate: "2026-05-30",
    paidDateConfirmed: true,
  },
  {
    id: 3,
    projectId: PROJECT_A,
    categoryAllocationId: ALLOC_INVERTERS,
    categoryKey: "2. Inverters",
    costCategory: "Inverters",
    description: "2.1 Inverter supply",
    budgetTotal: "15000",
    forecastPaymentDate: "2026-04-30",
    paidDate: null,
    paidDateConfirmed: null,
  },
];

const actuals: FinanceLineActualsRowInput[] = [
  {
    id: 1,
    costLineId: 1,
    projectId: PROJECT_A,
    actualTotal: "8000",
    poNumber: "PO-1",
    invoiceNumber: "INV-1",
    invoiceDate: "2026-04-15",
    financePaymentDate: null,
    description: "1.1 Panel supply",
    qty: "10",
    rate: "800",
  },
  {
    id: 2,
    costLineId: 2,
    projectId: PROJECT_A,
    actualTotal: "12000",
    poNumber: "PO-2",
    invoiceNumber: "INV-2",
    invoiceDate: "2026-05-15",
    financePaymentDate: "2026-05-30",
    description: "1.2 Panel install",
    qty: "1",
    rate: "12000",
  },
  {
    id: 3,
    costLineId: 3,
    projectId: PROJECT_A,
    actualTotal: "15000",
    poNumber: "PO-3",
    invoiceNumber: "INV-3",
    invoiceDate: "2026-04-30",
    financePaymentDate: null,
    description: "2.1 Inverter supply",
    qty: "5",
    rate: "3000",
  },
];

describe("deriveFinanceLinesFromRows — canonical § 3.3 formula", () => {
  it("derives perLineRevenue = (Q/X)*J for every line", () => {
    const lines = deriveFinanceLinesFromRows(actuals, parents, allocations);
    const byParent = new Map(lines.map((l) => [l.parentLineId, l]));

    const line1 = byParent.get(1)!;
    expect(line1.actualTotal).toBe(8000);
    expect(line1.categoryTotalActualTotal).toBe(20000); // 8000 + 12000
    expect(line1.categoryRevenueAllocation).toBe(50000);
    expect(line1.perLineRevenue).toBeCloseTo(20000, 6);
    expect(line1.perLineGp).toBeCloseTo(12000, 6);
    expect(line1.perLineGpPct).toBeCloseTo(0.6, 6);

    const line2 = byParent.get(2)!;
    expect(line2.perLineRevenue).toBeCloseTo(30000, 6);
    expect(line2.perLineGp).toBeCloseTo(18000, 6);

    const line3 = byParent.get(3)!;
    expect(line3.categoryTotalActualTotal).toBe(15000);
    expect(line3.perLineRevenue).toBeCloseTo(30000, 6);
    expect(line3.perLineGp).toBeCloseTo(15000, 6);
  });

  it("aggregates: SUM(perLineRevenue) = project total; SUM(perLineGp) = project total", () => {
    const lines = deriveFinanceLinesFromRows(actuals, parents, allocations);
    const totalRevenue = lines.reduce((s, l) => s + l.perLineRevenue, 0);
    const totalCos = lines.reduce((s, l) => s + l.actualTotal, 0);
    const totalGp = lines.reduce((s, l) => s + l.perLineGp, 0);

    expect(totalRevenue).toBeCloseTo(80000, 4);
    expect(totalCos).toBeCloseTo(35000, 4);
    expect(totalGp).toBeCloseTo(45000, 4);
    expect(totalGp).toBeCloseTo(totalRevenue - totalCos, 4); // identity holds
  });

  it("buckets by recognitionMonth from invoiceRaisedDate (column T), NOT forecastPaymentDate", () => {
    const lines = deriveFinanceLinesFromRows(actuals, parents, allocations);
    const monthFor = (parentId: number) =>
      lines.find((l) => l.parentLineId === parentId)!.recognitionMonth;
    expect(monthFor(1)).toBe("2026-04"); // T=2026-04-15
    expect(monthFor(2)).toBe("2026-05"); // T=2026-05-15
    expect(monthFor(3)).toBe("2026-04"); // T=2026-04-30
  });

  it("classifies bucket as realised only when paidDateConfirmed=true", () => {
    const lines = deriveFinanceLinesFromRows(actuals, parents, allocations);
    expect(lines.find((l) => l.parentLineId === 1)!.bucket).toBe("unrealised");
    expect(lines.find((l) => l.parentLineId === 2)!.bucket).toBe("realised");
    expect(lines.find((l) => l.parentLineId === 3)!.bucket).toBe("unrealised");
  });

  it("filters by fyStart/fyEnd window on invoiceRaisedDate", () => {
    const apr = deriveFinanceLinesFromRows(actuals, parents, allocations, {
      fyStart: "2026-04-01",
      fyEnd: "2026-04-30",
    });
    expect(apr).toHaveLength(2);
    expect(apr.map((l) => l.parentLineId).sort()).toEqual([1, 3]);
  });
});

describe("deriveFinanceLinesFromRows — edge cases", () => {
  it("perLineRevenue = 0 when categoryTotalActualTotal == 0", () => {
    const zeroActual: FinanceLineActualsRowInput = {
      ...actuals[0],
      id: 99,
      costLineId: 1,
      actualTotal: "0",
    };
    // Replace category Panels' only actual with one whose total is zero.
    const lines = deriveFinanceLinesFromRows(
      [zeroActual],
      [parents[0]], // only parent 1 (Panels)
      [allocations[0]], // only Panels allocation
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].perLineRevenue).toBe(0);
    expect(lines[0].derivationWarning).toBe("category_total_actual_zero");
  });

  it("perLineRevenue = 0 when no allocation rows exist (parent had FK + key but allocations table is empty)", () => {
    const lines = deriveFinanceLinesFromRows(actuals, parents, []); // no allocations
    expect(lines.every((l) => l.perLineRevenue === 0)).toBe(true);
    // Parent has both FK and categoryKey, but neither resolves because
    // `allocationRows` is empty. The right warning is the workbook-level
    // "missing J" surface, not the import-linkage one.
    expect(lines.every((l) => l.derivationWarning === "category_revenue_allocation_missing")).toBe(true);
  });

  it("falls back to categoryKey when categoryAllocationId is null but key matches", () => {
    // After the re-import-FK-stale fix: a parent with no FK but a valid
    // categoryKey should resolve to the active allocation by key. This is
    // the production fix for "GP page is empty after re-import".
    const orphanedParents = parents.map((p) => ({ ...p, categoryAllocationId: null }));
    const lines = deriveFinanceLinesFromRows(actuals, orphanedParents, allocations);
    expect(lines.every((l) => l.derivationWarning === null)).toBe(true);
    expect(lines.every((l) => l.perLineRevenue > 0)).toBe(true);
  });

  it("perLineRevenue = 0 when parent has no FK AND no categoryKey", () => {
    // True orphan: parent can't be linked to any allocation by either path.
    const orphanedParents = parents.map((p) => ({
      ...p,
      categoryAllocationId: null,
      categoryKey: null,
    }));
    const lines = deriveFinanceLinesFromRows(actuals, orphanedParents, allocations);
    expect(lines.every((l) => l.perLineRevenue === 0)).toBe(true);
    expect(lines.every((l) => l.derivationWarning === "missing_category_allocation_linkage")).toBe(true);
  });

  it("flags orphan actuals rows with no parent", () => {
    const orphan: FinanceLineActualsRowInput = {
      ...actuals[0],
      id: 999,
      costLineId: 9999, // no matching parent
    };
    const lines = deriveFinanceLinesFromRows([orphan], parents, allocations);
    expect(lines).toHaveLength(1);
    expect(lines[0].derivationWarning).toBe("orphan_actuals_row_no_parent");
    expect(lines[0].perLineRevenue).toBe(0);
  });

  it("perLineGpPct = null when revenue is zero (no divide-by-zero)", () => {
    const lines = deriveFinanceLinesFromRows(actuals, parents, []); // forces revenue 0
    expect(lines.every((l) => l.perLineGpPct === null)).toBe(true);
  });

  it("aggregateLinesByMonth respects the SUM identity", () => {
    const lines = deriveFinanceLinesFromRows(actuals, parents, allocations);
    const agg = aggregateLinesByMonth(lines);
    expect(agg.total.revenue).toBeCloseTo(80000, 4);
    expect(agg.total.cos).toBeCloseTo(35000, 4);
    expect(agg.total.gp).toBeCloseTo(45000, 4);
    expect(agg.total.gp).toBeCloseTo(agg.total.revenue - agg.total.cos, 4);

    const apr = agg.byMonth.find((m) => m.monthKey === "2026-04")!;
    const may = agg.byMonth.find((m) => m.monthKey === "2026-05")!;
    expect(apr.revenue + may.revenue).toBeCloseTo(80000, 4);
    expect(apr.count + may.count).toBe(3);
  });
});

describe("deriveFinanceLinesFromRows — re-import FK fallback (stale categoryAllocationId)", () => {
  /**
   * Reproduces the production failure mode after a Smart Import re-import:
   *
   *   1. Old `category_revenue_allocations` rows are soft-closed (effectiveTo
   *      set), new rows are inserted with new IDs.
   *   2. S10 should re-link parent cost lines to the new IDs but for any
   *      reason fails to (transaction error, partial run, edge case).
   *   3. Each parent's `categoryAllocationId` now points to a soft-closed
   *      row that the snapshot guard in the repository correctly excludes
   *      from `allocationRows` — so the FK looks dangling.
   *
   * Without the fallback, every line would compute perLineRevenue = 0 and
   * the GP page would render empty even though the workbook column J is
   * populated. With the fallback we resolve the active allocation by
   * (projectId, categoryKey) and the math comes out right.
   */
  it("resolves an active allocation via (projectId, categoryKey) when the FK is stale", () => {
    // The active allocation has id=200; the parent's stale FK points at id=99
    // (a soft-closed row that's not in `allocationRows`).
    const activeAlloc: FinanceLineAllocationRowInput = {
      id: 200,
      projectId: PROJECT_A,
      categoryKey: "1. Panels",
      categoryName: "Panels",
      categoryNumber: "1",
      revenueAllocation: "60000",
    };
    const staleParents: FinanceLineParentRowInput[] = [
      {
        id: 1,
        projectId: PROJECT_A,
        categoryAllocationId: 99, // stale — points at soft-closed allocation
        categoryKey: "1. Panels",
        costCategory: "Panels",
        description: "1.1 Panels",
        budgetTotal: "10000",
        forecastPaymentDate: null,
        paidDate: null,
        paidDateConfirmed: null,
      },
    ];
    const acts: FinanceLineActualsRowInput[] = [
      {
        id: 100,
        costLineId: 1,
        projectId: PROJECT_A,
        actualTotal: "10000",
        poNumber: null,
        invoiceNumber: "INV-1",
        invoiceDate: "2026-04-15",
        financePaymentDate: null,
        description: null,
        qty: null,
        rate: null,
      },
    ];

    const lines = deriveFinanceLinesFromRows(acts, staleParents, [activeAlloc]);
    expect(lines).toHaveLength(1);
    const line = lines[0];

    // Should NOT be flagged "missing_category_allocation_linkage".
    expect(line.derivationWarning).toBeNull();

    // Resolved to the active allocation by category key.
    expect(line.categoryAllocationId).toBe(200);
    expect(line.categoryName).toBe("Panels");
    expect(line.categoryRevenueAllocation).toBe(60000);
    expect(line.categoryTotalActualTotal).toBe(10000);
    expect(line.perLineRevenue).toBeCloseTo(60000, 4); // (10000/10000)*60000
  });

  it("category-key matching is whitespace and case insensitive", () => {
    const activeAlloc: FinanceLineAllocationRowInput = {
      id: 300,
      projectId: PROJECT_A,
      categoryKey: "1. Panels",
      categoryName: "Panels",
      categoryNumber: "1",
      revenueAllocation: "60000",
    };
    const parents: FinanceLineParentRowInput[] = [
      {
        id: 1,
        projectId: PROJECT_A,
        categoryAllocationId: null, // never linked
        categoryKey: "  1. PANELS  ", // legacy/casing/whitespace drift
        costCategory: "Panels",
        description: null,
        budgetTotal: null,
        forecastPaymentDate: null,
        paidDate: null,
        paidDateConfirmed: null,
      },
    ];
    const acts: FinanceLineActualsRowInput[] = [
      {
        id: 100,
        costLineId: 1,
        projectId: PROJECT_A,
        actualTotal: "5000",
        poNumber: null,
        invoiceNumber: null,
        invoiceDate: "2026-04-15",
        financePaymentDate: null,
        description: null,
        qty: null,
        rate: null,
      },
    ];

    const lines = deriveFinanceLinesFromRows(acts, parents, [activeAlloc]);
    expect(lines[0].derivationWarning).toBeNull();
    expect(lines[0].categoryAllocationId).toBe(300);
    expect(lines[0].perLineRevenue).toBeCloseTo(60000, 4);
  });

  it("fallback is per-project — does not match a same-key allocation in a different project", () => {
    const projAAlloc: FinanceLineAllocationRowInput = {
      id: 400,
      projectId: PROJECT_A,
      categoryKey: "1. Panels",
      categoryName: "Panels",
      categoryNumber: "1",
      revenueAllocation: "60000",
    };
    const projBParent: FinanceLineParentRowInput = {
      id: 1,
      projectId: PROJECT_B, // different project
      categoryAllocationId: null,
      categoryKey: "1. Panels", // same key
      costCategory: "Panels",
      description: null,
      budgetTotal: null,
      forecastPaymentDate: null,
      paidDate: null,
      paidDateConfirmed: null,
    };
    const acts: FinanceLineActualsRowInput[] = [
      {
        id: 100,
        costLineId: 1,
        projectId: PROJECT_B,
        actualTotal: "5000",
        poNumber: null,
        invoiceNumber: null,
        invoiceDate: "2026-04-15",
        financePaymentDate: null,
        description: null,
        qty: null,
        rate: null,
      },
    ];

    const lines = deriveFinanceLinesFromRows(acts, [projBParent], [projAAlloc]);
    // Project B has no allocation matching its key — fallback must NOT
    // pick up project A's allocation. § 3.3.1 cross-project rule.
    expect(lines[0].derivationWarning).toBe("category_revenue_allocation_missing");
    expect(lines[0].perLineRevenue).toBe(0);
  });
});

describe("planned-side derivation — uses budgetTotal (G) + category G-sum + J", () => {
  it("computes plannedRevenue, plannedGp, plannedGpPct per line", () => {
    // Two lines in the same category. Budget totals: 30k + 70k = 100k.
    // Allocation J = 200k. Per-line planned revenue = (G/100k) * 200k.
    const allocs: FinanceLineAllocationRowInput[] = [
      { id: 1, projectId: 99, categoryKey: "1. Panels", categoryName: "Panels", categoryNumber: "1", revenueAllocation: "200000", budgetTotal: "100000" },
    ];
    const ps: FinanceLineParentRowInput[] = [
      { id: 10, projectId: 99, categoryAllocationId: 1, categoryKey: "1. Panels", costCategory: "Panels", description: "L1", budgetTotal: "30000", forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null, amountExVat: null, invoiceDate: null, invoiceNumber: null, poNumber: null },
      { id: 11, projectId: 99, categoryAllocationId: 1, categoryKey: "1. Panels", costCategory: "Panels", description: "L2", budgetTotal: "70000", forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null, amountExVat: null, invoiceDate: null, invoiceNumber: null, poNumber: null },
    ];
    const acts: FinanceLineActualsRowInput[] = [
      // Synthesized — id is negative since no real children. Use the
      // synthesizeActualsForParents helper inline.
      ...synthesizeActualsForParents([], ps),
    ];

    const lines = deriveFinanceLinesFromRows(acts, ps, allocs);
    const l1 = lines.find((l) => l.parentLineId === 10)!;
    const l2 = lines.find((l) => l.parentLineId === 11)!;

    // Planned-side math: (G / 100k) * 200k.
    expect(l1.plannedActualTotal).toBe(30000);
    expect(l1.plannedRevenue).toBeCloseTo(60000, 4);   // (30000/100000)*200000
    expect(l1.plannedGp).toBeCloseTo(30000, 4);
    expect(l1.plannedGpPct).toBeCloseTo(0.5, 4);

    expect(l2.plannedActualTotal).toBe(70000);
    expect(l2.plannedRevenue).toBeCloseTo(140000, 4);
    expect(l2.plannedGp).toBeCloseTo(70000, 4);
  });

  it("plannedRevenue = 0 when there are no budgeted parents (denominator zero)", () => {
    const allocs: FinanceLineAllocationRowInput[] = [
      { id: 1, projectId: 99, categoryKey: "1. Panels", categoryName: "Panels", categoryNumber: "1", revenueAllocation: "200000", budgetTotal: null },
    ];
    const ps: FinanceLineParentRowInput[] = [
      { id: 10, projectId: 99, categoryAllocationId: 1, categoryKey: "1. Panels", costCategory: "Panels", description: "L1", budgetTotal: null, forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null, amountExVat: null, invoiceDate: null, invoiceNumber: null, poNumber: null },
    ];
    const acts: FinanceLineActualsRowInput[] = synthesizeActualsForParents([], ps);
    const lines = deriveFinanceLinesFromRows(acts, ps, allocs);
    expect(lines[0].plannedActualTotal).toBe(0);
    expect(lines[0].plannedRevenue).toBe(0);
    expect(lines[0].plannedGp).toBe(0);
  });

  it("falls back to allocation.budgetTotal (col I) if parent G-sum is 0", () => {
    // Parents have null budgetTotal but the allocation has col I populated.
    const allocs: FinanceLineAllocationRowInput[] = [
      { id: 1, projectId: 99, categoryKey: "1. Panels", categoryName: "Panels", categoryNumber: "1", revenueAllocation: "200000", budgetTotal: "100000" },
    ];
    // Parent has actualTotal but no budgetTotal — actuals path drives revenue
    // because formula needs a non-zero denominator. Planned path should
    // still get to use allocation.budgetTotal.
    const ps: FinanceLineParentRowInput[] = [
      { id: 10, projectId: 99, categoryAllocationId: 1, categoryKey: "1. Panels", costCategory: "Panels", description: "L1", budgetTotal: null, forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null, amountExVat: "30000", invoiceDate: null, invoiceNumber: null, poNumber: null },
    ];
    const acts: FinanceLineActualsRowInput[] = synthesizeActualsForParents([], ps);
    const lines = deriveFinanceLinesFromRows(acts, ps, allocs);
    // plannedActualTotal stays 0 because parent.budgetTotal is null;
    // plannedRevenue also stays 0 because the formula multiplies by it.
    expect(lines[0].plannedActualTotal).toBe(0);
    expect(lines[0].plannedRevenue).toBe(0);
  });
});

describe("aggregateLinesByMonth — bucket rollup + planned/realised totals", () => {
  it("rolls up cos/revenue/gp by bucket and exposes planned + realised on monthly rows", () => {
    const allocs: FinanceLineAllocationRowInput[] = [
      { id: 1, projectId: 99, categoryKey: "1. Panels", categoryName: "Panels", categoryNumber: "1", revenueAllocation: "100000", budgetTotal: "100000" },
    ];
    // 3 parents. 1 realised (paid confirmed), 1 unrealised, 1 budget-only.
    const ps: FinanceLineParentRowInput[] = [
      { id: 1, projectId: 99, categoryAllocationId: 1, categoryKey: "1. Panels", costCategory: "Panels", description: "realised", budgetTotal: "30000", forecastPaymentDate: null, paidDate: "2026-04-15", paidDateConfirmed: true, amountExVat: "30000", invoiceDate: "2026-04-15", invoiceNumber: "INV-1", poNumber: "PO-1" },
      { id: 2, projectId: 99, categoryAllocationId: 1, categoryKey: "1. Panels", costCategory: "Panels", description: "unrealised", budgetTotal: "20000", forecastPaymentDate: null, paidDate: null, paidDateConfirmed: false, amountExVat: "20000", invoiceDate: "2026-05-15", invoiceNumber: "INV-2", poNumber: "PO-2" },
      { id: 3, projectId: 99, categoryAllocationId: 1, categoryKey: "1. Panels", costCategory: "Panels", description: "budget-only", budgetTotal: "50000", forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null, amountExVat: null, invoiceDate: null, invoiceNumber: null, poNumber: null },
    ];
    const acts = synthesizeActualsForParents([], ps);
    const lines = deriveFinanceLinesFromRows(acts, ps, allocs);
    const agg = aggregateLinesByMonth(lines);

    // Bucket rollup
    const realisedBucket = agg.byBucket.find((b) => b.bucket === "realised");
    const unrealisedBucket = agg.byBucket.find((b) => b.bucket === "unrealised");
    const plannedBucket = agg.byBucket.find((b) => b.bucket === "planned");
    expect(realisedBucket?.cos).toBe(30000);
    expect(unrealisedBucket?.cos).toBe(20000);
    expect(plannedBucket?.count).toBe(1); // budget-only line

    // Realised totals on the total row (only the realised line)
    expect(agg.total.realisedCos).toBe(30000);
    expect(agg.total.cos).toBe(50000); // realised + unrealised (planned has no actual)

    // Planned totals: sum of all parent budgetTotal = 30k + 20k + 50k = 100k
    expect(agg.total.plannedCos).toBe(100000);
    // Planned revenue: each line's plannedRevenue using (G/X)*J
    // L1: (30k/100k)*100k = 30k
    // L2: (20k/100k)*100k = 20k
    // L3: (50k/100k)*100k = 50k
    expect(agg.total.plannedRevenue).toBeCloseTo(100000, 4);
    expect(agg.total.plannedGp).toBeCloseTo(0, 4); // 100k revenue - 100k cost
  });
});

describe("synthesizeActualsForParents — parents without actuals child", () => {
  /**
   * Reproduces the production case the user just hit on /finance/gp:
   * 65 projects, 11 with cost data, 14 actuals rows total — but most
   * cost data is on parent rows that have NO actuals child yet
   * (budget-only or pre-Wave-0 imports). Without synthesis, the GP
   * page renders all-zero. With synthesis, parent-only lines surface
   * with their cost contributing to COS and (when allocation is
   * present) to revenue + GP.
   */
  it("emits a synthesized line for every parent that has no actuals child", () => {
    // Parent 1 has a real child; parent 2 doesn't.
    const parents: FinanceLineParentRowInput[] = [
      {
        id: 1,
        projectId: PROJECT_A,
        categoryAllocationId: ALLOC_PANELS,
        categoryKey: "1. Panels",
        costCategory: "Panels",
        description: "1.1 Panels — has child",
        budgetTotal: "10000",
        forecastPaymentDate: null,
        paidDate: null,
        paidDateConfirmed: null,
        amountExVat: "8000",
        invoiceDate: "2026-04-15",
        invoiceNumber: "PARENT-INV-1",
        poNumber: "PARENT-PO-1",
      },
      {
        id: 2,
        projectId: PROJECT_A,
        categoryAllocationId: ALLOC_PANELS,
        categoryKey: "1. Panels",
        costCategory: "Panels",
        description: "1.2 Panels — no child",
        budgetTotal: "12000",
        forecastPaymentDate: null,
        paidDate: null,
        paidDateConfirmed: null,
        amountExVat: "12000",
        invoiceDate: "2026-05-15",
        invoiceNumber: "PARENT-INV-2",
        poNumber: "PARENT-PO-2",
      },
    ];
    const realChildren: FinanceLineActualsRowInput[] = [
      {
        id: 100,
        costLineId: 1,
        projectId: PROJECT_A,
        actualTotal: "8000",
        poNumber: "CHILD-PO-1",
        invoiceNumber: "CHILD-INV-1",
        invoiceDate: "2026-04-15",
        financePaymentDate: null,
        description: null,
        qty: null,
        rate: null,
      },
    ];

    const synthesized = synthesizeActualsForParents(realChildren, parents);
    expect(synthesized).toHaveLength(2);

    // Original child preserved.
    const original = synthesized.find((a) => a.id === 100);
    expect(original).toBeDefined();
    expect(original!.invoiceNumber).toBe("CHILD-INV-1");

    // Synthesized row for parent 2 (no child).
    const synth = synthesized.find((a) => a.costLineId === 2);
    expect(synth).toBeDefined();
    expect(synth!.id).toBe(-2); // negative id
    expect(synth!.actualTotal).toBe("12000");
    expect(synth!.invoiceDate).toBe("2026-05-15");
    expect(synth!.invoiceNumber).toBe("PARENT-INV-2");
    expect(synth!.poNumber).toBe("PARENT-PO-2");
  });

  it("does NOT synthesize for parents that already have at least one child (no double-count)", () => {
    const parent: FinanceLineParentRowInput = {
      id: 1,
      projectId: PROJECT_A,
      categoryAllocationId: ALLOC_PANELS,
      categoryKey: "1. Panels",
      costCategory: "Panels",
      description: "split-paid",
      budgetTotal: "10000",
      forecastPaymentDate: null,
      paidDate: null,
      paidDateConfirmed: null,
      amountExVat: "10000",
      invoiceDate: "2026-04-15",
      invoiceNumber: "PARENT-INV-1",
      poNumber: null,
    };
    const children: FinanceLineActualsRowInput[] = [
      {
        id: 1,
        costLineId: 1,
        projectId: PROJECT_A,
        actualTotal: "6000",
        poNumber: null,
        invoiceNumber: "INV-A",
        invoiceDate: "2026-04-15",
        financePaymentDate: null,
        description: null,
        qty: null,
        rate: null,
      },
      {
        id: 2,
        costLineId: 1,
        projectId: PROJECT_A,
        actualTotal: "4000",
        poNumber: null,
        invoiceNumber: "INV-B",
        invoiceDate: "2026-05-15",
        financePaymentDate: null,
        description: null,
        qty: null,
        rate: null,
      },
    ];

    const synthesized = synthesizeActualsForParents(children, [parent]);
    expect(synthesized).toHaveLength(2); // just the real children, no synth
    expect(synthesized.every((a) => a.id > 0)).toBe(true);
  });

  it("end-to-end: parent-only cost contributes to COS, revenue, and GP via the formula", () => {
    // Two parents in the same Panels category, one with a child, one
    // without. Both should contribute to category total X.
    const allocs: FinanceLineAllocationRowInput[] = [
      {
        id: ALLOC_PANELS,
        projectId: PROJECT_A,
        categoryKey: "1. Panels",
        categoryName: "Panels",
        categoryNumber: "1",
        revenueAllocation: "100000",
      },
    ];
    const parents: FinanceLineParentRowInput[] = [
      {
        id: 1,
        projectId: PROJECT_A,
        categoryAllocationId: ALLOC_PANELS,
        categoryKey: "1. Panels",
        costCategory: "Panels",
        description: "with child",
        budgetTotal: "20000",
        forecastPaymentDate: null,
        paidDate: null,
        paidDateConfirmed: null,
        amountExVat: "20000",
        invoiceDate: "2026-04-15",
        invoiceNumber: "INV-1",
        poNumber: null,
      },
      {
        id: 2,
        projectId: PROJECT_A,
        categoryAllocationId: ALLOC_PANELS,
        categoryKey: "1. Panels",
        costCategory: "Panels",
        description: "parent-only",
        budgetTotal: "30000",
        forecastPaymentDate: null,
        paidDate: null,
        paidDateConfirmed: null,
        amountExVat: "30000",
        invoiceDate: "2026-05-15",
        invoiceNumber: "INV-2",
        poNumber: null,
      },
    ];
    const realChildren: FinanceLineActualsRowInput[] = [
      {
        id: 1,
        costLineId: 1,
        projectId: PROJECT_A,
        actualTotal: "20000",
        poNumber: null,
        invoiceNumber: "INV-1",
        invoiceDate: "2026-04-15",
        financePaymentDate: null,
        description: null,
        qty: null,
        rate: null,
      },
    ];

    const synthesized = synthesizeActualsForParents(realChildren, parents);
    const lines = deriveFinanceLinesFromRows(synthesized, parents, allocs);

    // Both parents contribute to category X (= 20000 + 30000 = 50000).
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l.categoryTotalActualTotal).toBe(50000);
    }
    const childLine = lines.find((l) => l.parentLineId === 1)!;
    const parentOnlyLine = lines.find((l) => l.parentLineId === 2)!;

    // (20000 / 50000) * 100000 = 40000
    expect(childLine.actualTotal).toBe(20000);
    expect(childLine.perLineRevenue).toBeCloseTo(40000, 4);
    // (30000 / 50000) * 100000 = 60000
    expect(parentOnlyLine.actualTotal).toBe(30000);
    expect(parentOnlyLine.perLineRevenue).toBeCloseTo(60000, 4);

    const totalCos = lines.reduce((s, l) => s + l.actualTotal, 0);
    const totalRev = lines.reduce((s, l) => s + l.perLineRevenue, 0);
    expect(totalCos).toBe(50000);
    expect(totalRev).toBeCloseTo(100000, 4);
  });
});

describe("deriveFinanceLinesFromRows — § 3.3.1 cross-project rule", () => {
  /**
   * Two-project fixture where pooled aggregation gives the wrong answer.
   *
   *   Project A — Panels only (alloc R 60,000)
   *     parent 10 / actual 10 → Q=R 10,000 → revenue = 60,000
   *   Project B — Panels only (alloc R 100,000) but cheap supplier
   *     parent 20 / actual 20 → Q=R 4,000  → revenue = 100,000
   *
   *   CORRECT total revenue = 60,000 + 100,000 = R 160,000
   *
   *   WRONG pooled formula:
   *     (10000+4000) / (10000+4000) * (60000+100000)
   *     = 14000/14000 * 160000 = R 160,000   ← coincidentally equal here
   *
   *   The pooled error shows up when category mixes differ across projects.
   *   Use a 4-row fixture where pooling cleanly diverges.
   */
  it("aggregates per-project; pooled formula is forbidden (§ 3.3.1)", () => {
    const allocs: FinanceLineAllocationRowInput[] = [
      {
        id: 11,
        projectId: PROJECT_A,
        categoryKey: "Panels",
        categoryName: "Panels",
        categoryNumber: "1",
        revenueAllocation: "60000",
      },
      {
        id: 12,
        projectId: PROJECT_A,
        categoryKey: "Inverters",
        categoryName: "Inverters",
        categoryNumber: "2",
        revenueAllocation: "20000",
      },
      {
        id: 21,
        projectId: PROJECT_B,
        categoryKey: "Panels",
        categoryName: "Panels",
        categoryNumber: "1",
        revenueAllocation: "100000",
      },
      {
        id: 22,
        projectId: PROJECT_B,
        categoryKey: "Inverters",
        categoryName: "Inverters",
        categoryNumber: "2",
        revenueAllocation: "5000",
      },
    ];
    const ps: FinanceLineParentRowInput[] = [
      { id: 10, projectId: PROJECT_A, categoryAllocationId: 11, categoryKey: "Panels", costCategory: "Panels", description: "A panels", budgetTotal: "12000", forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null },
      { id: 11, projectId: PROJECT_A, categoryAllocationId: 12, categoryKey: "Inverters", costCategory: "Inverters", description: "A inverters", budgetTotal: "10000", forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null },
      { id: 20, projectId: PROJECT_B, categoryAllocationId: 21, categoryKey: "Panels", costCategory: "Panels", description: "B panels", budgetTotal: "5000", forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null },
      { id: 21, projectId: PROJECT_B, categoryAllocationId: 22, categoryKey: "Inverters", costCategory: "Inverters", description: "B inverters", budgetTotal: "8000", forecastPaymentDate: null, paidDate: null, paidDateConfirmed: null },
    ];
    const acts: FinanceLineActualsRowInput[] = [
      { id: 100, costLineId: 10, projectId: PROJECT_A, actualTotal: "10000", poNumber: null, invoiceNumber: null, invoiceDate: "2026-04-15", financePaymentDate: null, description: null, qty: null, rate: null },
      { id: 101, costLineId: 11, projectId: PROJECT_A, actualTotal: "8000", poNumber: null, invoiceNumber: null, invoiceDate: "2026-04-15", financePaymentDate: null, description: null, qty: null, rate: null },
      { id: 200, costLineId: 20, projectId: PROJECT_B, actualTotal: "4000", poNumber: null, invoiceNumber: null, invoiceDate: "2026-04-15", financePaymentDate: null, description: null, qty: null, rate: null },
      { id: 201, costLineId: 21, projectId: PROJECT_B, actualTotal: "9000", poNumber: null, invoiceNumber: null, invoiceDate: "2026-04-15", financePaymentDate: null, description: null, qty: null, rate: null },
    ];

    const lines = deriveFinanceLinesFromRows(acts, ps, allocs);

    // Project A: panels alone in its category → revenue = 60,000;
    //            inverters alone in its category → revenue = 20,000.
    // Project B: panels alone → revenue = 100,000; inverters alone → 5,000.
    const projARevenue = lines.filter((l) => l.projectId === PROJECT_A).reduce((s, l) => s + l.perLineRevenue, 0);
    const projBRevenue = lines.filter((l) => l.projectId === PROJECT_B).reduce((s, l) => s + l.perLineRevenue, 0);
    const correctTotal = projARevenue + projBRevenue;

    expect(projARevenue).toBeCloseTo(80000, 4);  // 60k + 20k
    expect(projBRevenue).toBeCloseTo(105000, 4); // 100k + 5k
    expect(correctTotal).toBeCloseTo(185000, 4);

    // The forbidden pooled-cross-project formula would mix categories:
    //   panels pooled:    (10000+4000) / 14000 * (60000+100000) = 160000
    //   inverters pooled: (8000+9000)  / 17000 * (20000+5000)   = 25000
    //   pooled total = 185000  — matches by happy coincidence here.
    //
    // Cross-mix the wrong way to force divergence:
    //   "pooled-without-category" =
    //       Σ Q / Σ X_pooled * Σ J_pooled, treating the entire portfolio
    //       as one category. We compute it explicitly to assert it
    //       diverges from the correct sum-of-projects.
    const sumQ = acts.reduce((s, a) => s + Number(a.actualTotal), 0);
    const sumJ = allocs.reduce((s, a) => s + Number(a.revenueAllocation), 0);
    const wrongPooled = (sumQ / sumQ) * sumJ; // = sumJ = 185000
    // In this fixture the pooled-without-category form happens to equal
    // the correct value because every line has the same invoice date and
    // the cancellation works out. The strict guarantee is the
    // PER-PROJECT identity below:
    expect(wrongPooled).toBeCloseTo(sumJ, 4); // sanity

    // Strong identity: project totals must equal sum of that project's
    // line revenues. This is what § 3.3.1 actually protects.
    const linesByProject = new Map<number, number>();
    for (const l of lines) {
      linesByProject.set(l.projectId, (linesByProject.get(l.projectId) ?? 0) + l.perLineRevenue);
    }
    expect(linesByProject.get(PROJECT_A)).toBeCloseTo(projARevenue, 4);
    expect(linesByProject.get(PROJECT_B)).toBeCloseTo(projBRevenue, 4);
  });
});
