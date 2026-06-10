#!/usr/bin/env tsx
/**
 * verify:finance — cross-surface equality assertion (§ 3.3.2, "one read path").
 *
 * THE invariant: the same metric (REV / COS / GP) must be ONE value on every
 * surface. This script reads each surface the way its screen does and asserts
 * per-project equality within R1:
 *
 *   canonical          server/lib/finance/canonical-project-totals over
 *                      FinanceLineLevelRepository — the § 3.3.2 single read
 *                      path. Finance Home, the Revenue/COS/GP pages, project
 *                      detail and the reconciliation board all consume this
 *                      repository directly, so it is the baseline column.
 *   dashboard-kpi      canonical-dashboard-kpi-service (project cards /
 *                      portfolio dashboards): recognisedRevenue + realisedCost.
 *   prs                project_revenue_summary live row (FYE Detail, project
 *                      header KPIs, financial reviews): actualRevenue /
 *                      actualExpenditure / actualProfit.
 *   company-overview   getCompanyOverviewData(): realisedRevenueFytd /
 *                      realisedCostFytd — compared company-wide against the
 *                      FY-windowed canonical sum over the same active set.
 *   golden             qa/fixtures/golden-trackers-5.json (F0): where a live
 *                      project name matches a golden project, canonical
 *                      realised REV/COS must tie the independent tracker
 *                      recompute within R1.
 *
 * Any |Δ| > R1 fails (exit 1). This is the assertion that would have caught
 * B1 — four surfaces rendering four different "revenue" numbers.
 *
 * Run: npm run verify:finance (chained after the reconciliation proof).
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { and, isNull } from "drizzle-orm";
import { projectInfo, projectRevenueSummary } from "@shared/schema";

const R1 = 1;

const num = (v: unknown): number => {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number): number => Math.round(n * 100) / 100;
const normText = (v: unknown): string => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export interface CrossSurfaceRow {
  scope: "project" | "company";
  projectId: number | null;
  projectName: string;
  metric: string;
  surface: string;
  canonical: number;
  surfaceValue: number;
  delta: number;
  pass: boolean;
}

export interface CrossSurfaceResult {
  rows: CrossSurfaceRow[];
  failures: CrossSurfaceRow[];
  comparisons: number;
  pass: boolean;
}

export interface CrossSurfaceOptions {
  /** Restrict to specific projects (test hook). Default: all live projects. */
  projectIds?: number[];
  /** Skip the whole-company overview comparison (scoped test runs). */
  skipCompanyOverview?: boolean;
}

/**
 * Exported core so the DB-gated test suite and the CLI share one
 * implementation. Imports the app modules lazily so `initializeDatabase()`
 * runs first.
 */
