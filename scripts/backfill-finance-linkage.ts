#!/usr/bin/env tsx
/**
 * Finance-linkage remediation backfill — re-links the prod rows orphaned by
 * the import-rotation defects fixed in the same change set, and quarantines
 * what genuinely cannot be attributed so it stops inflating revenue.
 *
 * What it remediates (all per LIVE project, § 3.1 snapshot-guarded):
 *   1. Cost lines whose `category_allocation_id` is NULL or dangles on a
 *      soft-closed allocation → re-pointed at the live allocation via the
 *      same shared matcher every commit path now uses
 *      (server/lib/import/allocation-relink.ts). Unresolvable lines are
 *      flagged `noRevenueLinked` — explicit, never silent.
 *   2. Actuals children whose parent cost line is soft-closed/deleted
 *      (the v1 parent-id-keyed hash duplicated them on every parent
 *      rotation):
 *        - a live equivalent exists under the successor parent
 *            → soft-close the orphan (superseded duplicate; this is the
 *              double-counted COS/revenue);
 *        - no equivalent, but the successor parent resolves
 *            → re-point `cost_line_id` (+ v2 row hash) to the successor;
 *        - no successor parent at all
 *            → QUARANTINE: soft-close with the reason recorded in the
 *              report. Temporal history preserves every row; nothing is
 *              hard-deleted.
 *   3. `project_revenue_summary`: recomputed for every live project from
 *      the canonical § 3.3 line-level derivation (single read path —
 *      deriveFinanceLinesFromRows), upserted rename-safe by projectId; live
 *      PRS rows whose project is dead/missing are soft-closed (the orphan
 *      rows behind the inflated company total).
 *
 * Safety:
 *   - DRY-RUN BY DEFAULT. All mutations run inside one transaction; without
 *     `--execute` the transaction is rolled back after counting, so the
 *     report shows exactly what WOULD change.
 *   - Idempotent: a second `--execute` run performs zero mutations.
 *   - Audited: one `audit_events` row (source SYSTEM) summarising counts.
 *   - Parity-checked: when qa/fixtures/golden-trackers-5.json is present,
 *     the post-fix canonical realised REV/COS for the five golden projects
 *     is compared against the embedded dashboard oracle within R1.
 *
 * Run:   npm run remediate:finance-linkage            (dry-run)
 *        npm run remediate:finance-linkage -- --execute
 * Report: qa/reports/finance-linkage-remediation.json + .csv
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq, inArray, isNull, isNotNull, or } from "drizzle-orm";
import {
  auditEvents,
  categoryRevenueAllocations,
  normalizedCostLineActuals,
  normalizedCostLines,
  projectInfo,
  projectRevenueSummary,
} from "@shared/schema";
import { db, getDbMode, initializeDatabase } from "../server/db";
import {
  deriveFinanceLinesFromRows,
  type FinanceLine,
} from "../server/repositories/finance-line-level-repository";
import { aggregateCanonicalProjectTotals } from "../server/lib/finance/canonical-project-totals";
import { relinkCategoryAllocationsForProject } from "../server/lib/import/allocation-relink";
import { upsertProjectRevenueSummary } from "../server/lib/import/derivative-materializer";
import { hashActualRow } from "../server/lib/import/row-hasher";

const R1 = 1;
const REPORT_DIR = path.join(process.cwd(), "qa", "reports");
const FIXTURE_PATH = path.join(process.cwd(), "qa", "fixtures", "golden-trackers-5.json");

type Tx = typeof db;

const num = (v: unknown): number => {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number): number => Math.round(n * 100) / 100;
const normText = (v: unknown): string => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export interface ProjectRemediationRow {
  projectId: number;
  projectName: string;
  liveCostLines: number;
  liveAllocations: number;
  relinked: number;
  unresolvedFlagged: number;
  orphanActualsFound: number;
  orphanActualsClosedDuplicate: number;
  orphanActualsRepointed: number;
  orphanActualsQuarantined: number;
  derivedRealisedRevenue: number;
  derivedRealisedCos: number;
  derivedPlannedRevenue: number;
  derivedPlannedCos: number;
  prsActualRevenueBefore: number | null;
  prsActualRevenueAfter: number;
  linksAndDerives: boolean;
}

export interface GoldenParityRow {
  projectName: string;
  surface: "realisedRev" | "realisedCos";
  derived: number;
  oracle: number;
  delta: number;
  withinR1: boolean;
}

export interface BackfillReport {
  generatedAt: string;
  mode: "dry-run" | "execute";
  liveProjects: number;
  projectsLinkedAndDeriving: number;
  before: { prsLiveRows: number; prsOrphanRows: number; prsActualRevenueTotal: number; orphanActuals: number; unlinkedCostLines: number };
  after: { prsLiveRows: number; prsOrphanRows: number; prsActualRevenueTotal: number; orphanActuals: number; unlinkedCostLines: number };
  prsOrphansQuarantined: Array<{ id: number; projectName: string; projectId: number; actualRevenue: number }>;
  projects: ProjectRemediationRow[];
  goldenParity: GoldenParityRow[] | null;
  mutationCount: number;
}

/** Fetch the three § 3.3 input row sets for one project (live rows only). */
async function fetchDerivationRows(tx: Tx, projectId: number) {
  const [actualsRows, parentRows, allocationRows] = await Promise.all([
    tx.select({
      id: normalizedCostLineActuals.id,
      costLineId: normalizedCostLineActuals.costLineId,
      projectId: normalizedCostLineActuals.projectId,
      actualTotal: normalizedCostLineActuals.actualTotal,
      poNumber: normalizedCostLineActuals.poNumber,
      invoiceNumber: normalizedCostLineActuals.invoiceNumber,
      invoiceDate: normalizedCostLineActuals.invoiceDate,
      invoiceDateFontColor: normalizedCostLineActuals.invoiceDateFontColor,
      invoiceDateConfirmed: normalizedCostLineActuals.invoiceDateConfirmed,
      financePaymentDate: normalizedCostLineActuals.financePaymentDate,
      description: normalizedCostLineActuals.description,
      qty: normalizedCostLineActuals.qty,
      rate: normalizedCostLineActuals.rate,
      revenueRecognitionAmount: normalizedCostLineActuals.revenueRecognitionAmount,
    }).from(normalizedCostLineActuals).where(and(
      eq(normalizedCostLineActuals.projectId, projectId),
      isNull(normalizedCostLineActuals.effectiveTo),
      isNull(normalizedCostLineActuals.deletedAt),
    )),
    tx.select({
      id: normalizedCostLines.id,
      projectId: normalizedCostLines.projectId,
      categoryAllocationId: normalizedCostLines.categoryAllocationId,
      categoryKey: normalizedCostLines.categoryKey,
      costCategory: normalizedCostLines.costCategory,
      description: normalizedCostLines.description,
      budgetTotal: normalizedCostLines.budgetTotal,
      forecastPaymentDate: normalizedCostLines.forecastPaymentDate,
      paidDate: normalizedCostLines.paidDate,
      paidDateConfirmed: normalizedCostLines.paidDateConfirmed,
      amountExVat: normalizedCostLines.amountExVat,
      invoiceDate: normalizedCostLines.invoiceDate,
      invoiceNumber: normalizedCostLines.invoiceNumber,
      poNumber: normalizedCostLines.poNumber,
      invoiceDateFontColor: normalizedCostLines.invoiceDateFontColor,
      invoiceDateConfirmed: normalizedCostLines.invoiceDateConfirmed,
      cosStatusOverride: normalizedCostLines.cosStatusOverride,
      cosRealised: normalizedCostLines.cosRealised,
      revenueRecognitionAmount: normalizedCostLines.revenueRecognitionAmount,
      recognitionDateOverride: normalizedCostLines.recognitionDateOverride,
    }).from(normalizedCostLines).where(and(
      eq(normalizedCostLines.projectId, projectId),
      isNull(normalizedCostLines.effectiveTo),
      isNull(normalizedCostLines.deletedAt),
    )),
    tx.select({
      id: categoryRevenueAllocations.id,
      projectId: categoryRevenueAllocations.projectId,
      categoryKey: categoryRevenueAllocations.categoryKey,
      categoryName: categoryRevenueAllocations.categoryName,
      categoryNumber: categoryRevenueAllocations.categoryNumber,
      revenueAllocation: categoryRevenueAllocations.revenueAllocation,
      budgetTotal: categoryRevenueAllocations.budgetTotal,
    }).from(categoryRevenueAllocations).where(and(
      eq(categoryRevenueAllocations.projectId, projectId),
      isNull(categoryRevenueAllocations.effectiveTo),
    )),
  ]);
  return { actualsRows, parentRows, allocationRows };
}

