/**
 * Post-Commit project_revenue_summary Refresh (S12)
 *
 * After a v2 incremental commit writes to normalized_cost_lines and
 * normalized_revenue_lines, this helper refreshes project_revenue_summary
 * from the CANONICAL § 3.3 line-level derivation so the FYE Detail view sees fresh
 * budget/actual revenue and COS figures after each commit.
 *
 * Historical note: this file used to also materialize program_expense and
 * program_inflows as back-compat derivatives of NCL/NRL. Those two tables
 * were retired in the Wave 2 cleanup of the PE/PI legacy, so the
 * materializer now only keeps project_revenue_summary in sync.
 * The file and its export name are kept unchanged to minimise diff surface
 * on the caller (server/smart-import-routes.ts). This module can be
 * renamed to project-revenue-summary-refresher in a future cleanup if
 * desired.
 */

import type { NormalizationResult } from "./normalizer";
import { addTemporalColumns } from "../temporal-helpers";
import { projectRevenueSummary } from "@shared/schema";
import { and, eq, isNull, ne } from "drizzle-orm";
import { getCanonicalProjectTotals } from "../finance/canonical-project-totals";

/**
 * Rename-safe upsert of the project's live `project_revenue_summary` row.
 *
 * The previous upsert was keyed on the DEPRECATED `projectName` column. When
 * a project was renamed (or re-imported under a name variant), the old name's
 * row stayed live forever while a second live row appeared under the new
 * name — both carrying revenue. Those orphan rows are what inflated the PRS
 * company total (~R416M against the ~R131M canonical § 3.3 truth in prod).
 *
 * Invariant after this upsert: exactly ONE live row per projectId, carrying
 * the project's current name. Resolution order:
 *   1. A row (live or historical — project_name is table-wide UNIQUE, so the
 *      name slot never frees up) already holding this NAME → reclaim it for
 *      this projectId, refresh values, re-open if it was soft-closed.
 *   2. Otherwise a live row for this projectId (project renamed) → update it
 *      in place, carrying the new name.
 *   3. Otherwise insert.
 * Any OTHER live row for the same projectId (stale rename leftovers) is
 * soft-closed; quarantining rows for dead projects is the backfill's job.
 */
export async function upsertProjectRevenueSummary(
  tx: any,
  args: {
    projectId: number;
    projectName: string;
    vals: Record<string, any>;
    runId: number | null;
    commitTimestamp: Date;
  },
): Promise<void> {
  const { projectId, projectName, vals, runId, commitTimestamp } = args;

  const [byName] = await tx.select({
    id: projectRevenueSummary.id,
    projectId: projectRevenueSummary.projectId,
  })
    .from(projectRevenueSummary)
    .where(eq(projectRevenueSummary.projectName, projectName))
    .limit(1);

  let keptRowId: number | null = null;
  if (byName) {
    await tx.update(projectRevenueSummary)
      .set({
        ...vals,
        projectId,
        snapshotRunId: runId,
        effectiveFrom: commitTimestamp,
        effectiveTo: null,
      })
      .where(eq(projectRevenueSummary.id, byName.id));
    keptRowId = byName.id;
  } else {
    const [byProject] = await tx.select({ id: projectRevenueSummary.id })
      .from(projectRevenueSummary)
      .where(and(
        eq(projectRevenueSummary.projectId, projectId),
        isNull(projectRevenueSummary.effectiveTo),
      ))
      .limit(1);
    if (byProject) {
      await tx.update(projectRevenueSummary)
        .set({
          ...vals,
          projectName,
          snapshotRunId: runId,
          effectiveFrom: commitTimestamp,
        })
        .where(eq(projectRevenueSummary.id, byProject.id));
      keptRowId = byProject.id;
    } else {
      const [inserted] = await tx.insert(projectRevenueSummary)
        .values(addTemporalColumns({ projectName, projectId, ...vals }, runId ?? undefined, commitTimestamp) as any)
        .returning({ id: projectRevenueSummary.id });
      keptRowId = inserted?.id ?? null;
    }
  }

  // Enforce the one-live-row-per-project invariant: soft-close stale rename
  // leftovers still live under this projectId's previous names.
  if (keptRowId != null) {
    await tx.update(projectRevenueSummary)
      .set({ effectiveTo: commitTimestamp })
      .where(and(
        eq(projectRevenueSummary.projectId, projectId),
        isNull(projectRevenueSummary.effectiveTo),
        ne(projectRevenueSummary.id, keptRowId),
      ));
  }
}

export interface MaterializerContext {
  tx: any;
  projectId: number;
  projectName: string;
  runId: number;
  commitTimestamp: Date;
  norm: NormalizationResult;
}

export interface MaterializerResult {
  projectRevenueSummaryUpdated: boolean;
}

/**
 * Refresh project_revenue_summary from the canonical line-level totals after
 * a v2 incremental commit. Idempotent upsert keyed by project name.
 */
export async function materializeDerivatives(ctx: MaterializerContext): Promise<MaterializerResult> {
  const { tx, projectId, projectName, runId, commitTimestamp } = ctx;
  const result: MaterializerResult = {
    projectRevenueSummaryUpdated: false,
  };

  // PRS is a MATERIALIZED VIEW over the canonical § 3.3 line-level
  // derivation — refreshed inside the commit transaction so it can never
  // disagree with the finance pages. The pasted workbook header summary
  // (norm.costedSummary) is deliberately NOT written here any more: it was
  // one of the "four values" (tracker_revenue_summary still preserves the
  // workbook figures verbatim for audit/replica use via writeRevenueSummary).
  if (projectName) {
    const totals = (await getCanonicalProjectTotals([projectId], {}, tx)).get(projectId);
    if (totals) {
      const vals: Record<string, any> = {
        actualRevenue: String(totals.realisedRevenue),
        actualExpenditure: String(totals.realisedCos),
        actualProfit: String(totals.realisedGp),
        actualMargin:
          totals.realisedRevenue !== 0
            ? String(Number((totals.realisedGp / totals.realisedRevenue).toFixed(4)))
            : null,
        plannedRevenue: String(totals.plannedRevenue),
        plannedExpenditure: String(totals.plannedCos),
        plannedProfit: String(totals.plannedGp),
        plannedMargin:
          totals.plannedRevenue !== 0
            ? String(Number((totals.plannedGp / totals.plannedRevenue).toFixed(4)))
            : null,
      };
      await upsertProjectRevenueSummary(tx, { projectId, projectName, vals, runId, commitTimestamp });
      result.projectRevenueSummaryUpdated = true;
    }
  }

  return result;
}
