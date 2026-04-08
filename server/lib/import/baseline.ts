/**
 * Smart Import v2 — Baseline Detection & Current State Loading
 *
 * Determines whether an import is BASELINE or INCREMENTAL, and loads
 * the current active rows from the database for comparison.
 */

import { db } from "../../db";
import {
  smartImportRuns,
  normalizedCostLines,
  normalizedRevenueLines,
  workItems,
} from "@shared/schema";
import { eq, and, desc, isNull } from "drizzle-orm";

export type ImportMode = "BASELINE" | "INCREMENTAL";

export interface BaselineInfo {
  importMode: ImportMode;
  /** The ID of the last committed import run (null for BASELINE) */
  lastCommittedRunId: number | null;
  /** When the last import was committed (null for BASELINE) */
  lastCommittedAt: Date | null;
}

/**
 * Determine whether a project's next import should be BASELINE or INCREMENTAL.
 * BASELINE = no prior COMMITTED import exists for this projectId.
 * INCREMENTAL = at least one prior COMMITTED import exists.
 */
export async function detectImportMode(projectId: number): Promise<BaselineInfo> {
  const [lastCommitted] = await db
    .select({
      id: smartImportRuns.id,
      committedAt: smartImportRuns.committedAt,
    })
    .from(smartImportRuns)
    .where(
      and(
        eq(smartImportRuns.projectId, projectId),
        eq(smartImportRuns.status, "COMMITTED"),
      ),
    )
    .orderBy(desc(smartImportRuns.committedAt))
    .limit(1);

  if (!lastCommitted) {
    return {
      importMode: "BASELINE",
      lastCommittedRunId: null,
      lastCommittedAt: null,
    };
  }

  return {
    importMode: "INCREMENTAL",
    lastCommittedRunId: lastCommitted.id,
    lastCommittedAt: lastCommitted.committedAt,
  };
}

// ---------------------------------------------------------------------------
// Current state loaders — fetch active rows (effectiveTo IS NULL)
// ---------------------------------------------------------------------------

/**
 * Load current active PLAN rows (work_items where source=SMART_IMPORT, workstream=PM)
 * for a given project.
 */
export async function loadCurrentPlanRows(projectId: number) {
  return db
    .select({
      id: workItems.id,
      taskName: workItems.title,
      taskNo: workItems.wbsCode,
      phase: workItems.phase,
      startDate: workItems.startDate,
      endDate: workItems.endDate,
      durationDays: workItems.duration,
      actualStartDate: workItems.actualStart,
      actualEndDate: workItems.actualEnd,
      actualDurationDays: workItems.actualDuration,
      owner: workItems.ownerName,
      status: workItems.status,
      pctComplete: workItems.percentComplete,
      expectedPctComplete: workItems.expectedPctComplete,
      comment: workItems.description,
      isMilestone: workItems.isMilestone,
      parentTaskNo: workItems.outlineNumber,
      subProjectName: workItems.subProjectName,
      importRunId: workItems.importRunId,
    })
    .from(workItems)
    .where(
      and(
        eq(workItems.projectId, projectId),
        eq(workItems.source, "SMART_IMPORT"),
        eq(workItems.workstream, "PM"),
        isNull(workItems.deletedAt),
      ),
    );
}

/**
 * Load current active REVENUE rows for a given project.
 * Only rows where effectiveTo IS NULL (current version).
 */
export async function loadCurrentRevenueRows(projectId: number) {
  return db
    .select({
      id: normalizedRevenueLines.id,
      milestoneName: normalizedRevenueLines.milestoneName,
      description: normalizedRevenueLines.description,
      amountExVat: normalizedRevenueLines.amountExVat,
      vat: normalizedRevenueLines.vat,
      invoiceNumber: normalizedRevenueLines.invoiceNumber,
      invoiceDate: normalizedRevenueLines.invoiceDate,
      expectedPaymentDate: normalizedRevenueLines.expectedPaymentDate,
      paidDate: normalizedRevenueLines.paidDate,
      inBankDate: normalizedRevenueLines.inBankDate,
      status: normalizedRevenueLines.status,
      subProjectName: normalizedRevenueLines.subProjectName,
      importRunId: normalizedRevenueLines.importRunId,
    })
    .from(normalizedRevenueLines)
    .where(
      and(
        eq(normalizedRevenueLines.projectId, projectId),
        isNull(normalizedRevenueLines.effectiveTo),
      ),
    );
}

/**
 * Load current active EXPENDITURE rows for a given project.
 * Only rows where effectiveTo IS NULL (current version).
 */
export async function loadCurrentCostRows(projectId: number) {
  return db
    .select({
      id: normalizedCostLines.id,
      costCategory: normalizedCostLines.costCategory,
      counterpartyName: normalizedCostLines.counterpartyName,
      description: normalizedCostLines.description,
      amountExVat: normalizedCostLines.amountExVat,
      budgetQty: normalizedCostLines.budgetQty,
      budgetRate: normalizedCostLines.budgetRate,
      budgetTotal: normalizedCostLines.budgetTotal,
      budgetCos: normalizedCostLines.budgetCos,
      invoiceNumber: normalizedCostLines.invoiceNumber,
      invoiceDate: normalizedCostLines.invoiceDate,
      approvedDate: normalizedCostLines.approvedDate,
      paidDate: normalizedCostLines.paidDate,
      forecastPaymentDate: normalizedCostLines.forecastPaymentDate,
      poNumber: normalizedCostLines.poNumber,
      status: normalizedCostLines.status,
      subProjectName: normalizedCostLines.subProjectName,
      revenueRecognitionAmount: normalizedCostLines.revenueRecognitionAmount,
      importRunId: normalizedCostLines.importRunId,
    })
    .from(normalizedCostLines)
    .where(
      and(
        eq(normalizedCostLines.projectId, projectId),
        isNull(normalizedCostLines.effectiveTo),
      ),
    );
}