function deriveProject(rows: Awaited<ReturnType<typeof fetchDerivationRows>>): FinanceLine[] {
  // NOTE: no synthesizeActualsForParents here — PRS actuals must reflect the
  // real actuals grain; budget-only parents contribute via the planned side.
  return deriveFinanceLinesFromRows(rows.actualsRows, rows.parentRows, rows.allocationRows);
}

interface OrphanActualRow {
  id: number;
  costLineId: number;
  actualNo: number;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  actualTotal: string | null;
  parentSourceRow: number | null;
  parentRowHash: string | null;
}

/** Live actuals children whose parent cost line is soft-closed or deleted. */
async function findOrphanActuals(tx: Tx, projectId: number): Promise<OrphanActualRow[]> {
  const rows = await tx
    .select({
      id: normalizedCostLineActuals.id,
      costLineId: normalizedCostLineActuals.costLineId,
      actualNo: normalizedCostLineActuals.actualNo,
      invoiceNumber: normalizedCostLineActuals.invoiceNumber,
      invoiceDate: normalizedCostLineActuals.invoiceDate,
      actualTotal: normalizedCostLineActuals.actualTotal,
      parentSourceRow: normalizedCostLines.sourceRow,
      parentRowHash: normalizedCostLines.rowHash,
    })
    .from(normalizedCostLineActuals)
    .innerJoin(normalizedCostLines, eq(normalizedCostLineActuals.costLineId, normalizedCostLines.id))
    .where(and(
      eq(normalizedCostLineActuals.projectId, projectId),
      isNull(normalizedCostLineActuals.effectiveTo),
      isNull(normalizedCostLineActuals.deletedAt),
      or(isNotNull(normalizedCostLines.effectiveTo), isNotNull(normalizedCostLines.deletedAt)),
    ));
  return rows as OrphanActualRow[];
}

