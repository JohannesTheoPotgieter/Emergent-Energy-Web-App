import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildGpMonthSummaries,
  pickCurrentMonth,
  type CosTrackerMonth,
  type RevTrackerMonth,
} from "@/lib/finance/gp-summary";

/**
 * Finance Home is a pure READER (G1 "honest" pass). These tests pin two things
 * the acceptance criteria require:
 *
 *  1. Home derives its company REV / COS / GP from the SAME canonical endpoints
 *     the finance pages read (/api/cos-tracker + /api/revenue-tracker), with the
 *     SAME derivation the GP page applies — so Home can never show a figure the
 *     finance pages don't. Proven numerically within R1.
 *
 *  2. There is no per-project QuickBooks surface on Home (QB cost bills aren't
 *     project-tagged → company-grain QB only), and "no data" is visually
 *     distinct from a real R0. Proven structurally + at the data level.
 */

// Fixture COS + REV tracker payloads (the subset Home and the GP page consume).
// Deliberately misaligned: a REV-only month (no COS frame) must be dropped by
// both derivations, a COS-only month falls to rev 0, plus a real break-even
// month (R0 GP with activity) and a genuinely-empty month (no realised lines).
const COS: CosTrackerMonth[] = [
  { monthKey: "2025-09", monthLabel: "Sep 25", budget: 120, realisedCOS: 100 },
  { monthKey: "2025-10", monthLabel: "Oct 25", budget: 210, realisedCOS: 200 }, // break-even
  { monthKey: "2025-11", monthLabel: "Nov 25", budget: 50, realisedCOS: 0 }, // no realised data
  { monthKey: "2026-01", monthLabel: "Jan 26", budget: 60, realisedCOS: 50 }, // cos-only (rev missing)
];

const REV: RevTrackerMonth[] = [
  { monthKey: "2025-09", monthLabel: "Sep 25", budget: 180, realisedRevenue: 150 },
  { monthKey: "2025-10", monthLabel: "Oct 25", budget: 210, realisedRevenue: 200 },
  { monthKey: "2025-11", monthLabel: "Nov 25", budget: 80, realisedRevenue: 0 },
  { monthKey: "2025-12", monthLabel: "Dec 25", budget: 90, realisedRevenue: 999 }, // rev-only → dropped
];

/**
 * Mirror of the finance GP page's company-total derivation
 * (finance-gp-company.tsx:299-365 allMonths + 440-458 fyTotals): frame on the
 * COS months, look the REV month up by key, realised{Revenue,COS} default to 0,
 * realisedGP = realisedRevenue − realisedCOS, sum across the framed months.
 */
function financePageCompanyRealised(cos: CosTrackerMonth[], rev: RevTrackerMonth[]) {
  const revByKey = new Map(rev.map((m) => [m.monthKey, m]));
  let revenue = 0;
  let costOfSales = 0;
  for (const c of cos) {
    const r = revByKey.get(c.monthKey);
    revenue += r?.realisedRevenue ?? 0;
    costOfSales += c.realisedCOS ?? 0;
  }
  return { revenue, cos: costOfSales, gp: revenue - costOfSales };
}

/** Home's company totals straight off its real gp-summary helper. */
function homeCompanyRealised(cos: CosTrackerMonth[], rev: RevTrackerMonth[]) {
  const months = buildGpMonthSummaries(cos, rev);
  return months.reduce(
    (acc, m) => ({
      revenue: acc.revenue + m.realisedRevenue,
      cos: acc.cos + m.realisedCOS,
      gp: acc.gp + m.realisedGP,
    }),
    { revenue: 0, cos: 0, gp: 0 },
  );
}

const R1 = 1;
const readSrc = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const HOME_SRC = "client/src/pages/finance-home.tsx";
const GP_SRC = "client/src/pages/finance-gp-company.tsx";

describe("Finance Home reads canonical endpoints — figures match the finance pages", () => {
  it("company REV / COS / GP equal the finance GP page within R1", () => {
    const home = homeCompanyRealised(COS, REV);
    const page = financePageCompanyRealised(COS, REV);

    expect(Math.abs(home.revenue - page.revenue)).toBeLessThanOrEqual(R1);
    expect(Math.abs(home.cos - page.cos)).toBeLessThanOrEqual(R1);
    expect(Math.abs(home.gp - page.gp)).toBeLessThanOrEqual(R1);

    // Concrete totals (REV-only Dec dropped, Jan rev falls to 0).
    expect(page).toEqual({ revenue: 350, cos: 350, gp: 0 });
  });

  it("preserves the §3.3.1 identity GP ≡ REV − COS within R1", () => {
    const home = homeCompanyRealised(COS, REV);
    expect(Math.abs(home.gp - (home.revenue - home.cos))).toBeLessThanOrEqual(R1);
  });

  it("distinguishes a real break-even R0 month from a no-data month", () => {
    const months = buildGpMonthSummaries(COS, REV);

    // Oct: realised activity on both sides, GP nets to R0 — a REAL zero.
    const breakEven = pickCurrentMonth(months, "2025-10").current;
    expect(breakEven?.realisedGP).toBe(0);
    const breakEvenHasData =
      breakEven != null && (breakEven.realisedRevenue !== 0 || breakEven.realisedCOS !== 0);
    expect(breakEvenHasData).toBe(true); // → renders "R 0"

    // Nov: no realised lines at all — the explicit empty state, not "R 0".
    const empty = pickCurrentMonth(months, "2025-11").current;
    const emptyHasData =
      empty != null && (empty.realisedRevenue !== 0 || empty.realisedCOS !== 0);
    expect(emptyHasData).toBe(false); // → renders "No data"
  });
});

describe("Finance Home — same endpoints as the finance pages, no per-project QB", () => {
  it("Home and the GP page both read /api/cos-tracker and /api/revenue-tracker", () => {
    const home = readSrc(HOME_SRC);
    const gp = readSrc(GP_SRC);
    for (const src of [home, gp]) {
      expect(src).toContain("/api/cos-tracker");
      expect(src).toContain("/api/revenue-tracker");
    }
  });

  it("Home exposes no per-project QuickBooks status (company-grain QB only)", () => {
    const home = readSrc(HOME_SRC);
    // qbStatus / qbDelta were the per-project QB fields the server never sent.
    expect(home).not.toMatch(/\bqbStatus\b/);
    expect(home).not.toMatch(/\bqbDelta\b/);
    // The one QB surface stays — the company-level qb-recon summary tile.
    expect(home).toContain("/api/finance/qb-recon/summary");
  });

  it("Home renders explicit empty states (never a silent dash)", () => {
    const home = readSrc(HOME_SRC);
    expect(home).toContain("QB recon not run for this period");
    expect(home).toContain("No realised tracker data this month");
  });
});
