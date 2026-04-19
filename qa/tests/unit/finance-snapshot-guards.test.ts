/**
 * Finance snapshot-guard regression tests
 *
 * Pins four source-level invariants that have each regressed in the past:
 *
 *   1. kpi-traceability-routes.ts — the SUM over project_revenue_summary
 *      must filter effective_to IS NULL, else historical snapshots are
 *      double-counted.
 *
 *   2. kpi-traceability-routes.ts — the SUM/COUNT DISTINCT over
 *      cashflow_points must filter effective_to IS NULL for the same reason.
 *
 *   3. derivative-materializer.ts — the post-commit upsert lookup on
 *      project_revenue_summary must filter effectiveTo IS NULL, else the
 *      UPDATE branch can pick a soft-closed historical row and leave the
 *      current row stale.
 *
 *   4. canonical-dashboard-kpi-service.ts — the PostgreSQL branch of the
 *      revenue aggregate must filter both effective_to IS NULL AND
 *      deleted_at IS NULL (the SQLite branch already does). Without the
 *      deleted_at guard, soft-deleted revenue rows inflate totalRevenue /
 *      receivedRevenue / outstandingRevenue only on PostgreSQL.
 *
 *   5. project-header-kpi-service.ts — margin percentage must be persisted
 *      to dashboard_project_metrics on the 0–100 scale, matching
 *      computeMarginPct's return value and the convention declared in
 *      server/services/dashboard-metrics.ts. Any `currentMarginPct / 100`
 *      expression stores it on the 0–1 scale and the column shows 100×
 *      smaller than reality.
 *
 * These assertions are source-text level on purpose: the bugs recurred at
 * the source level, the checks are fast, and they do not need a DB.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function windowAfter(haystack: string, needle: string, chars = 300): string {
  const idx = haystack.indexOf(needle);
  if (idx === -1) return "";
  return haystack.slice(idx, idx + chars);
}

describe("finance snapshot guards — kpi-traceability-routes.ts", () => {
  const source = read("server/kpi-traceability-routes.ts");

  it("SUM over project_revenue_summary filters effective_to IS NULL", () => {
    const tail = windowAfter(source, "FROM project_revenue_summary", 120);
    expect(
      tail,
      "project_revenue_summary SUM must filter effective_to IS NULL (else historical snapshots double-count)",
    ).toMatch(/effective_to\s+IS\s+NULL/i);
  });

  it("SUM over cashflow_points filters effective_to IS NULL", () => {
    const tail = windowAfter(source, "FROM cashflow_points", 120);
    expect(
      tail,
      "cashflow_points SUM must filter effective_to IS NULL (else historical snapshots double-count)",
    ).toMatch(/effective_to\s+IS\s+NULL/i);
  });
});

describe("finance snapshot guards — derivative-materializer.ts", () => {
  const source = read("server/lib/import/derivative-materializer.ts");

  it("imports isNull from drizzle-orm", () => {
    expect(
      source,
      "derivative-materializer must import isNull so it can filter effectiveTo on the PRS lookup",
    ).toMatch(/import\s*\{[^}]*\bisNull\b[^}]*\}\s*from\s*["']drizzle-orm["']/);
  });

  it("filters projectRevenueSummary.effectiveTo on the existing-row lookup", () => {
    expect(
      source,
      "post-commit PRS refresh must filter effectiveTo IS NULL or it can UPDATE a soft-closed row",
    ).toMatch(/isNull\(\s*projectRevenueSummary\.effectiveTo\s*\)/);
  });
});

describe("finance snapshot guards — canonical-dashboard-kpi-service.ts", () => {
  const source = read("server/services/canonical-dashboard-kpi-service.ts");

  it("PG revenue aggregate filters both effective_to IS NULL and deleted_at IS NULL", () => {
    const tail = windowAfter(source, "FROM normalized_revenue_lines", 400);
    expect(tail, "PG branch must filter effective_to IS NULL").toMatch(
      /effective_to\s+IS\s+NULL/i,
    );
    expect(
      tail,
      "PG branch must filter deleted_at IS NULL (matches SQLite branch and prevents inflated totals)",
    ).toMatch(/deleted_at\s+IS\s+NULL/i);
  });
});

describe("finance margin scale — project-header-kpi-service.ts", () => {
  const source = read("server/services/project-header-kpi-service.ts");

  it("does not persist currentMarginPct divided by 100", () => {
    expect(
      source,
      "dashboard_project_metrics.margin_pct convention is 0–100 scale; storing currentMarginPct/100 makes every read display 100× too small",
    ).not.toMatch(/currentMarginPct\s*\/\s*100/);
  });
});
