import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Finance Home is a pure READER with ONE canonical underlying source for every
 * REV/COS/GP figure: /api/finance/lines (the §3.3 single read path into
 * finance-line-level-repository). These tests pin the acceptance criteria:
 *
 *  1. Every REV/COS/GP figure reads /api/finance/lines — the KPIs, charts,
 *     per-project table and breakdowns all read the SAME realised fields, so
 *     they reconcile with each other and with the GP / Revenue / COS pages.
 *  2. No pre-summarised rollup, no company-overview whole-life plan, no QB tile,
 *     and (to prove single-sourcing) NOT the per-month tracker aggregate
 *     endpoints either.
 *  3. The trust strip is the per-project app-vs-tracker reconciliation, where a
 *     "tie" means tie-to-tracker and a project with no baseline reads
 *     "not compared yet" — never a bare "Δ R0 / No data".
 */

const readSrc = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const HOME_SRC = "client/src/pages/finance-home.tsx";
const HOME_DATA_SRC = "client/src/lib/finance/home-data.ts";

describe("Finance Home — one canonical underlying source", () => {
  it("reads the §3.3 single read path /api/finance/lines", () => {
    expect(readSrc(HOME_SRC)).toContain("/api/finance/lines");
  });

  it("does NOT read the per-month tracker aggregate endpoints (single-sourced)", () => {
    const home = readSrc(HOME_SRC);
    expect(home).not.toContain("/api/cos-tracker");
    expect(home).not.toContain("/api/revenue-tracker");
  });

  it("reads NO project_revenue_summary / aggregate-PRS source", () => {
    const home = readSrc(HOME_SRC) + readSrc(HOME_DATA_SRC);
    expect(home).not.toMatch(/project_revenue_summary/);
    expect(home).not.toMatch(/projectRevenueSummary/);
  });

  it("does not read the whole-life company-overview plan", () => {
    expect(readSrc(HOME_SRC)).not.toContain("/api/company-overview");
  });

  it("has no QuickBooks tile (QB lives only on its own reconciliation page)", () => {
    const home = readSrc(HOME_SRC);
    // A navigational LINK to /finance/qb-reconciliation is allowed (and expected
    // — the trust strip + Drift badges point there). What's forbidden is
    // embedding QB-recon DATA or a QB tile on Home: the /api/finance/qb-recon
    // endpoints and the qb-recon-* tile markers. (The page route
    // "qb-reconciliation" is NOT "qb-recon/" or "qb-recon-", so it's permitted.)
    expect(home).not.toContain("/api/finance/qb-recon");
    expect(home).not.toContain("qb-recon-");
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

  it("never renders a bare 'Δ R0' or inline delta on Home", () => {
    const home = readSrc(HOME_SRC);
    expect(home).not.toMatch(/Δ R0/);
    expect(home).not.toMatch(/Δ\s*\{/);
  });
});
