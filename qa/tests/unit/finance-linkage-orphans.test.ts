/**
 * Finance-linkage orphan fix — end-to-end regression pins.
 *
 * Reproduces the prod corruption classes (31/42 projects unlinked, ~90% of
 * revenue orphaned) against a REAL PostgreSQL database and proves the
 * remediation backfill converges them:
 *
 *   1. Allocation rotation: re-import soft-closes category_revenue_allocations
 *      and inserts new ids; cost-line FKs dangle on the closed rows → the
 *      shared relink re-points them by category key/name.
 *   2. Parent rotation: the v1 actuals hash embedded the parent's DB id, so a
 *      parent soft-close+re-insert duplicated every child and left the old
 *      child live under the dead parent → the backfill closes superseded
 *      duplicates, re-points unique survivors, and QUARANTINES children with
 *      no live parent (explicit, never silently counted).
 *   3. PRS orphans: the name-keyed upsert left live project_revenue_summary
 *      rows behind for renamed/dead projects, inflating company revenue → the
 *      backfill soft-closes them and recomputes PRS for live projects from the
 *      canonical § 3.3 derivation.
 *   4. Idempotency: a second --execute run performs zero mutations.
 *
 * DB-gated like v2-finance-cashflow-db.test.ts: skips when DATABASE_URL is
 * unset (the compile-stage unit run); executes in the quality-gate and any
 * local Postgres. Hermetic: rows are namespaced by a unique suffix and hard-
 * deleted afterwards.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull, like } from "drizzle-orm";
import { hashActualRow } from "../../../server/lib/import/row-hasher";
import {
  buildAllocationMatchMap,
  resolveLineAllocation,
} from "../../../server/lib/import/allocation-relink";

// Opt-in only: DB-mutating tests must NOT seed the live dev/prod DB on a normal build. Set RUN_DB_TESTS=1 to run (CI / dedicated DB).
const hasDb = !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === "1";
const d = hasDb ? describe : describe.skip;

// ── Pure pins (always run) ────────────────────────────────────────────────

describe("hashActualRow v2 — identity survives parent rotation", () => {
  it("is keyed on the workbook anchor, not the parent DB id", () => {
    const a = hashActualRow({ projectId: 7, parentSourceRow: 42, actualNo: 1, invoiceNumber: "INV-1", invoiceDate: "2026-01-31" });
    const b = hashActualRow({ projectId: 7, parentSourceRow: 42, actualNo: 1, invoiceNumber: "INV-1", invoiceDate: "2026-01-31" });
    expect(a).toBe(b);
  });

  it("changes when the workbook identity changes", () => {
    const base = hashActualRow({ projectId: 7, parentSourceRow: 42, actualNo: 1, invoiceNumber: "INV-1", invoiceDate: "2026-01-31" });
    expect(hashActualRow({ projectId: 7, parentSourceRow: 43, actualNo: 1, invoiceNumber: "INV-1", invoiceDate: "2026-01-31" })).not.toBe(base);
    expect(hashActualRow({ projectId: 7, parentSourceRow: 42, actualNo: 2, invoiceNumber: "INV-1", invoiceDate: "2026-01-31" })).not.toBe(base);
    expect(hashActualRow({ projectId: 8, parentSourceRow: 42, actualNo: 1, invoiceNumber: "INV-1", invoiceDate: "2026-01-31" })).not.toBe(base);
  });
});

describe("allocation match map — category key/name variants resolve", () => {
  const map = buildAllocationMatchMap([
    { id: 11, categoryKey: "1. Panels", categoryName: "Panels", categoryNumber: "1" },
    { id: 12, categoryKey: "2. Inverters", categoryName: "Inverters", categoryNumber: "2" },
  ]);

  it("matches by key, bare name, numbered composite — case/whitespace-insensitive", () => {
    expect(resolveLineAllocation({ categoryKey: "1. Panels", costCategory: null }, map)?.id).toBe(11);
    expect(resolveLineAllocation({ categoryKey: null, costCategory: "Panels" }, map)?.id).toBe(11);
    expect(resolveLineAllocation({ categoryKey: null, costCategory: "  panels  " }, map)?.id).toBe(11);
    expect(resolveLineAllocation({ categoryKey: null, costCategory: "2.  INVERTERS" }, map)?.id).toBe(12);
    expect(resolveLineAllocation({ categoryKey: "1.   panels", costCategory: null }, map)?.id).toBe(11);
  });

  it("returns null (never a guess) for unknown categories", () => {
    expect(resolveLineAllocation({ categoryKey: null, costCategory: "Batteries" }, map)).toBeNull();
  });
});

// ── DB-gated end-to-end remediation pins ──────────────────────────────────

d("finance-linkage remediation backfill (PostgreSQL)", () => {
  const SUFFIX = `lk${Date.now().toString(36)}`;
  const NAME_ALPHA = `LinkTest Alpha ${SUFFIX}`;
  const NAME_GHOST = `LinkTest Ghost ${SUFFIX}`;

  let db: typeof import("../../../server/db").db;
  let schema: typeof import("@shared/schema");
  let runBackfill: typeof import("../../../scripts/backfill-finance-linkage").runFinanceLinkageBackfill;

  let projectAlphaId = 0;
  let projectGhostId = 0;
  let runId = 0;
  let allocV2PanelsId = 0;
  let parentOldId = 0;
  let parentNewId = 0;
  let parentGoneId = 0;
  let lineStaleFkId = 0;
  let orphanDupChildId = 0;
  let liveDupChildId = 0;
  let orphanUniqueChildId = 0;
  let orphanNoParentChildId = 0;
  let ghostPrsId = 0;

  beforeAll(async () => {
    const dbModule = await import("../../../server/db");
    await dbModule.initializeDatabase();
    db = dbModule.db;
    schema = await import("@shared/schema");
    ({ runFinanceLinkageBackfill: runBackfill } = await import("../../../scripts/backfill-finance-linkage"));

    const past = new Date(Date.now() - 60_000);

    // Projects: Alpha (live) + Ghost (soft-deleted → its PRS row is an orphan).
    const [alpha] = await db.insert(schema.projectInfo).values({ projectName: NAME_ALPHA }).returning();
    const [ghost] = await db.insert(schema.projectInfo).values({ projectName: NAME_GHOST, deletedAt: past }).returning();
    projectAlphaId = alpha.id;
    projectGhostId = ghost.id;

    const [run] = await db.insert(schema.smartImportRuns).values({
      projectId: projectAlphaId,
      projectName: NAME_ALPHA,
      sourceFileName: `linkage-test-${SUFFIX}.xlsx`,
    }).returning();
    runId = run.id;

    // Allocations v1 (rotated away) and v2 (live) — new ids, same key.
    const [allocV1] = await db.insert(schema.categoryRevenueAllocations).values({
      projectId: projectAlphaId, projectName: NAME_ALPHA,
      categoryNumber: "1", categoryName: "Panels", categoryKey: "1. Panels",
      categorySortOrder: 1, revenueAllocation: "1000.00",
      effectiveFrom: past, effectiveTo: past,
    }).returning();
    const [allocV2] = await db.insert(schema.categoryRevenueAllocations).values({
      projectId: projectAlphaId, projectName: NAME_ALPHA,
      categoryNumber: "1", categoryName: "Panels", categoryKey: "1. Panels",
      categorySortOrder: 1, revenueAllocation: "1000.00",
    }).returning();
    allocV2PanelsId = allocV2.id;

    // Cost lines. Parent rotation: old (soft-closed) + its live successor on
    // the same workbook anchor (sourceRow 10); a second closed parent with NO
    // successor (sourceRow 99); one live line with a STALE allocation FK.
    const [pOld] = await db.insert(schema.normalizedCostLines).values({
      projectId: projectAlphaId, projectName: NAME_ALPHA, costCategory: "Panels",
      categoryKey: "1. Panels", categoryAllocationId: allocV1.id,
      description: "PV modules", sourceRow: 10, importRunId: runId,
      invoiceNumber: "INV-A", invoiceDate: "2026-01-15", invoiceDateFontColor: "black",
      effectiveFrom: past, effectiveTo: past,
    }).returning();
    parentOldId = pOld.id;
    const [pNew] = await db.insert(schema.normalizedCostLines).values({
      projectId: projectAlphaId, projectName: NAME_ALPHA, costCategory: "Panels",
      categoryKey: "1. Panels", categoryAllocationId: allocV1.id, // stale FK → relink target
      description: "PV modules", sourceRow: 10, importRunId: runId,
      invoiceNumber: "INV-A", invoiceDate: "2026-01-15", invoiceDateFontColor: "black",
    }).returning();
    parentNewId = pNew.id;
    lineStaleFkId = pNew.id;
    const [pGone] = await db.insert(schema.normalizedCostLines).values({
      projectId: projectAlphaId, projectName: NAME_ALPHA, costCategory: "Panels",
      description: "Removed BOQ row", sourceRow: 99, importRunId: runId,
      effectiveFrom: past, effectiveTo: past,
    }).returning();
    parentGoneId = pGone.id;

    // Actuals children:
    //  - orphan DUPLICATE under the dead parent + its live re-asserted twin
    //    under the successor (the double-count pair);
    //  - orphan UNIQUE child under the dead parent (no twin) → re-point;
    //  - orphan child under the no-successor parent → quarantine.
    const [orphanDup] = await db.insert(schema.normalizedCostLineActuals).values({
      costLineId: parentOldId, projectId: projectAlphaId, actualNo: 1, importRunId: runId,
      actualTotal: "600.00", invoiceNumber: "INV-A", invoiceDate: "2026-01-15",
      invoiceDateFontColor: "black", rowHash: `v1-legacy-${SUFFIX}-dup`,
    }).returning();
    orphanDupChildId = orphanDup.id;
    const [liveDup] = await db.insert(schema.normalizedCostLineActuals).values({
      costLineId: parentNewId, projectId: projectAlphaId, actualNo: 1, importRunId: runId,
      actualTotal: "600.00", invoiceNumber: "INV-A", invoiceDate: "2026-01-15",
      invoiceDateFontColor: "black", rowHash: `v1-legacy-${SUFFIX}-live`,
    }).returning();
    liveDupChildId = liveDup.id;
    const [orphanUnique] = await db.insert(schema.normalizedCostLineActuals).values({
      costLineId: parentOldId, projectId: projectAlphaId, actualNo: 2, importRunId: runId,
      actualTotal: "400.00", invoiceNumber: "INV-B", invoiceDate: "2026-02-15",
      invoiceDateFontColor: "black", rowHash: `v1-legacy-${SUFFIX}-uniq`,
    }).returning();
    orphanUniqueChildId = orphanUnique.id;
    const [orphanNoParent] = await db.insert(schema.normalizedCostLineActuals).values({
      costLineId: parentGoneId, projectId: projectAlphaId, actualNo: 1, importRunId: runId,
      actualTotal: "123456.00", invoiceNumber: "INV-GONE", invoiceDate: "2026-03-15",
      rowHash: `v1-legacy-${SUFFIX}-gone`,
    }).returning();
    orphanNoParentChildId = orphanNoParent.id;

    // Orphan PRS row for the dead project — the revenue-inflation class.
    const [ghostPrs] = await db.insert(schema.projectRevenueSummary).values({
      projectName: NAME_GHOST, projectId: projectGhostId,
      actualRevenue: "999999.00", plannedRevenue: "999999.00",
    }).returning();
    ghostPrsId = ghostPrs.id;
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.projectRevenueSummary).where(like(schema.projectRevenueSummary.projectName, `LinkTest %${SUFFIX}`));
    await db.delete(schema.auditEvents).where(eq(schema.auditEvents.entityType, "finance_linkage"));
    // projectInfo cascade removes cost lines, actuals, allocations, runs.
    await db.delete(schema.projectInfo).where(like(schema.projectInfo.projectName, `LinkTest %${SUFFIX}`));
  }, 60_000);

  it("dry-run inventories the corruption without mutating anything", async () => {
    const report = await runBackfill({ execute: false, projectIds: [projectAlphaId], reportDir: "/tmp/linkage-test-dry" });
    expect(report.mode).toBe("dry-run");
    expect(report.before.orphanActuals).toBe(3);
    expect(report.before.prsOrphanRows).toBeGreaterThanOrEqual(1);
    expect(report.mutationCount).toBeGreaterThan(0);

    // Nothing changed: stale FK still stale, orphans still live.
    const [line] = await db.select().from(schema.normalizedCostLines).where(eq(schema.normalizedCostLines.id, lineStaleFkId));
    expect(line.categoryAllocationId).not.toBe(allocV2PanelsId);
    const [ghostPrs] = await db.select().from(schema.projectRevenueSummary).where(eq(schema.projectRevenueSummary.id, ghostPrsId));
    expect(ghostPrs.effectiveTo).toBeNull();
  }, 60_000);

  it("--execute converges: relinks, dedupes, re-points, quarantines, recomputes PRS", async () => {
    const report = await runBackfill({ execute: true, projectIds: [projectAlphaId], reportDir: "/tmp/linkage-test-exec" });
    expect(report.mode).toBe("execute");

    // 1. Stale allocation FK re-pointed at the live v2 allocation.
    const [line] = await db.select().from(schema.normalizedCostLines).where(eq(schema.normalizedCostLines.id, lineStaleFkId));
    expect(line.categoryAllocationId).toBe(allocV2PanelsId);

    // 2a. Superseded duplicate child closed; its live twin untouched.
    const [dup] = await db.select().from(schema.normalizedCostLineActuals).where(eq(schema.normalizedCostLineActuals.id, orphanDupChildId));
    expect(dup.effectiveTo).not.toBeNull();
    const [twin] = await db.select().from(schema.normalizedCostLineActuals).where(eq(schema.normalizedCostLineActuals.id, liveDupChildId));
    expect(twin.effectiveTo).toBeNull();

    // 2b. Unique orphan re-pointed to the successor parent, hash upgraded to v2.
    const [uniq] = await db.select().from(schema.normalizedCostLineActuals).where(eq(schema.normalizedCostLineActuals.id, orphanUniqueChildId));
    expect(uniq.effectiveTo).toBeNull();
    expect(uniq.costLineId).toBe(parentNewId);
    expect(uniq.rowHash).toBe(hashActualRow({
      projectId: projectAlphaId, parentSourceRow: 10, actualNo: 2,
      invoiceNumber: "INV-B", invoiceDate: "2026-02-15",
    }));

    // 2c. No-successor orphan explicitly quarantined (soft-closed, reported).
    const [gone] = await db.select().from(schema.normalizedCostLineActuals).where(eq(schema.normalizedCostLineActuals.id, orphanNoParentChildId));
    expect(gone.effectiveTo).not.toBeNull();
    const alphaRow = report.projects.find((p) => p.projectId === projectAlphaId)!;
    expect(alphaRow.orphanActualsClosedDuplicate).toBe(1);
    expect(alphaRow.orphanActualsRepointed).toBe(1);
    expect(alphaRow.orphanActualsQuarantined).toBe(1);
    expect(alphaRow.linksAndDerives).toBe(true);

    // 3. PRS recomputed from the canonical § 3.3 derivation. Live lines after
    // remediation: INV-A 600 (realised) + INV-B 400 (realised), category
    // allocation J = 1000 → revenue = (600/1000)*1000 + (400/1000)*1000 = 1000.
    // The quarantined 123456 row is GONE from the totals — it no longer
    // inflates revenue or COS.
    const [prs] = await db.select().from(schema.projectRevenueSummary).where(and(
      eq(schema.projectRevenueSummary.projectId, projectAlphaId),
      isNull(schema.projectRevenueSummary.effectiveTo),
    ));
    expect(Number(prs.actualRevenue)).toBeCloseTo(1000, 2);
    expect(Number(prs.actualExpenditure)).toBeCloseTo(1000, 2);

    // 4. Orphan PRS row for the dead project soft-closed and reported.
    const [ghostPrs] = await db.select().from(schema.projectRevenueSummary).where(eq(schema.projectRevenueSummary.id, ghostPrsId));
    expect(ghostPrs.effectiveTo).not.toBeNull();
    expect(report.prsOrphansQuarantined.some((o) => o.id === ghostPrsId)).toBe(true);
    expect(report.after.orphanActuals).toBe(0);
  }, 60_000);

  it("is idempotent — a second --execute run performs zero mutations", async () => {
    const report = await runBackfill({ execute: true, projectIds: [projectAlphaId], reportDir: "/tmp/linkage-test-idem" });
    expect(report.mutationCount).toBe(0);
    expect(report.after.orphanActuals).toBe(0);
    expect(report.after.unlinkedCostLines).toBe(0);
  }, 60_000);
});