export interface RunOptions {
  execute: boolean;
  reportDir?: string;
  /** Restrict to specific projectIds (test hook). Default: all live projects. */
  projectIds?: number[];
}

class DryRunRollback extends Error {
  report: BackfillReport;
  constructor(report: BackfillReport) {
    super("dry-run rollback");
    this.report = report;
  }
}

export async function runFinanceLinkageBackfill(opts: RunOptions): Promise<BackfillReport> {
  await initializeDatabase();
  if (getDbMode() !== "postgres") {
    throw new Error(
      "finance-linkage backfill requires the PostgreSQL database (set DATABASE_URL); " +
        "the SQLite dev fallback has no prod data to remediate.",
    );
  }

  const buildAndRemediate = async (tx: Tx): Promise<BackfillReport> => {
    const now = new Date();
    let mutationCount = 0;

    const liveProjects: Array<{ id: number; projectName: string }> = await tx
      .select({ id: projectInfo.id, projectName: projectInfo.projectName })
      .from(projectInfo)
      .where(isNull(projectInfo.deletedAt));
    const scoped = opts.projectIds
      ? liveProjects.filter((p) => opts.projectIds!.includes(p.id))
      : liveProjects;
    const liveIds = new Set(liveProjects.map((p) => p.id));

    // ── BEFORE inventory ──
    const prsLiveBefore: Array<{ id: number; projectId: number; projectName: string; actualRevenue: string | null }> = await tx
      .select({
        id: projectRevenueSummary.id,
        projectId: projectRevenueSummary.projectId,
        projectName: projectRevenueSummary.projectName,
        actualRevenue: projectRevenueSummary.actualRevenue,
      })
      .from(projectRevenueSummary)
      .where(isNull(projectRevenueSummary.effectiveTo));
    const prsOrphansBefore = prsLiveBefore.filter((r) => !liveIds.has(r.projectId));
    const sumPrs = (rows: Array<{ actualRevenue: string | null }>) =>
      r2(rows.reduce((a, r) => a + num(r.actualRevenue), 0));

    // Scoped to the projects under remediation so the counters (and the
    // idempotency contract "after run, zero") are meaningful per run even on
    // a shared database.
    const scopedIds = scoped.map((p) => p.id);
    const countUnlinked = async (): Promise<number> => {
      if (scopedIds.length === 0) return 0;
      const liveAllocIds = (
        (await tx
          .select({ id: categoryRevenueAllocations.id })
          .from(categoryRevenueAllocations)
          .where(and(
            inArray(categoryRevenueAllocations.projectId, scopedIds),
            isNull(categoryRevenueAllocations.effectiveTo),
          ))) as Array<{ id: number }>
      ).map((r) => r.id);
      const lines: Array<{ allocId: number | null }> = await tx
        .select({ allocId: normalizedCostLines.categoryAllocationId })
        .from(normalizedCostLines)
        .where(and(
          inArray(normalizedCostLines.projectId, scopedIds),
          isNull(normalizedCostLines.effectiveTo),
          isNull(normalizedCostLines.deletedAt),
        ));
      const liveAllocSet = new Set(liveAllocIds);
      return lines.filter((l) => l.allocId == null || !liveAllocSet.has(l.allocId)).length;
    };
    const countOrphanActuals = async (): Promise<number> => {
      let total = 0;
      for (const p of scoped) total += (await findOrphanActuals(tx, p.id)).length;
      return total;
    };

    const before = {
      prsLiveRows: prsLiveBefore.length,
      prsOrphanRows: prsOrphansBefore.length,
      prsActualRevenueTotal: sumPrs(prsLiveBefore),
      orphanActuals: await countOrphanActuals(),
      unlinkedCostLines: await countUnlinked(),
    };
    const prsBeforeByProjectId = new Map(prsLiveBefore.map((r) => [r.projectId, num(r.actualRevenue)]));

    // ── Remediation per live project ──
    const projects: ProjectRemediationRow[] = [];
    for (const p of scoped) {
      // 1. Allocation relink (shared S10 implementation).
      const relink = await relinkCategoryAllocationsForProject(tx, p.id);
      mutationCount += relink.relinked + relink.flagged;

      // 2. Orphan actuals.
      const orphans = await findOrphanActuals(tx, p.id);
      let closedDup = 0;
      let repointed = 0;
      let quarantined = 0;
      for (const orphan of orphans) {
        // Successor parent: live row on the same workbook anchor, falling
        // back to the dead parent's row hash (rename of the anchor row).
        const successorCandidates: Array<{ id: number; sourceRow: number | null }> = await tx
          .select({ id: normalizedCostLines.id, sourceRow: normalizedCostLines.sourceRow })
          .from(normalizedCostLines)
          .where(and(
            eq(normalizedCostLines.projectId, p.id),
            isNull(normalizedCostLines.effectiveTo),
            isNull(normalizedCostLines.deletedAt),
            orphan.parentSourceRow != null
              ? eq(normalizedCostLines.sourceRow, orphan.parentSourceRow)
              : eq(normalizedCostLines.rowHash, orphan.parentRowHash ?? ""),
          ))
          .limit(1);
        const successor = successorCandidates[0];

        if (successor) {
          const [equivalent] = await tx
            .select({ id: normalizedCostLineActuals.id })
            .from(normalizedCostLineActuals)
            .where(and(
              eq(normalizedCostLineActuals.costLineId, successor.id),
              eq(normalizedCostLineActuals.actualNo, orphan.actualNo),
              isNull(normalizedCostLineActuals.effectiveTo),
              isNull(normalizedCostLineActuals.deletedAt),
            ))
            .limit(1);
          if (equivalent) {
            await tx
              .update(normalizedCostLineActuals)
              .set({ effectiveTo: now })
              .where(eq(normalizedCostLineActuals.id, orphan.id));
            closedDup++;
          } else {
            await tx
              .update(normalizedCostLineActuals)
              .set({
                costLineId: successor.id,
                rowHash: hashActualRow({
                  projectId: p.id,
                  parentSourceRow: successor.sourceRow ?? orphan.parentSourceRow ?? 0,
                  actualNo: orphan.actualNo,
                  invoiceNumber: orphan.invoiceNumber,
                  invoiceDate: orphan.invoiceDate,
                }),
              })
              .where(eq(normalizedCostLineActuals.id, orphan.id));
            repointed++;
          }
        } else {
          // No live parent anywhere on the anchor — explicitly quarantine.
          await tx
            .update(normalizedCostLineActuals)
            .set({ effectiveTo: now })
            .where(eq(normalizedCostLineActuals.id, orphan.id));
          quarantined++;
        }
      }
      mutationCount += closedDup + repointed + quarantined;

      // 3. Canonical § 3.3 derivation → PRS refresh (rename-safe upsert).
      const rows = await fetchDerivationRows(tx, p.id);
      const lines = deriveProject(rows);
      // Same aggregation every surface consumes (one read path, § 3.3.2) —
      // the backfill and the import-time PRS materializer agree by
      // construction because both call aggregateCanonicalProjectTotals.
      const canonical = aggregateCanonicalProjectTotals(lines, [p.id]).get(p.id)!;
      const realisedRev = canonical.realisedRevenue;
      const realisedCos = canonical.realisedCos;
      const plannedRev = canonical.plannedRevenue;
      const plannedCos = canonical.plannedCos;

      const vals: Record<string, string | null> = {
        actualRevenue: String(realisedRev),
        actualExpenditure: String(realisedCos),
        actualProfit: String(r2(realisedRev - realisedCos)),
        actualMargin: realisedRev !== 0 ? String(r2((realisedRev - realisedCos) / realisedRev)) : null,
        plannedRevenue: String(plannedRev),
        plannedExpenditure: String(plannedCos),
        plannedProfit: String(r2(plannedRev - plannedCos)),
        plannedMargin: plannedRev !== 0 ? String(r2((plannedRev - plannedCos) / plannedRev)) : null,
      };
      // Idempotency: skip the upsert when the live row already carries
      // exactly these canonical values under the right project + name.
      const [currentPrs] = await tx
        .select()
        .from(projectRevenueSummary)
        .where(and(
          eq(projectRevenueSummary.projectId, p.id),
          eq(projectRevenueSummary.projectName, p.projectName),
          isNull(projectRevenueSummary.effectiveTo),
        ))
        .limit(1);
      const prsUnchanged =
        !!currentPrs &&
        (Object.keys(vals) as Array<keyof typeof vals>).every(
          (k) => num((currentPrs as Record<string, unknown>)[k]) === num(vals[k]),
        );
      if (!prsUnchanged) {
        await upsertProjectRevenueSummary(tx, {
          projectId: p.id,
          projectName: p.projectName,
          vals,
          runId: null,
          commitTimestamp: now,
        });
        mutationCount += 1;
      }

      const liveLineCount = rows.parentRows.length;
      projects.push({
        projectId: p.id,
        projectName: p.projectName,
        liveCostLines: liveLineCount,
        liveAllocations: relink.allocationCount,
        relinked: relink.relinked,
        unresolvedFlagged: relink.flagged,
        orphanActualsFound: orphans.length,
        orphanActualsClosedDuplicate: closedDup,
        orphanActualsRepointed: repointed,
        orphanActualsQuarantined: quarantined,
        derivedRealisedRevenue: realisedRev,
        derivedRealisedCos: realisedCos,
        derivedPlannedRevenue: plannedRev,
        derivedPlannedCos: plannedCos,
        prsActualRevenueBefore: prsBeforeByProjectId.get(p.id) ?? null,
        prsActualRevenueAfter: realisedRev,
        // "Links and derives": every § 3.3 input present — at least one live
        // allocation, and no line stuck on an unresolved allocation.
        linksAndDerives: relink.allocationCount > 0 && relink.unresolved === 0,
      });
    }

    // 4. Quarantine orphan PRS rows (project dead or missing entirely).
    const prsOrphansQuarantined: BackfillReport["prsOrphansQuarantined"] = [];
    for (const orphan of prsOrphansBefore) {
      await tx
        .update(projectRevenueSummary)
        .set({ effectiveTo: now })
        .where(and(eq(projectRevenueSummary.id, orphan.id), isNull(projectRevenueSummary.effectiveTo)));
      prsOrphansQuarantined.push({
        id: orphan.id,
        projectName: orphan.projectName,
        projectId: orphan.projectId,
        actualRevenue: num(orphan.actualRevenue),
      });
      mutationCount += 1;
    }

    // ── AFTER inventory ──
    const prsLiveAfter: Array<{ projectId: number; actualRevenue: string | null }> = await tx
      .select({
        projectId: projectRevenueSummary.projectId,
        actualRevenue: projectRevenueSummary.actualRevenue,
      })
      .from(projectRevenueSummary)
      .where(isNull(projectRevenueSummary.effectiveTo));
    const after = {
      prsLiveRows: prsLiveAfter.length,
      prsOrphanRows: prsLiveAfter.filter((r) => !liveIds.has(r.projectId)).length,
      prsActualRevenueTotal: sumPrs(prsLiveAfter),
      orphanActuals: await countOrphanActuals(),
      unlinkedCostLines: await countUnlinked(),
    };

    // ── Golden parity (when the F0 fixture is committed) ──
    let goldenParity: GoldenParityRow[] | null = null;
    if (existsSync(FIXTURE_PATH)) {
      try {
        const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
          projects: Array<{ projectName: string; oracle: { rev: number; cos: number } }>;
        };
        goldenParity = [];
        for (const fp of fixture.projects) {
          const match = projects.find((p) => normText(p.projectName) === normText(fp.projectName));
          if (!match) continue;
          goldenParity.push({
            projectName: fp.projectName,
            surface: "realisedRev",
            derived: match.derivedRealisedRevenue,
            oracle: fp.oracle.rev,
            delta: r2(match.derivedRealisedRevenue - fp.oracle.rev),
            withinR1: Math.abs(match.derivedRealisedRevenue - fp.oracle.rev) <= R1,
          });
          goldenParity.push({
            projectName: fp.projectName,
            surface: "realisedCos",
            derived: match.derivedRealisedCos,
            oracle: fp.oracle.cos,
            delta: r2(match.derivedRealisedCos - fp.oracle.cos),
            withinR1: Math.abs(match.derivedRealisedCos - fp.oracle.cos) <= R1,
          });
        }
      } catch (err) {
        console.warn("[backfill-finance-linkage] golden fixture unreadable — parity skipped:", err instanceof Error ? err.message : String(err));
      }
    }

    // 5. Audit trail (one summary event; SYSTEM source).
    await tx.insert(auditEvents).values({
      actorRole: "SYSTEM",
      userName: "scripts/backfill-finance-linkage",
      source: "SYSTEM",
      entityType: "finance_linkage",
      entityId: null,
      action: opts.execute ? "backfill_remediation_executed" : "backfill_remediation_dry_run",
      changesJson: {
        before,
        after,
        mutationCount,
        prsOrphansQuarantined: prsOrphansQuarantined.length,
        projects: projects.length,
      },
    });

    return {
      generatedAt: now.toISOString(),
      mode: opts.execute ? "execute" : "dry-run",
      liveProjects: scoped.length,
      projectsLinkedAndDeriving: projects.filter((p) => p.linksAndDerives).length,
      before,
      after,
      prsOrphansQuarantined,
      projects,
      goldenParity,
      mutationCount,
    };
  };

  let report: BackfillReport;
  try {
    report = await db.transaction(async (tx: Tx) => {
      const r = await buildAndRemediate(tx);
      if (!opts.execute) throw new DryRunRollback(r);
      return r;
    });
  } catch (err) {
    if (err instanceof DryRunRollback) report = err.report;
    else throw err;
  }

  const dir = opts.reportDir ?? REPORT_DIR;
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "finance-linkage-remediation.json"), JSON.stringify(report, null, 2) + "\n");
  const csvLines = [
    "projectId,projectName,liveCostLines,liveAllocations,relinked,unresolvedFlagged,orphanActualsFound,closedDuplicate,repointed,quarantined,derivedRealisedRevenue,derivedRealisedCos,derivedPlannedRevenue,derivedPlannedCos,prsBefore,prsAfter,linksAndDerives",
    ...report.projects.map((p) =>
      [
        p.projectId,
        JSON.stringify(p.projectName),
        p.liveCostLines,
        p.liveAllocations,
        p.relinked,
        p.unresolvedFlagged,
        p.orphanActualsFound,
        p.orphanActualsClosedDuplicate,
        p.orphanActualsRepointed,
        p.orphanActualsQuarantined,
        p.derivedRealisedRevenue,
        p.derivedRealisedCos,
        p.derivedPlannedRevenue,
        p.derivedPlannedCos,
        p.prsActualRevenueBefore ?? "",
        p.prsActualRevenueAfter,
        p.linksAndDerives,
      ].join(","),
    ),
  ];
  writeFileSync(path.join(dir, "finance-linkage-remediation.csv"), csvLines.join("\n") + "\n");

  return report;
}

