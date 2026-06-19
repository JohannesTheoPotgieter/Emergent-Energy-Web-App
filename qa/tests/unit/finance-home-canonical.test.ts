import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Finance Home reads from the canonical line path for COS/GP/reconciliation AND
 * — by owner decision (2026-06-19) — from /api/revenue-tracker for its REVENUE
 * figures, so the revenue KPI and the revenue-by-month chart tie cell-for-cell
 * to the Revenue screen (which reads the same endpoint). These tests pin the
 * acceptance criteria:
 *
 *  1. COS/GP/reconciliation read /api/finance/lines (the §3.3 single read path
 *     into finance-line-level-repository).
 *  2. The revenue KPI + revenue-by-month chart read /api/revenue-tracker so
 *     budget · planned · realised · QuickBooks match the Revenue screen exactly.
 *     Realised revenue is the same canonical source on both endpoints, so
 *     REV − COS = GP still holds on the KPI strip.
 *  3. No pre-summarised rollup, no company-overview whole-life plan, no QB-recon
 *     DATA tile (QB *reconciliation* lives only on its own page), and NOT the
 *     /api/cos-tracker aggregate.
 *  4. The trust strip is the per-project app-vs-tracker reconciliation, where a
 *     "tie" means tie-to-tracker and a project with no baseline reads
 *     "not compared yet" — never a bare "Δ R0 / No data".
 */

const readSrc = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const HOME_SRC = "client/src/pages/finance-home.tsx";
const HOME_DATA_SRC = "client/src/lib/finance/home-data.ts";

describe("Finance Home — canonical underlying sources", () => {
  it("reads the §3.3 single read path /api/finance/lines for COS/GP", () => {
    expect(readSrc(HOME_SRC)).toContain("/api/finance/lines");
  });

  it("reads /api/revenue-tracker for revenue so it ties to the Revenue screen", () => {
    // Owner decision (2026-06-19): the revenue KPI + revenue-by-month chart read
    // the SAME endpoint the Revenue screen uses, so budget/planned/realised/QB
    // match exactly. The COS aggregate endpoint stays forbidden.
    const home = readSrc(HOME_SRC);
    expect(home).toContain("/api/revenue-tracker");
    expect(home).not.toContain("/api/cos-tracker");
  });

  it("reads NO project_revenue_summary / aggregate-PRS source", () => {
    const home = readSrc(HOME_SRC) + readSrc(HOME_DATA_SRC);
    expect(home).not.toMatch(/project_revenue_summary/);
    expect(home).not.toMatch(/projectRevenueSummary/);
  });

  it("does not read the whole-life company-overview plan", () => {
    expect(readSrc(HOME_SRC)).not.toContain("/api/company-overview");
  });

  it("has no QB-reconciliation DATA tile (QB recon lives only on its own page)", () => {
    const home = readSrc(HOME_SRC);
    // A navigational LINK to /finance/qb-reconciliation is allowed (and expected
    // — the trust strip + Drift badges point there). A QuickBooks-realised bar on
    // the revenue chart is also allowed (owner decision 2026-06-19). What's
    // forbidden is embedding QB-RECON DATA on Home: the /api/finance/qb-recon
    // endpoints, the qb-recon-* tile markers, and the qbStatus/qbDelta recon
    // fields. (The page route "qb-reconciliation" is NOT "qb-recon/" or
    // "qb-recon-", so it's permitted.)
    expect(home).not.toContain("/api/finance/qb-recon");
    expect(home).not.toContain("qb-recon-");
    expect(home).not.toMatch(/\bqbStatus\b/);
    expect(home).not.toMatch(/\bqbDelta\b/);
  });
});

describe("Finance Home — trust strip is tie-to-tracker, never 'Δ R0 / No data'", () => {
  it("reads the per-project reconciliation portfolio", () => {
    expect(readSrc(HOME_SRC)).toContain("/api/finance/reconciliation");
  });

  it("surfaces 'not compared yet' for projects with no tracker baseline", () => {
    expect(readSrc(HOME_SRC)).toContain("not compared yet");
  });

  it("never renders a bare 'Δ R0' or inline delta on Home", () => {
    const home = readSrc(HOME_SRC);
    expect(home).not.toMatch(/Δ R0/);
    expect(home).not.toMatch(/Δ\s*\{/);
  });
});
