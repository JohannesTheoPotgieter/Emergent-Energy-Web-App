/**
 * One read path (§ 3.3.2) — golden-fixture cross-surface proof.
 *
 * Seeds the five F0 golden projects (qa/fixtures/golden-trackers-5.json —
 * the independent tracker recompute) into a REAL PostgreSQL database at
 * line level: category allocations (column J), costed parents, and actuals
 * children with their § 3.2 realisation colours. Then asserts THE invariant:
 * the same metric is ONE value on every surface, and that value ties the
 * golden truth within R1:
 *
 *   1. canonical totals (FinanceLineLevelRepository → aggregator)
 *        == golden expenditureBreakdown.totals (realised REV / COS)
 *   2. dashboard KPI service (recognisedRevenue / realisedCost)
 *        == canonical (consumes the same read path — no parallel math)
 *   3. runCrossSurfaceFinanceVerification (the upgraded verify:finance core)
 *        reports zero failures across all of the above + the golden surface.
 *
 * Non-realised fixture lines are seeded RED/unconfirmed so the § 3.2
 * predicate classifies exactly the fixture's realised set (the fixture's
 * other buckets — out_of_window / future_month relative to its 08/06 as-at —
 * must not drift into "realised" as wall-clock time passes).
 *
 * DB-gated: skips without DATABASE_URL (compile-stage run); executes in the
 * CI quality-gate and local Postgres. Cleans up after itself (names are the
 * exact golden names — required for the golden-surface name match — so the
 * suite also pre-deletes any leftovers from a crashed run).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { inArray } from "drizzle-orm";

// Opt-in only: DB-mutating tests must NOT seed the live dev/prod DB on a normal build. Set RUN_DB_TESTS=1 to run (CI / dedicated DB).
const hasDb = !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === "1";
const d = hasDb ? describe : describe.skip;

interface FixtureLine {
  row: number;
  categoryNumber: number | string | null;
  categoryName: string | null;
  description: string | null;
  actualTotal: number | null;
  invoiceNumber: string | null;
  invoiceRaisedDate: string | null;
  invoiceDateFontColor: string | null;
  bucket: string;
}
interface FixtureProject {
  projectName: string;
  expenditureBreakdown: {
    totals: { realisedRev: number; realisedCos: number; realisedGp: number };
    categories: Array<{ number: number | string; name: string; J: number | null }>;
    lines: FixtureLine[];
  };
}

const R1 = 1;

d("one read path — golden fixture cross-surface equality (PostgreSQL)", () => {
  let db: typeof import("../../../server/db").db;
  let schema: typeof import("@shared/schema");
  let fixtureProjects: FixtureProject[] = [];
  const idByName = new Map<string, number>();

  const goldenNames = (): string[] => fixtureProjects.map((p) => p.projectName);

  const cleanup = async () => {
    if (!db || fixtureProjects.length === 0) return;
    const names = goldenNames();
    await db.delete(schema.projectRevenueSummary).where(inArray(schema.projectRevenueSummary.projectName, names));
    await db.delete(schema.projectInfo).where(inArray(schema.projectInfo.projectName, names));
  };

  beforeAll(async () => {
    const dbModule = await import("../../../server/db");
    await dbModule.initializeDatabase();
    db = dbModule.db;
    schema = await import("@shared/schema");

    const fixture = JSON.parse(
      readFileSync(path.join(process.cwd(), "qa", "fixtures", "golden-trackers-5.json"), "utf8"),
    ) as { projects: FixtureProject[] };
    fixtureProjects = fixture.projects;

    await cleanup(); // leftovers from a crashed previous run

    for (const fp of fixtureProjects) {
      const eb = fp.expenditureBreakdown;
      const [project] = await db.insert(schema.projectInfo).values({ projectName: fp.projectName }).returning();
      idByName.set(fp.projectName, project.id);
      const [run] = await db.insert(schema.smartImportRuns).values({
        projectId: project.id,
        projectName: fp.projectName,
        sourceFileName: `golden-${fp.projectName}.xlsx`,
      }).returning();

      // Column-J allocations per category.
      const allocIdByNumber = new Map<string, number>();
      for (const [index, cat] of eb.categories.entries()) {
        const key = `${cat.number}. ${cat.name}`;
        const [alloc] = await db.insert(schema.categoryRevenueAllocations).values({
          projectId: project.id,
          projectName: fp.projectName,
          categoryNumber: String(cat.number),
          categoryName: cat.name,
          categoryKey: key,
          categorySortOrder: index + 1,
          revenueAllocation: cat.J != null ? String(cat.J) : null,
          importRunId: run.id,
        }).returning();
        allocIdByNumber.set(String(cat.number), alloc.id);
      }

      // Costed parents + one actuals child per fixture line. Non-realised
      // buckets are pinned RED/unconfirmed so the realised set matches the
      // fixture exactly regardless of today's date.
      for (const line of eb.lines) {
        const realised = line.bucket === "realised";
        const fontColor = realised ? "black" : "red";
        const confirmed = realised;
        const catNumber = line.categoryNumber != null ? String(line.categoryNumber) : null;
        const categoryKey =
          catNumber && line.categoryName ? `${catNumber}. ${line.categoryName}` : null;
        const [parent] = await db.insert(schema.normalizedCostLines).values({
          projectId: project.id,
          projectName: fp.projectName,
          costCategory: line.categoryName,
          categoryKey,
          categoryAllocationId: catNumber ? allocIdByNumber.get(catNumber) ?? null : null,
          description: line.description,
          sourceRow: line.row,
          importRunId: run.id,
          invoiceNumber: realised ? line.invoiceNumber : line.invoiceNumber ?? null,
          invoiceDate: line.invoiceRaisedDate,
          invoiceDateFontColor: fontColor,
          invoiceDateConfirmed: confirmed,
        }).returning();
        await db.insert(schema.normalizedCostLineActuals).values({
          costLineId: parent.id,
          projectId: project.id,
          actualNo: 1,
          importRunId: run.id,
          description: line.description,
          actualTotal: line.actualTotal != null ? String(line.actualTotal) : null,
          invoiceNumber: line.invoiceNumber,
          invoiceDate: line.invoiceRaisedDate,
          invoiceDateFontColor: fontColor,
          invoiceDateConfirmed: confirmed,
        });
      }
    }
  }, 300_000);

  afterAll(async () => {
    await cleanup();
  }, 120_000);

  it("canonical totals tie the golden tracker recompute within R1 (all 5 projects)", async () => {
    const { getCanonicalProjectTotals } = await import("../../../server/lib/finance/canonical-project-totals");
    const totals = await getCanonicalProjectTotals([...idByName.values()]);
    for (const fp of fixtureProjects) {
      const t = totals.get(idByName.get(fp.projectName)!)!;
      expect(t, `${fp.projectName} derives`).toBeDefined();
      expect(
        Math.abs(t.realisedRevenue - fp.expenditureBreakdown.totals.realisedRev),
        `${fp.projectName} realisedRevenue ${t.realisedRevenue} vs golden ${fp.expenditureBreakdown.totals.realisedRev}`,
      ).toBeLessThanOrEqual(R1);
      expect(
        Math.abs(t.realisedCos - fp.expenditureBreakdown.totals.realisedCos),
        `${fp.projectName} realisedCos ${t.realisedCos} vs golden ${fp.expenditureBreakdown.totals.realisedCos}`,
      ).toBeLessThanOrEqual(R1);
    }
  }, 120_000);

  it("dashboard KPI surface equals canonical exactly (same read path, no parallel math)", async () => {
    const { getCanonicalProjectTotals } = await import("../../../server/lib/finance/canonical-project-totals");
    const { getCanonicalFinanceByProjectIds } = await import("../../../server/services/canonical-dashboard-kpi-service");
    const ids = [...idByName.values()];
    const [canonical, kpis] = await Promise.all([
      getCanonicalProjectTotals(ids),
      getCanonicalFinanceByProjectIds(ids),
    ]);
    for (const id of ids) {
      expect(kpis.get(id)!.recognisedRevenue).toBeCloseTo(canonical.get(id)!.recognisedRevenueAllLines, 2);
      expect(kpis.get(id)!.realisedCost).toBeCloseTo(canonical.get(id)!.realisedCos, 2);
    }
  }, 120_000);

  it("verify:finance cross-surface core is GREEN: one value per metric, ties golden", async () => {
    const { runCrossSurfaceFinanceVerification } = await import("../../../server/scripts/verify-cross-surface-finance");
    const result = await runCrossSurfaceFinanceVerification({
      projectIds: [...idByName.values()],
      skipCompanyOverview: true, // whole-DB surface; scoped run stays hermetic
    });
    // 5 projects × (2 dashboard-kpi + 3 prs + 2 golden) = 35 comparisons.
    expect(result.comparisons).toBe(35);
    expect(
      result.failures.map((f) => `${f.projectName}/${f.metric}/${f.surface} Δ=${f.delta}`),
    ).toEqual([]);
    expect(result.pass).toBe(true);
  }, 120_000);
});
