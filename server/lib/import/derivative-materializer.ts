/**
 * Post-Commit project_revenue_summary Refresh (S12)
 *
 * After a v2 incremental commit writes to normalized_cost_lines and
 * normalized_revenue_lines, this helper refreshes project_revenue_summary
 * from the normalized costedSummary so the FYE Detail view sees fresh
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
import { and, eq, isNull } from "drizzle-orm";

/**
 * Minimal structural surface of the Drizzle transaction used here. The real
 * handle is typed `any` at its source (`server/db.ts`, dual pg / dev-SQLite
 * driver); this narrows it to the builder chains touched in this file
 * without widening back to `any`.
 */
type MaterializerTx = {
  select(columns: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): { limit(n: number): Promise<Array<{ id: number }>> };
    };
  };
  update(table: unknown): {
    set(values: Record<string, unknown>): { where(condition: unknown): Promise<unknown> };
  };
  insert(table: unknown): {
    values(values: Record<string, unknown> | Record<string, unknown>[]): Promise<unknown>;
  };
};

export interface MaterializerContext {
  tx: MaterializerTx;
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
 * Refresh project_revenue_summary from the normalized costedSummary after
 * a v2 incremental commit. Idempotent upsert keyed by project name.
 */
export async function materializeDerivatives(ctx: MaterializerContext): Promise<MaterializerResult> {
  const { tx, projectId, projectName, runId, commitTimestamp, norm } = ctx;
  const result: MaterializerResult = {
    projectRevenueSummaryUpdated: false,
  };

  if (norm.costedSummary && projectName) {
    const cs = norm.costedSummary;
    const hasData = cs.plannedRevenue != null || cs.plannedExpenditure != null;
    if (hasData) {
      const [existing] = await tx.select({ id: projectRevenueSummary.id })
        .from(projectRevenueSummary)
        .where(and(
          eq(projectRevenueSummary.projectName, projectName),
          isNull(projectRevenueSummary.effectiveTo),
        ))
        .limit(1);
      const vals: Record<string, unknown> = {};
      if (cs.plannedRevenue != null) vals.plannedRevenue = String(cs.plannedRevenue);
      if (cs.plannedExpenditure != null) vals.plannedExpenditure = String(cs.plannedExpenditure);
      if (cs.plannedProfit != null) vals.plannedProfit = String(cs.plannedProfit);
      if (cs.plannedMargin != null) vals.plannedMargin = String(cs.plannedMargin);
      if (cs.actualRevenue != null) vals.actualRevenue = String(cs.actualRevenue);
      if (cs.actualExpenditure != null) vals.actualExpenditure = String(cs.actualExpenditure);
      if (cs.actualProfit != null) vals.actualProfit = String(cs.actualProfit);
      if (cs.actualMargin != null) vals.actualMargin = String(cs.actualMargin);
      if (existing) {
        await tx.update(projectRevenueSummary)
          .set({ ...vals, snapshotRunId: runId, effectiveFrom: commitTimestamp })
          .where(and(
            eq(projectRevenueSummary.id, existing.id),
            isNull(projectRevenueSummary.effectiveTo),
          ));
      } else {
        await tx.insert(projectRevenueSummary).values(addTemporalColumns({ projectName, projectId, ...vals }, runId, commitTimestamp));
      }
      result.projectRevenueSummaryUpdated = true;
    }
  }

  return result;
}