export async function runCrossSurfaceFinanceVerification(
  opts: CrossSurfaceOptions = {},
): Promise<CrossSurfaceResult> {
  const { db, initializeDatabase } = await import("../db");
  await initializeDatabase();
  const { getCanonicalProjectTotals } = await import("../lib/finance/canonical-project-totals");
  const { getCanonicalFinanceByProjectIds } = await import("../services/canonical-dashboard-kpi-service");

  const liveProjects: Array<{ id: number; projectName: string }> = await db
    .select({ id: projectInfo.id, projectName: projectInfo.projectName })
    .from(projectInfo)
    .where(isNull(projectInfo.deletedAt));
  const scoped = opts.projectIds
    ? liveProjects.filter((p) => opts.projectIds!.includes(p.id))
    : liveProjects;
  const scopedIds = scoped.map((p) => p.id);
  const nameById = new Map(scoped.map((p) => [p.id, p.projectName]));

  const rows: CrossSurfaceRow[] = [];
  const compare = (
    scope: "project" | "company",
    projectId: number | null,
    projectName: string,
    metric: string,
    surface: string,
    canonical: number,
    surfaceValue: number,
  ) => {
    const delta = r2(surfaceValue - canonical);
    rows.push({
      scope,
      projectId,
      projectName,
      metric,
      surface,
      canonical: r2(canonical),
      surfaceValue: r2(surfaceValue),
      delta,
      pass: Math.abs(delta) <= R1,
    });
  };

  // ── Baseline: the single read path ──
  const canonicalTotals = await getCanonicalProjectTotals(scopedIds);

  // ── Surface: dashboard KPI service ──
  const kpiRows = await getCanonicalFinanceByProjectIds(scopedIds);
  for (const id of scopedIds) {
    const c = canonicalTotals.get(id);
    const k = kpiRows.get(id);
    if (!c || !k) continue;
    const name = nameById.get(id) ?? String(id);
    compare("project", id, name, "recognisedRevenue", "dashboard-kpi", c.recognisedRevenueAllLines, k.recognisedRevenue);
    compare("project", id, name, "realisedCos", "dashboard-kpi", c.realisedCos, k.realisedCost);
  }

  // ── Surface: project_revenue_summary (FYE detail / header KPIs) ──
  const prsRows: Array<{
    projectId: number;
    actualRevenue: string | null;
    actualExpenditure: string | null;
    actualProfit: string | null;
  }> = await db
    .select({
      projectId: projectRevenueSummary.projectId,
      actualRevenue: projectRevenueSummary.actualRevenue,
      actualExpenditure: projectRevenueSummary.actualExpenditure,
      actualProfit: projectRevenueSummary.actualProfit,
    })
    .from(projectRevenueSummary)
    .where(isNull(projectRevenueSummary.effectiveTo));
  const prsByProject = new Map(prsRows.map((r) => [r.projectId, r]));
  for (const id of scopedIds) {
    const c = canonicalTotals.get(id);
    const prs = prsByProject.get(id);
    // A project with no live PRS row renders nothing on PRS surfaces — there
    // is no second value to disagree with. Only a PRESENT row must tie.
    if (!c || !prs) continue;
    const name = nameById.get(id) ?? String(id);
    compare("project", id, name, "realisedRevenue", "prs", c.realisedRevenue, num(prs.actualRevenue));
    compare("project", id, name, "realisedCos", "prs", c.realisedCos, num(prs.actualExpenditure));
    compare("project", id, name, "realisedGp", "prs", c.realisedGp, num(prs.actualProfit));
  }

  // ── Surface: company overview (FY-windowed, active set) ──
  if (!opts.skipCompanyOverview) {
    const { getCompanyOverviewData, getFytdRange } = await import("../services/company-overview-service");
    const overview = await getCompanyOverviewData();
    const snapshot = overview.financeSnapshot;
    const activeIds: number[] = overview.activeProjectIds ?? [];
    if (activeIds.length > 0) {
      const { fyStart, fyEnd } = getFytdRange();
      const fyTotals = await getCanonicalProjectTotals(activeIds, { fyStart, fyEnd });
      let rev = 0;
      let cos = 0;
      for (const t of fyTotals.values()) {
        rev += t.realisedRevenue;
        cos += t.realisedCos;
      }
      compare("company", null, "(company FYTD)", "realisedRevenue", "company-overview", rev, num(snapshot.realisedRevenueFytd));
      compare("company", null, "(company FYTD)", "realisedCos", "company-overview", cos, num(snapshot.realisedCostFytd));
    }
  }

  // ── Surface: F0 golden fixture (independent tracker recompute) ──
  const fixturePath = path.join(process.cwd(), "qa", "fixtures", "golden-trackers-5.json");
  if (existsSync(fixturePath)) {
    try {
      const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
        projects: Array<{
          projectName: string;
          expenditureBreakdown: { totals: { realisedRev: number; realisedCos: number; realisedGp: number } };
        }>;
      };
      const byName = new Map(scoped.map((p) => [normText(p.projectName), p.id]));
      for (const gp of fixture.projects) {
        const id = byName.get(normText(gp.projectName));
        if (id == null) continue;
        const c = canonicalTotals.get(id);
        if (!c) continue;
        compare("project", id, gp.projectName, "realisedRevenue", "golden", c.realisedRevenue, gp.expenditureBreakdown.totals.realisedRev);
        compare("project", id, gp.projectName, "realisedCos", "golden", c.realisedCos, gp.expenditureBreakdown.totals.realisedCos);
      }
    } catch (err) {
      console.warn("[verify:finance] golden fixture unreadable — golden tie skipped:", err instanceof Error ? err.message : String(err));
    }
  }

  const failures = rows.filter((r) => !r.pass);
  return { rows, failures, comparisons: rows.length, pass: failures.length === 0 };
}

function printResult(result: CrossSurfaceResult): void {
  console.log("");
  console.log("Cross-surface finance equality (one read path, R1 tolerance)");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`Comparisons : ${result.comparisons}`);
  console.log(`Failures    : ${result.failures.length}`);
  for (const f of result.failures) {
    console.log(
      `  ✗ ${f.projectName} [${f.metric}] ${f.surface}=${f.surfaceValue} canonical=${f.canonical} Δ=${f.delta}`,
    );
  }
  console.log(result.pass ? "\n✓ One value per metric per project on every surface.\n" : "\n✗ Surfaces disagree — see rows above.\n");
}

const isDirectRun = process.argv[1]?.includes("verify-cross-surface-finance");
if (isDirectRun) {
  runCrossSurfaceFinanceVerification()
    .then((result) => {
      printResult(result);
      process.exit(result.pass ? 0 : 1);
    })
    .catch((err) => {
      console.error("[verify:finance] cross-surface verification FAILED:", err);
      process.exit(1);
    });
}
