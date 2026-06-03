/**
 * fye_tracking.spec — FYE Tracking reconciliation & methodology test.
 *
 * This is the deliverable gate for the FYE Tracking tab. It has two layers:
 *
 *   1. METHODOLOGY (always runs, no DB): proves the calc rules on synthetic
 *      fixtures — the 4-state classification (incl. the hard prerequisite that
 *      a RED and a BLACK invoice-date row classify differently), the
 *      configurable exclusion list (incl. the namesake survivors), the stale-
 *      copy de-dup rule, the 4-state ↔ Budget partition identity, the amber
 *      COS-no-revenue flag, the NON_STANDARD_TEMPLATE exclusion, the FY window,
 *      and Plan-ahead continuity.
 *
 *   2. LIVE RECON (runs only when a DB with the snapshot is reachable):
 *      recomputes the tab from the raw imported lines and asserts the Excel
 *      figures for the same snapshot — state totals, YTD/May, project count
 *      (48), the Superspar de-dup, and the amber flags. Skips with a clear
 *      message when no DB is configured (the figures move with the data, so
 *      they are asserted against the live snapshot, never a cached total).
 */

import { describe, it, expect } from "vitest";
import {
  classifyFyeState,
  FYE_STATES,
  type FyeState,
} from "../../../server/lib/finance/fye-tracking/fye-state";
import {
  evaluateExclusion,
  isStaleTrackerCopy,
  fileNameToComparableLabel,
  DEFAULT_FYE_EXCLUSIONS,
} from "../../../server/lib/finance/fye-tracking/exclusions";
import {
  computeProjectTable,
  computeDashboard,
  type FyeProjectMeta,
} from "../../../server/lib/finance/fye-tracking/compute";
import type { FinanceLine } from "../../../server/repositories/finance-line-level-repository";

const TODAY = "2026-06-03"; // matches the "as at" anchor in the task

// ── FinanceLine fixture factory ──────────────────────────────────────────────
let _lineId = 0;
function makeLine(p: Partial<FinanceLine> & { projectId: number }): FinanceLine {
  const actualTotal = p.actualTotal ?? 0;
  const perLineRevenue = p.perLineRevenue ?? 0;
  return {
    lineId: p.lineId ?? ++_lineId,
    parentLineId: p.parentLineId ?? 0,
    projectId: p.projectId,
    categoryAllocationId: p.categoryAllocationId ?? 1,
    categoryKey: p.categoryKey ?? "1. panels",
    categoryName: p.categoryName ?? "Panels",
    categoryNumber: p.categoryNumber ?? "1",
    productService: null,
    descriptionOfWork: null,
    qty: null,
    rateUnit: null,
    budgetTotal: p.budgetTotal ?? null,
    forecastPaymentDate: p.forecastPaymentDate ?? null,
    actualTotal,
    poNumber: p.poNumber ?? null,
    invoiceNumber: p.invoiceNumber ?? null,
    invoiceRaisedDate: p.invoiceRaisedDate ?? null,
    invoiceDateFontColor: p.invoiceDateFontColor ?? null,
    invoiceDateConfirmed: p.invoiceDateConfirmed ?? null,
    paidDate: null,
    paidDateConfirmed: null,
    categoryTotalActualTotal: p.categoryTotalActualTotal ?? actualTotal,
    categoryRevenueAllocation: p.categoryRevenueAllocation ?? perLineRevenue,
    perLineRevenue,
    perLineGp: perLineRevenue - actualTotal,
    perLineGpPct: perLineRevenue !== 0 ? (perLineRevenue - actualTotal) / perLineRevenue : null,
    plannedActualTotal: 0,
    plannedRevenue: 0,
    plannedGp: 0,
    plannedGpPct: null,
    bucket: p.bucket ?? "planned",
    recognitionMonth: p.recognitionMonth ?? (p.invoiceRaisedDate ? p.invoiceRaisedDate.slice(0, 7) : null),
    derivationWarning: null,
  };
}

