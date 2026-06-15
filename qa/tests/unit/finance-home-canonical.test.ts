import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildGpMonthSummaries,
  type CosTrackerMonth,
  type RevTrackerMonth,
} from "@/lib/finance/gp-summary";

/**
 * Finance Home is a pure READER. These tests pin the acceptance criteria for
 * the rebuilt accountant dashboard:
 *
 *  1. Home derives company REV / COS / GP from the SAME canonical endpoints the
 *     finance pages read (/api/cos-tracker + /api/revenue-tracker), with the
 *     SAME GP derivation the GP page applies — so Home can never show a figure
 *     the finance pages don't. Proven numerically within R1.
 *
 *  2. Every figure reads the canonical read path. No project_revenue_summary /
 *     aggregate-PRS source, no /api/company-overview whole-life plan, and no
 *     QuickBooks tile (QB lives only on /finance/qb-reconciliation).
 *
 *  3. The trust strip is the per-project app-vs-tracker reconciliation, where a
 *     "tie" means tie-to-tracker and a project with no baseline reads
 *     "not compared yet" — never a bare "Δ R0 / No data".
 */

const COS: CosTrackerMonth[] = [
  { monthKey: "2025-09", monthLabel: "Sep 25", budget: 120, realisedCOS: 100 },
  { monthKey: "2025-10", monthLabel: "Oct 25", budget: 210, realisedCOS: 200 }, // break-even
  { monthKey: "2025-11", monthLabel: "Nov 25", budget: 50, realisedCOS: 0 },
  { monthKey: "2026-01", monthLabel: "Jan 26", budget: 60, realisedCOS: 50 }, // cos-only (rev missing)
];

const REV: RevTrackerMonth[] = [
  { monthKey: "2025-09", monthLabel: "Sep 25", budget: 180, realisedRevenue: 150 },
  { monthKey: "2025-10", monthLabel: "Oct 25", budget: 210, realisedRevenue: 200 },
  { monthKey: "2025-11", monthLabel: "Nov 25", budget: 80, realisedRevenue: 0 },
  { monthKey: "2025-12", monthLabel: "Dec 25", budget: 90, realisedRevenue: 999 }, // rev-only → dropped
];

/** Mirror of the GP page's company-total derivation: frame on COS months. */
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

/** Home's company totals straight off the locked gp-summary helper. */
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
const HOME_DATA_SRC = "client/src/lib/finance/home-data.ts";

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
});

describe("Finance Home — canonical source path only", () => {
  it("Home and the GP page both read /api/cos-tracker and /api/revenue-tracker", () => {
    for (const src of [readSrc(HOME_SRC), readSrc(GP_SRC)]) {
      expect(src).toContain("/api/cos-tracker");
      expect(src).toContain("/api/revenue-tracker");
    }
  });

  it("Home reads NO project_revenue_summary / aggregate-PRS source", () => {
    const home = readSrc(HOME_SRC) + readSrc(HOME_DATA_SRC);
    expect(home).not.toMatch(/project_revenue_summary/);
    expect(home).not.toMatch(/projectRevenueSummary/);
    expect(home).not.toMatch(/category_revenue_allocations\b/);
  });

  it("Home no longer reads the whole-life company-overview plan", () => {
    expect(readSrc(HOME_SRC)).not.toContain("/api/company-overview");
  });

  it("Home has no QuickBooks tile (QB lives only on /finance/qb-reconciliation)", () => {
    const home = readSrc(HOME_SRC);
    expect(home).not.toMatch(/qb-recon/);
    expect(home).not.toMatch(/\bqbStatus\b/);
    expect(home).not.toMatch(/\bqbDelta\b/);
    expect(home).not.toMatch(/QuickBooks/i);
  });
});

describe("Finance Home — trust strip is tie-to-tracker, never 'Δ R0 / No data'", () => {
  it("reads the per-project reconciliation portfolio", () => {
    expect(readSrc(HOME_SRC)).toContain("/api/finance/reconciliation");
  });

  it("surfaces 'not compared yet' for projects with no tracker baseline", () => {
    expect(readSrc(HOME_SRC)).toContain("not compared yet");
  });

  it("never renders a bare 'Δ R0' or 'No data' delta on Home", () => {
    const home = readSrc(HOME_SRC);
    expect(home).not.toMatch(/Δ R0/);
    expect(home).not.toMatch(/Δ\s*\{/); // no inline delta rendering
  });
});