function printSummary(report: BackfillReport): void {
  console.log("");
  console.log(`Finance-linkage remediation — ${report.mode.toUpperCase()}`);
  console.log("─────────────────────────────────────────────");
  console.log(`Live projects                : ${report.liveProjects}`);
  console.log(`Linked + deriving (§ 3.3)    : ${report.projectsLinkedAndDeriving}/${report.liveProjects}`);
  console.log(`PRS live rows                : ${report.before.prsLiveRows} → ${report.after.prsLiveRows}`);
  console.log(`PRS orphan rows              : ${report.before.prsOrphanRows} → ${report.after.prsOrphanRows}`);
  console.log(`PRS actualRevenue total      : R ${report.before.prsActualRevenueTotal.toLocaleString()} → R ${report.after.prsActualRevenueTotal.toLocaleString()}`);
  console.log(`Orphan actuals (dead parent) : ${report.before.orphanActuals} → ${report.after.orphanActuals}`);
  console.log(`Unlinked cost lines          : ${report.before.unlinkedCostLines} → ${report.after.unlinkedCostLines}`);
  console.log(`Mutations ${report.mode === "execute" ? "applied" : "planned"}            : ${report.mutationCount}`);
  if (report.goldenParity && report.goldenParity.length > 0) {
    const fails = report.goldenParity.filter((g) => !g.withinR1);
    console.log(`Golden parity                : ${report.goldenParity.length - fails.length}/${report.goldenParity.length} within R1`);
    for (const f of fails) {
      console.log(`  ✗ ${f.projectName} ${f.surface}: derived=${f.derived} oracle=${f.oracle} Δ=${f.delta}`);
    }
  }
  console.log("");
}

const isDirectRun = process.argv[1]?.includes("backfill-finance-linkage");
if (isDirectRun) {
  const execute = process.argv.includes("--execute");
  runFinanceLinkageBackfill({ execute })
    .then((report) => {
      printSummary(report);
      if (!execute) {
        console.log("Dry-run only — re-run with --execute to apply. Nothing was changed.");
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error("[backfill-finance-linkage] FAILED:", err);
      process.exit(1);
    });
}