function meta(projectId: number, name: string, over: Partial<FyeProjectMeta> = {}): FyeProjectMeta {
  return {
    projectId,
    projectName: name,
    canonicalKey: over.canonicalKey ?? name.replace(/\s+/g, " ").trim().toLowerCase(),
    type: over.type ?? "Active",
    startDate: over.startDate ?? "2025-09-01",
    pcDate: over.pcDate ?? "2026-03-31",
    sourceFileName: over.sourceFileName ?? null,
    sourceFolderPath: over.sourceFolderPath ?? null,
  };
}

describe("FYE state classification (§ 3.2 / § 3.7 — 4-way)", () => {
  it("HARD PREREQUISITE: a RED and a BLACK invoice-date row classify differently", () => {
    const black = classifyFyeState(
      { invoiceNumber: "INV-001", invoiceDateFontColor: "black", invoiceRaisedDate: "2026-05-10" },
      TODAY,
    );
    const red = classifyFyeState(
      { invoiceNumber: "INV-001", invoiceDateFontColor: "red", invoiceRaisedDate: "2026-05-10" },
      TODAY,
    );
    expect(black).toBe("realised");
    expect(red).toBe("committed");
    expect(black).not.toBe(red);
  });

  it("invoice + BLACK → Realised; invoice + RED → Committed (confirmed flag too)", () => {
    expect(
      classifyFyeState({ invoiceNumber: "A1", invoiceDateConfirmed: true }, TODAY),
    ).toBe("realised");
    expect(
      classifyFyeState({ invoiceNumber: "A1", invoiceDateConfirmed: false }, TODAY),
    ).toBe("committed");
  });

  it("no invoice + RED + future date → Planned", () => {
    expect(
      classifyFyeState(
        { invoiceNumber: null, invoiceDateFontColor: "red", invoiceRaisedDate: "2026-08-01" },
        TODAY,
      ),
    ).toBe("planned");
  });

  it("no invoice → Unrealised (no date, past red date, or black w/o invoice)", () => {
    expect(classifyFyeState({ invoiceNumber: "", invoiceRaisedDate: null }, TODAY)).toBe("unrealised");
    expect(
      classifyFyeState(
        { invoiceNumber: null, invoiceDateFontColor: "red", invoiceRaisedDate: "2025-12-01" },
        TODAY,
      ),
    ).toBe("unrealised");
    expect(
      classifyFyeState(
        { invoiceNumber: null, invoiceDateFontColor: "black", invoiceRaisedDate: "2026-08-01" },
        TODAY,
      ),
    ).toBe("unrealised");
  });

  it("placeholder invoice numbers do not count as a captured invoice", () => {
    for (const ph of ["TBC", "N/A", "pending", "-", "0"]) {
      expect(
        classifyFyeState(
          { invoiceNumber: ph, invoiceDateFontColor: "red", invoiceRaisedDate: "2026-08-01" },
          TODAY,
        ),
      ).toBe("planned");
    }
  });

  it("the four states are exhaustive (every input maps to one of them)", () => {
    const samples: Array<Parameters<typeof classifyFyeState>[0]> = [
      { invoiceNumber: "X", invoiceDateFontColor: "black" },
      { invoiceNumber: "X", invoiceDateFontColor: "red" },
      { invoiceNumber: null, invoiceDateFontColor: "red", invoiceRaisedDate: "2026-08-01" },
      { invoiceNumber: null },
    ];
    for (const s of samples) {
      expect(FYE_STATES).toContain<FyeState>(classifyFyeState(s, TODAY));
    }
  });
});

describe("FYE exclusions — configurable list with namesake survivors", () => {
  it("excludes the named archive/grouping/stale artefacts", () => {
    for (const name of [
      "Dipula",
      "BMG",
      "Klein Karoo Markt",
      "Maynard Mall",
      "Supa Store",
      "IconSA Benoni",
      "The Avenues",
      "Superspar Despatch Phase 2",
    ]) {
      expect(evaluateExclusion([name]).excluded, `${name} should be excluded`).toBe(true);
    }
  });

  it("keeps the live namesakes (exact match, not prefix/substring)", () => {
    for (const name of [
      "BMG Fluid Tech",
      "Klein Karoo Phase 2",
      "Maynard Mall Extension",
      "Superspar Ph2",
    ]) {
      expect(evaluateExclusion([name]).excluded, `${name} should be kept`).toBe(false);
    }
  });

  it("excludes anything under the '99. Old' archive folder (contains match)", () => {
    // A full path that contains the archive folder segment is excluded.
    expect(evaluateExclusion(["/Trackers/99. Old/Foo_Tracker.xlsx".toLowerCase()]).excluded).toBe(true);
    expect(evaluateExclusion(["99. Old"]).excluded).toBe(true);
    expect(evaluateExclusion(["Some Project 99. Old copy"]).excluded).toBe(true);
    // A live project that merely mentions "old" elsewhere is not swept up.
    expect(evaluateExclusion(["Old Mutual Rooftop"]).excluded).toBe(false);
  });

  it("derives a comparable label from a Smart Import file name", () => {
    expect(fileNameToComparableLabel("Superspar_Despatch_Phase_2_Tracker_1779108373976.xlsx")).toBe(
      "superspar despatch phase 2",
    );
    expect(fileNameToComparableLabel("Maynard_Mall_Extension_Tracker.xlsx")).toBe(
      "maynard mall extension",
    );
    // file-name fallback still distinguishes the namesakes
    expect(
      evaluateExclusion([fileNameToComparableLabel("Maynard_Mall_Extension_Tracker.xlsx")]).excluded,
    ).toBe(false);
    expect(
      evaluateExclusion([fileNameToComparableLabel("Maynard_Mall_Tracker_123456.xlsx")]).excluded,
    ).toBe(true);
  });

  it("the default list is non-empty and every entry has a value", () => {
    expect(DEFAULT_FYE_EXCLUSIONS.length).toBeGreaterThan(0);
    for (const r of DEFAULT_FYE_EXCLUSIONS) expect(r.value.length).toBeGreaterThan(0);
  });
});

describe("FYE de-dup — stale budget/handover copy", () => {
  it("drops a copy with no invoices and no black dates (all red)", () => {
    expect(
      isStaleTrackerCopy({ hasAnyInvoiceNumber: false, hasAnyBlackDate: false, lineCount: 40 }),
    ).toBe(true);
  });

  it("keeps a live tracker that has invoices or any black date", () => {
    expect(
      isStaleTrackerCopy({ hasAnyInvoiceNumber: true, hasAnyBlackDate: false, lineCount: 40 }),
    ).toBe(false);
    expect(
      isStaleTrackerCopy({ hasAnyInvoiceNumber: false, hasAnyBlackDate: true, lineCount: 40 }),
    ).toBe(false);
  });

  it("does not classify an empty/not-yet-imported tracker as stale", () => {
    expect(
      isStaleTrackerCopy({ hasAnyInvoiceNumber: false, hasAnyBlackDate: false, lineCount: 0 }),
    ).toBe(false);
  });
});

describe("View A — project table, 4-state totals, flags, de-dup", () => {
  it("the 4 states partition Budget exactly (Realised+Committed+Planned+Unrealised == Budget)", () => {
    const lines = new Map<number, FinanceLine[]>([
      [
        1,
        [
          makeLine({ projectId: 1, invoiceNumber: "I1", invoiceDateFontColor: "black", invoiceRaisedDate: "2026-02-10", actualTotal: 100, perLineRevenue: 130 }),
          makeLine({ projectId: 1, invoiceNumber: "I2", invoiceDateFontColor: "red", invoiceRaisedDate: "2026-04-10", actualTotal: 50, perLineRevenue: 60 }),
          makeLine({ projectId: 1, invoiceNumber: null, invoiceDateFontColor: "red", invoiceRaisedDate: "2026-07-10", actualTotal: 40, perLineRevenue: 55 }),
          makeLine({ projectId: 1, invoiceNumber: null, invoiceDateFontColor: "red", invoiceRaisedDate: "2025-10-10", actualTotal: 10, perLineRevenue: 12 }),
        ],
      ],
    ]);
    const metas = new Map([[1, meta(1, "Mondi")]]);
    const r = computeProjectTable(lines, metas, TODAY);
    const st = r.stateTotals;
    expect(st.realised).toEqual({ revenue: 130, cos: 100 });
    expect(st.committed).toEqual({ revenue: 60, cos: 50 });
    expect(st.planned).toEqual({ revenue: 55, cos: 40 });
    expect(st.unrealised).toEqual({ revenue: 12, cos: 10 });
    expect(st.budget.revenue).toBe(130 + 60 + 55 + 12);
    expect(st.budget.cos).toBe(100 + 50 + 40 + 10);
    // Budget == sum of states, and the project row agrees.
    const row = r.rows.find((x) => x.projectId === 1)!;
    expect(row.budgetRevenue).toBe(257);
    expect(row.actualRevenue).toBe(130); // realised only
    expect(row.pctRealised).toBeCloseTo(130 / 257, 6);
  });

  it("flags COS-no-revenue projects amber but KEEPS the row and counts it in totals", () => {
    const lines = new Map<number, FinanceLine[]>([
      [
        7,
        [
          // realised COS, but zero revenue captured
          makeLine({ projectId: 7, invoiceNumber: "S1", invoiceDateFontColor: "black", invoiceRaisedDate: "2026-01-10", actualTotal: 200000, perLineRevenue: 0 }),
        ],
      ],
    ]);
    const r = computeProjectTable(lines, new Map([[7, meta(7, "Sibasa")]]), TODAY);
    const row = r.rows.find((x) => x.projectId === 7)!;
    expect(row.flags).toContain("COS_NO_REVENUE");
    expect(row.excludedFromTotals).toBe(false);
    expect(r.projectCount).toBe(1);
    expect(r.stateTotals.realised.cos).toBe(200000); // counted in totals
    expect(r.stateTotals.realised.revenue).toBe(0);
  });

  it("flags an old-template project NON_STANDARD and excludes it from totals (keeps row)", () => {
    const lines = new Map<number, FinanceLine[]>([
      [9, [makeLine({ projectId: 9, invoiceNumber: null, invoiceRaisedDate: null, actualTotal: 12345, perLineRevenue: 0 })]],
    ]);
    const r = computeProjectTable(lines, new Map([[9, meta(9, "MEGA_PARK_P2")]]), TODAY);
    const row = r.rows.find((x) => x.projectId === 9)!;
    expect(row.flags).toContain("NON_STANDARD_TEMPLATE");
    expect(row.excludedFromTotals).toBe(true);
    expect(r.stateTotals.budget.cos).toBe(0); // excluded from totals
    expect(r.projectCount).toBe(1); // but still shown
  });

  it("excludes named artefacts and de-dups stale duplicate trackers (Superspar lives, Despatch dropped)", () => {
    const lines = new Map<number, FinanceLine[]>([
      // Live Superspar Ph2
      [10, [makeLine({ projectId: 10, invoiceNumber: "SP1", invoiceDateFontColor: "black", invoiceRaisedDate: "2026-03-10", actualTotal: 1000, perLineRevenue: 1200 })]],
      // Stale "Superspar Despatch Phase 2" — caught by the exclusion LIST (by name)
      [11, [makeLine({ projectId: 11, invoiceNumber: null, invoiceDateFontColor: "red", invoiceRaisedDate: "2026-03-10", actualTotal: 1000, perLineRevenue: 1200 })]],
      // Two trackers for one project (same canonicalKey) — DEDUP path:
      // live copy (has invoice) + stale copy (all red, no invoice)
      [20, [makeLine({ projectId: 20, invoiceNumber: "CG1", invoiceDateFontColor: "black", invoiceRaisedDate: "2026-02-10", actualTotal: 500, perLineRevenue: 650 })]],
      [21, [makeLine({ projectId: 21, invoiceNumber: null, invoiceDateFontColor: "red", invoiceRaisedDate: "2026-02-10", actualTotal: 500, perLineRevenue: 650 })]],
    ]);
    const metas = new Map<number, FyeProjectMeta>([
      [10, meta(10, "Superspar Ph2")],
      [11, meta(11, "Superspar Despatch Phase 2", { type: "Compliance" })],
      [20, meta(20, "Coega Steels Ph2", { canonicalKey: "coega steels ph2" })],
      [21, meta(21, "Coega Steels Ph2 (handover copy)", { canonicalKey: "coega steels ph2" })],
    ]);
    const r = computeProjectTable(lines, metas, TODAY);
    const shownIds = r.rows.map((x) => x.projectId).sort((a, b) => a - b);
    expect(shownIds).toEqual([10, 20]); // Superspar lives; Despatch + stale Coega dropped
    expect(r.projectCount).toBe(2);
    expect(r.excluded.some((e) => e.projectId === 11)).toBe(true); // by exclusion list
    expect(r.excluded.some((e) => e.projectId === 21)).toBe(true); // by de-dup
    expect(r.rows.find((x) => x.project === "Superspar Ph2")).toBeTruthy();
  });

  it("sorts by Budget Rev desc and the TOTAL row sums the counted rows", () => {
    const lines = new Map<number, FinanceLine[]>([
      [1, [makeLine({ projectId: 1, invoiceNumber: "A", invoiceDateFontColor: "black", invoiceRaisedDate: "2026-01-10", actualTotal: 100, perLineRevenue: 1000 })]],
      [2, [makeLine({ projectId: 2, invoiceNumber: "B", invoiceDateFontColor: "black", invoiceRaisedDate: "2026-01-10", actualTotal: 100, perLineRevenue: 3000 })]],
    ]);
    const r = computeProjectTable(lines, new Map([[1, meta(1, "Small")], [2, meta(2, "Big")]]), TODAY);
    expect(r.rows.map((x) => x.project)).toEqual(["Big", "Small"]);
    expect(r.totals.budgetRevenue).toBe(4000);
    expect(r.totals.actualRevenue).toBe(4000);
  });
});

describe("View B — dashboard (Revised Budget / Actual / Plan-ahead)", () => {
  const FY_MONTHS = [
    "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02",
    "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08",
  ];
  const LAST_CLOSED = "2026-05";

  function dashLines(): FinanceLine[] {
    return [
      // Realised actuals in closed months
      makeLine({ projectId: 1, invoiceNumber: "R1", invoiceDateFontColor: "black", invoiceRaisedDate: "2026-04-15", actualTotal: 100, perLineRevenue: 130 }),
      makeLine({ projectId: 1, invoiceNumber: "R2", invoiceDateFontColor: "black", invoiceRaisedDate: "2026-05-15", actualTotal: 200, perLineRevenue: 260 }),
      // Pipeline (committed + planned) in future months
      makeLine({ projectId: 1, invoiceNumber: "C1", invoiceDateFontColor: "red", invoiceRaisedDate: "2026-06-15", actualTotal: 50, perLineRevenue: 70 }),
      makeLine({ projectId: 1, invoiceNumber: null, invoiceDateFontColor: "red", invoiceRaisedDate: "2026-07-15", actualTotal: 40, perLineRevenue: 55 }),
    ];
  }

  it("Actual stops after the last closed month; Plan-ahead is continuous (no gap, no leading blanks)", () => {
    const d = computeDashboard(dashLines(), {}, FY_MONTHS, LAST_CLOSED, TODAY);
    const rev = d.revenue.ytd;
    const at = (mk: string) => rev.find((r) => r.monthKey === mk)!;

    // Actual cumulative: 130 (Apr) then 390 (May), null after.
    expect(at("2026-04").actual).toBe(130);
    expect(at("2026-05").actual).toBe(390);
    expect(at("2026-06").actual).toBeNull();
    expect(at("2026-08").actual).toBeNull();

    // Plan-ahead shares the actual cumulative through the last closed month …
    expect(at("2026-05").planAhead).toBe(390);
    // … then continues: +70 (Jun committed) = 460, +55 (Jul planned) = 515, flat Aug.
    expect(at("2026-06").planAhead).toBe(460);
    expect(at("2026-07").planAhead).toBe(515);
    expect(at("2026-08").planAhead).toBe(515);

    // No leading blanks before the first data and continuity at the seam.
    expect(at("2026-05").planAhead).toBe(at("2026-05").actual);
  });

  it("Revised Budget is the manual once-off monthly figure, cumulated for YTD", () => {
    const revised = { revenue: { "2025-09": 1_000_000, "2025-10": 500_000 } };
    const d = computeDashboard(dashLines(), revised, FY_MONTHS, LAST_CLOSED, TODAY);
    const sep = d.revenue.monthly.find((m) => m.monthKey === "2025-09")!;
    expect(sep.revisedBudget).toBe(1_000_000);
    const octYtd = d.revenue.ytd.find((m) => m.monthKey === "2025-10")!;
    expect(octYtd.revisedBudget).toBe(1_500_000); // cumulative
  });

  it("GP series = Revenue − COS for each state-set/month", () => {
    const d = computeDashboard(dashLines(), {}, FY_MONTHS, LAST_CLOSED, TODAY);
    const gpApr = d.gp.monthly.find((m) => m.monthKey === "2026-04")!;
    expect(gpApr.actual).toBe(130 - 100); // realised GP for Apr
    const gpJun = d.gp.monthly.find((m) => m.monthKey === "2026-06")!;
    expect(gpJun.planAhead).toBe(70 - 50); // pipeline GP for Jun
  });
});

/**
 * LIVE RECONCILIATION — runs only when a DB with the 3-Jun-2026 snapshot is
 * reachable (DATABASE_URL set). Recomputes the tab from the raw imported lines
 * and asserts the Excel figures for that snapshot. Without a DB it self-skips
 * (this container has none). The service is imported dynamically so the
 * methodology tests above never load the DB layer.
 */
describe.skipIf(!process.env.DATABASE_URL)("Live snapshot reconciliation (DATABASE_URL set)", () => {
  // Tolerance: "within rounding" — tight enough to catch a misclassified line
  // (which would shift a bucket by far more), loose enough for cent-level FP.
  const close = (actual: number, expected: number, label: string) => {
    const tol = Math.max(1, Math.abs(expected) * 0.0005); // R1 or 0.05%
    const delta = Math.abs(actual - expected);
    expect(
      delta <= tol,
      `${label}: got ${actual.toLocaleString()} expected ~${expected.toLocaleString()} (Δ ${delta.toLocaleString()}, tol ${tol.toFixed(0)})`,
    ).toBe(true);
  };

  it("reproduces the FY26 state totals, YTD/May Realised, project count (48), de-dup and amber flags", async () => {
    const { buildFyeTracking } = await import("../../../server/lib/finance/fye-tracking/service");
    const { extractReconMetrics, FY26_EXCEL_BASELINE: base } = await import(
      "../../../server/lib/finance/fye-tracking/recon"
    );
    const result = await buildFyeTracking(2026, {}, new Date("2026-06-03T12:00:00Z"));
    const m = extractReconMetrics(result, "2026-05");

    // eslint-disable-next-line no-console
    console.table({
      Realised: m.states.realised,
      Committed: m.states.committed,
      Planned: m.states.planned,
      Unrealised: m.states.unrealised,
      Budget: m.states.budget,
    });

    // 4-state totals.
    for (const s of ["realised", "committed", "planned", "unrealised", "budget"] as const) {
      close(m.states[s].revenue, base.states[s].revenue, `${s} revenue`);
      close(m.states[s].cos, base.states[s].cos, `${s} cos`);
    }
    // YTD Realised + margin.
    close(m.ytdRealised.revenue, base.ytdRealised.revenue, "YTD realised revenue");
    close(m.ytdRealised.cos, base.ytdRealised.cos, "YTD realised cos");
    close(m.ytdRealised.gp, base.ytdRealised.gp, "YTD realised gp");
    expect(Math.abs((m.ytdRealised.marginPct ?? 0) - base.ytdRealised.marginPct)).toBeLessThan(0.005);
    // May Realised.
    close(m.monthRealised.revenue, base.mayRealised.revenue, "May realised revenue");
    close(m.monthRealised.cos, base.mayRealised.cos, "May realised cos");
    // Project count, Superspar de-dup.
    expect(m.projectCount).toBe(base.projectCount); // 48
    expect(m.supersparDespatchDuplicateCount).toBe(0);
    expect(m.supersparLiveCount).toBeGreaterThanOrEqual(1);
    // Amber COS-no-revenue flags present (names matched case-insensitively).
    const amberNorm = m.amberProjects.map((n) => n.toLowerCase());
    for (const name of base.amberProjects) {
      expect(
        amberNorm.some((a) => a.includes(name.toLowerCase()) || name.toLowerCase().includes(a)),
        `expected an amber COS-no-revenue flag for "${name}" (got: ${m.amberProjects.join(", ")})`,
      ).toBe(true);
    }
  });
});
