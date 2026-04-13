/**
 * Smart Import v2 — Incremental Commit Executor
 *
 * Replaces v1 "soft-close all + re-insert all rows" with targeted writes:
 *   NEW rows       → INSERT into canonical table
 *   CHANGED rows   → UPDATE-in-place (or soft-close + re-insert for temporal tables)
 *   UNCHANGED rows → no-op (row keeps its id, no churn)
 *   MISSING rows   → kept (not deleted); flagged in audit
 *
 * Canonical write targets (from spine alignment audit):
 *   PLAN        → work_items (source=SMART_IMPORT, workstream=PM)
 *   REVENUE     → normalized_revenue_lines (effectiveTo IS NULL)
 *   EXPENDITURE → normalized_cost_lines (effectiveTo IS NULL)
 */

import type { MatchedRow, SectionType } from "./row-matcher";
import type { RowMergeResult, FieldMerge, MergeCase } from "./conflict-engine";
import type { PlannerResult } from "./planner";
import { CANONICAL_SOURCES } from "./planner";
import { normalizeCostLineStatus, normalizeRevenueLineStatus } from "./utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommitCounts {
  inserted: number;
  updated: number;
  unchanged: number;
  missing: number;
  conflictsResolved: number;
}

export interface SectionCommitResult {
  canonicalSource: string;
  counts: CommitCounts;
  /** IDs of rows that were inserted */
  insertedIds: number[];
  /** IDs of rows that were updated */
  updatedIds: number[];
}

export interface IncrementalCommitResult {
  sections: {
    PLAN: SectionCommitResult | null;
    REVENUE: SectionCommitResult | null;
    EXPENDITURE: SectionCommitResult | null;
  };
  totalInserted: number;
  totalUpdated: number;
  totalUnchanged: number;
  totalMissing: number;
}

// ---------------------------------------------------------------------------
// Field resolution — apply merge decisions to build final row values
// ---------------------------------------------------------------------------

/**
 * Given the file row, existing DB row, and the conflict merge results,
 * produce the final field values that should be written.
 *
 * For each compare field:
 *   UNCHANGED        → skip (don't include in update)
 *   AUTO_ACCEPT_FILE → use file value
 *   KEEP_APP         → skip (keep existing)
 *   CONFLICT         → use the resolved decision value
 */
export function resolveFieldValues(
  fileRow: Record<string, any>,
  existingRow: Record<string, any>,
  mergeResult: RowMergeResult | null,
  conflictDecisions: Record<string, "keep_app" | "accept_file">,
  compareFields: string[],
): Record<string, any> {
  const updates: Record<string, any> = {};

  if (!mergeResult) {
    // No merge result (baseline) — use all file values
    for (const field of compareFields) {
      if (fileRow[field] !== undefined) {
        updates[field] = fileRow[field];
      }
    }
    return updates;
  }

  const fieldMap = new Map<string, FieldMerge>();
  for (const fm of mergeResult.fields) {
    fieldMap.set(fm.fieldName, fm);
  }

  for (const field of compareFields) {
    const fm = fieldMap.get(field);
    if (!fm) {
      // Field not in merge result — use file value if different
      if (fileRow[field] !== undefined && fileRow[field] !== existingRow[field]) {
        updates[field] = fileRow[field];
      }
      continue;
    }

    switch (fm.mergeCase) {
      case "UNCHANGED":
        // No-op — leave existing value
        break;
      case "AUTO_ACCEPT_FILE":
        updates[field] = fileRow[field] ?? null;
        break;
      case "KEEP_APP":
        // No-op — existing row already has the app value
        break;
      case "CONFLICT": {
        const decisionKey = `${mergeResult.rowKey}::${field}`;
        const decision = conflictDecisions[decisionKey];
        if (decision === "accept_file") {
          updates[field] = fileRow[field] ?? null;
        }
        // else keep_app → no-op
        break;
      }
    }
  }

  return updates;
}

// ---------------------------------------------------------------------------
// PLAN section writer
// ---------------------------------------------------------------------------

export interface PlanWriteContext {
  tx: any;
  projectId: number;
  projectName: string;
  runId: number;
  userId: number | null;
  matchedRows: MatchedRow[];
  mergeResults: Map<string, RowMergeResult>;
  conflictDecisions: Record<string, "keep_app" | "accept_file">;
  workItemsTable: any;
  workItemDependenciesTable: any;
  workItemAssignmentsTable: any;
}

export async function writePlanIncremental(ctx: PlanWriteContext): Promise<SectionCommitResult> {
  const { tx, projectId, projectName, runId, userId, matchedRows, mergeResults, conflictDecisions } = ctx;
  const { workItemsTable: workItems, workItemDependenciesTable: workItemDependencies, workItemAssignmentsTable: workItemAssignments } = ctx;
  const { eq, and, sql: sqlTag } = await import("drizzle-orm");

  const counts: CommitCounts = { inserted: 0, updated: 0, unchanged: 0, missing: 0, conflictsResolved: 0 };
  const insertedIds: number[] = [];
  const updatedIds: number[] = [];

  const PLAN_UPDATE_FIELDS = [
    "startDate", "endDate", "durationDays",
    "actualStartDate", "actualEndDate", "actualDurationDays",
    "owner", "status", "pctComplete", "expectedPctComplete",
    "comment", "isMilestone", "parentTaskNo",
  ];

  // Map from work_items column names → normalizer field names
  const WI_FIELD_MAP: Record<string, string> = {
    startDate: "startDate", endDate: "endDate", duration: "durationDays",
    actualStart: "actualStartDate", actualEnd: "actualEndDate", actualDuration: "actualDurationDays",
    ownerName: "owner", status: "status", percentComplete: "pctComplete",
    expectedPctComplete: "expectedPctComplete", description: "comment",
    isMilestone: "isMilestone", outlineNumber: "parentTaskNo",
  };

  for (const mr of matchedRows) {
    if (mr.classification === "UNCHANGED") {
      counts.unchanged++;
      continue;
    }

    if (mr.classification === "MISSING_FROM_UPLOAD") {
      counts.missing++;
      // Policy: keep missing rows — do not delete
      continue;
    }

    if (mr.classification === "NEW") {
      const fileRow = mr.fileRow!;
      const wbsCode = fileRow.taskNo || null;
      const rowRef = fileRow.sourceRow != null ? `ROW-${fileRow.sourceRow}` : `IDX-${mr.fileIndex}`;
      const projectRef = `PID-${projectId}`;
      const externalRef = `${projectRef}::PLAN::${rowRef}::${wbsCode || ''}`;

      const [inserted] = await tx.insert(workItems).values({
        clientId: null,
        projectId,
        workstream: "PM" as any,
        type: fileRow.isMilestone ? "milestone" : "task",
        source: "SMART_IMPORT" as any,
        title: fileRow.taskName,
        description: fileRow.comment || null,
        status: fileRow.status || "Not Started",
        priority: null,
        startDate: fileRow.startDate || fileRow.actualStartDate || null,
        endDate: fileRow.endDate || fileRow.actualEndDate || null,
        duration: fileRow.durationDays || fileRow.actualDurationDays || null,
        actualStart: fileRow.actualStartDate || null,
        actualEnd: fileRow.actualEndDate || null,
        actualDuration: fileRow.actualDurationDays || null,
        percentComplete: fileRow.pctComplete != null ? Number(fileRow.pctComplete) : 0,
        expectedPctComplete: fileRow.expectedPctComplete != null ? Number(fileRow.expectedPctComplete) : null,
        wbsCode,
        outlineNumber: wbsCode,
        indentLevel: fileRow.indentLevel ?? 0,
        isMilestone: fileRow.isMilestone ?? false,
        phase: fileRow.phase || null,
        parentId: null,
        ownerUserId: null,
        ownerName: fileRow.owner || null,
        isShared: false,
        externalRef,
        sourceRow: fileRow.sourceRow || null,
        sourceSheet: fileRow.sourceSheet || null,
        importRunId: runId,
        subProjectName: fileRow.subProjectName || null,
        createdBy: userId || 1,
      }).returning();

      insertedIds.push(inserted.id);
      counts.inserted++;
      continue;
    }

    if (mr.classification === "CHANGED" || mr.classification === "CONFLICT_PLACEHOLDER") {
      const existingId = mr.existingRowId!;
      const fileRow = mr.fileRow!;
      const mergeResult = mergeResults.get(mr.businessKey.key) || null;

      const fieldUpdates = resolveFieldValues(fileRow, mr.existingRow || {}, mergeResult, conflictDecisions, PLAN_UPDATE_FIELDS);

      if (mergeResult) {
        const resolvedConflicts = mergeResult.fields.filter(f => f.mergeCase === "CONFLICT");
        counts.conflictsResolved += resolvedConflicts.length;
      }

      if (Object.keys(fieldUpdates).length === 0) {
        counts.unchanged++;
        continue;
      }

      // Map normalizer field names to work_items column names
      const wiUpdates: Record<string, any> = { updatedAt: new Date(), importRunId: runId };
      for (const [wiCol, normField] of Object.entries(WI_FIELD_MAP)) {
        if (normField in fieldUpdates) {
          wiUpdates[wiCol] = fieldUpdates[normField];
        }
      }

      await tx.update(workItems).set(wiUpdates).where(eq(workItems.id, existingId));
      updatedIds.push(existingId);
      counts.updated++;
    }
  }

  return { canonicalSource: CANONICAL_SOURCES.PLAN, counts, insertedIds, updatedIds };
}

// ---------------------------------------------------------------------------
// REVENUE section writer
// ---------------------------------------------------------------------------

export interface TemporalWriteContext {
  tx: any;
  projectId: number;
  projectName: string;
  runId: number;
  userId: number | null;
  matchedRows: MatchedRow[];
  mergeResults: Map<string, RowMergeResult>;
  conflictDecisions: Record<string, "keep_app" | "accept_file">;
  commitTimestamp: Date;
}

export async function writeRevenueIncremental(ctx: TemporalWriteContext): Promise<SectionCommitResult> {
  const { tx, projectId, projectName, runId, matchedRows, mergeResults, conflictDecisions, commitTimestamp } = ctx;
  const { eq, sql: sqlTag } = await import("drizzle-orm");
  const { normalizedRevenueLines } = await import("@shared/schema");

  const counts: CommitCounts = { inserted: 0, updated: 0, unchanged: 0, missing: 0, conflictsResolved: 0 };
  const insertedIds: number[] = [];
  const updatedIds: number[] = [];

  const COMPARE_FIELDS = [
    "amountExVat", "vat", "milestonePercent", "invoiceNumber", "invoiceDate",
    "expectedPaymentDate", "paidDate", "inBankDate", "status",
  ];

  for (const mr of matchedRows) {
    if (mr.classification === "UNCHANGED") {
      counts.unchanged++;
      continue;
    }
    if (mr.classification === "MISSING_FROM_UPLOAD") {
      counts.missing++;
      continue;
    }
    if (mr.classification === "NEW") {
      const f = mr.fileRow!;
      const [inserted] = await tx.insert(normalizedRevenueLines).values({
        projectId,
        projectName,
        description: f.description || f.milestoneName,
        milestoneName: f.milestoneName,
        milestoneNo: f.milestoneNo || null,
        milestonePercent: f.milestonePercent || null,
        amountExVat: f.amountExVat,
        vat: f.vat,
        invoiceNumber: f.invoiceNumber,
        invoiceDate: f.invoiceDate,
        invoiceDateFontColor: f.invoiceDateFontColor || null,
        invoiceDateConfirmed: f.invoiceDateConfirmed || false,
        expectedPaymentDate: f.expectedPaymentDate,
        paidDate: f.paidDate,
        paidDateFontColor: f.paidDateFontColor || null,
        paidDateConfirmed: f.paidDateConfirmed || false,
        inBankDate: f.inBankDate,
        status: normalizeRevenueLineStatus(f.status),
        sourceSheet: f.sourceSheet,
        sourceRow: f.sourceRow,
        importRunId: runId,
        turnaroundDays: f.turnaroundDays,
        subProjectName: f.subProjectName || null,
        effectiveFrom: commitTimestamp,
        effectiveTo: null,
        snapshotRunId: runId,
      }).returning();
      insertedIds.push(inserted.id);
      counts.inserted++;
      continue;
    }

    if (mr.classification === "CHANGED" || mr.classification === "CONFLICT_PLACEHOLDER") {
      const existingId = mr.existingRowId!;
      const fileRow = mr.fileRow!;
      const mergeResult = mergeResults.get(mr.businessKey.key) || null;

      const fieldUpdates = resolveFieldValues(fileRow, mr.existingRow || {}, mergeResult, conflictDecisions, COMPARE_FIELDS);

      if (mergeResult) {
        counts.conflictsResolved += mergeResult.fields.filter(f => f.mergeCase === "CONFLICT").length;
      }

      if (Object.keys(fieldUpdates).length === 0) {
        counts.unchanged++;
        continue;
      }

      // For temporal tables: soft-close the existing row and insert a replacement
      await tx.update(normalizedRevenueLines)
        .set({ effectiveTo: commitTimestamp })
        .where(eq(normalizedRevenueLines.id, existingId));


      const existingRow = mr.existingRow as any;
      const [inserted] = await tx.insert(normalizedRevenueLines).values({
        projectId,
        projectName,
        description: existingRow.description,
        milestoneName: existingRow.milestoneName,
        milestoneNo: fileRow.milestoneNo || existingRow.milestoneNo || null,
        milestonePercent: fieldUpdates.milestonePercent ?? existingRow.milestonePercent ?? null,
        amountExVat: fieldUpdates.amountExVat ?? existingRow.amountExVat,
        vat: fieldUpdates.vat ?? existingRow.vat,
        invoiceNumber: fieldUpdates.invoiceNumber ?? existingRow.invoiceNumber,
        invoiceDate: fieldUpdates.invoiceDate ?? existingRow.invoiceDate,
        invoiceDateFontColor: fileRow.invoiceDateFontColor ?? existingRow.invoiceDateFontColor,
        invoiceDateConfirmed: fileRow.invoiceDateConfirmed ?? existingRow.invoiceDateConfirmed,
        expectedPaymentDate: fieldUpdates.expectedPaymentDate ?? existingRow.expectedPaymentDate,
        paidDate: fieldUpdates.paidDate ?? existingRow.paidDate,
        paidDateFontColor: fileRow.paidDateFontColor ?? existingRow.paidDateFontColor,
        paidDateConfirmed: fileRow.paidDateConfirmed ?? existingRow.paidDateConfirmed,
        inBankDate: fieldUpdates.inBankDate ?? existingRow.inBankDate,
        status: normalizeRevenueLineStatus(fieldUpdates.status ?? existingRow.status),
        sourceSheet: existingRow.sourceSheet || fileRow.sourceSheet,
        sourceRow: existingRow.sourceRow || fileRow.sourceRow,
        importRunId: runId,
        turnaroundDays: fileRow.turnaroundDays,
        subProjectName: existingRow.subProjectName,
        effectiveFrom: commitTimestamp,
        effectiveTo: null,
        snapshotRunId: runId,
        // Carry forward admin overrides from existing row
        adminDateOverride: existingRow.adminDateOverride || null,
        adminDateOverrideReason: existingRow.adminDateOverrideReason || null,
        adminDateOverrideBy: existingRow.adminDateOverrideBy || null,
        adminDateOverrideAt: existingRow.adminDateOverrideAt || null,
      }).returning();
      insertedIds.push(inserted.id);
      updatedIds.push(existingId); // the old ID that was soft-closed
      counts.updated++;
    }
  }

  return { canonicalSource: CANONICAL_SOURCES.REVENUE, counts, insertedIds, updatedIds };
}

// ---------------------------------------------------------------------------
// EXPENDITURE section writer
// ---------------------------------------------------------------------------

export async function writeExpenditureIncremental(ctx: TemporalWriteContext): Promise<SectionCommitResult> {
  const { tx, projectId, projectName, runId, matchedRows, mergeResults, conflictDecisions, commitTimestamp } = ctx;
  const { eq } = await import("drizzle-orm");
  const { normalizedCostLines } = await import("@shared/schema");

  const counts: CommitCounts = { inserted: 0, updated: 0, unchanged: 0, missing: 0, conflictsResolved: 0 };
  const insertedIds: number[] = [];
  const updatedIds: number[] = [];

  const COMPARE_FIELDS = [
    "amountExVat", "budgetQty", "budgetRate", "budgetTotal", "budgetCos",
    "invoiceNumber", "invoiceDate", "approvedDate", "paidDate",
    "forecastPaymentDate", "poNumber", "costCategory", "status",
    "counterpartyName", "revenueRecognitionAmount",
  ];

  for (const mr of matchedRows) {
    if (mr.classification === "UNCHANGED") {
      counts.unchanged++;
      continue;
    }
    if (mr.classification === "MISSING_FROM_UPLOAD") {
      counts.missing++;
      continue;
    }
    if (mr.classification === "NEW") {
      const f = mr.fileRow!;
      const [inserted] = await tx.insert(normalizedCostLines).values({
        projectId,
        projectName,
        costCategory: f.costCategory,
        counterpartyName: f.counterpartyName,
        description: f.description,
        amountExVat: f.amountExVat,
        invoiceNumber: f.invoiceNumber,
        invoiceDate: f.invoiceDate,
        invoiceDateFontColor: f.invoiceDateFontColor || null,
        invoiceDateConfirmed: f.invoiceDateConfirmed || false,
        approvedDate: f.approvedDate,
        paidDate: f.paidDate,
        paidDateFontColor: f.paidDateFontColor || null,
        paidDateConfirmed: f.paidDateConfirmed || false,
        poNumber: f.poNumber,
        cosRealised: f.cosRealised || false,
        cashflowConfirmed: f.cashflowConfirmed || false,
        status: normalizeCostLineStatus(f.status),
        sourceSheet: f.sourceSheet,
        sourceRow: f.sourceRow,
        importRunId: runId,
        turnaroundDays: f.turnaroundDays,
        budgetQty: f.budgetQty || null,
        budgetRate: f.budgetRate || null,
        budgetTotal: f.budgetTotal || null,
        budgetCos: f.budgetCos || null,
        revenueRecognitionAmount: f.revenueRecognitionAmount || null,
        forecastPaymentDate: f.forecastPaymentDate || null,
        subProjectName: f.subProjectName || null,
        effectiveFrom: commitTimestamp,
        effectiveTo: null,
        snapshotRunId: runId,
      }).returning();
      insertedIds.push(inserted.id);
      counts.inserted++;
      continue;
    }

    if (mr.classification === "CHANGED" || mr.classification === "CONFLICT_PLACEHOLDER") {
      const existingId = mr.existingRowId!;
      const fileRow = mr.fileRow!;
      const mergeResult = mergeResults.get(mr.businessKey.key) || null;

      const fieldUpdates = resolveFieldValues(fileRow, mr.existingRow || {}, mergeResult, conflictDecisions, COMPARE_FIELDS);

      if (mergeResult) {
        counts.conflictsResolved += mergeResult.fields.filter(f => f.mergeCase === "CONFLICT").length;
      }

      if (Object.keys(fieldUpdates).length === 0) {
        counts.unchanged++;
        continue;
      }

      // Temporal: soft-close existing row and insert replacement
      await tx.update(normalizedCostLines)
        .set({ effectiveTo: commitTimestamp })
        .where(eq(normalizedCostLines.id, existingId));

      const existing = mr.existingRow as any;
      const [inserted] = await tx.insert(normalizedCostLines).values({
        projectId,
        projectName,
        costCategory: fieldUpdates.costCategory ?? existing.costCategory,
        counterpartyName: fieldUpdates.counterpartyName ?? existing.counterpartyName,
        description: existing.description,
        amountExVat: fieldUpdates.amountExVat ?? existing.amountExVat,
        invoiceNumber: fieldUpdates.invoiceNumber ?? existing.invoiceNumber,
        invoiceDate: fieldUpdates.invoiceDate ?? existing.invoiceDate,
        invoiceDateFontColor: fileRow.invoiceDateFontColor ?? existing.invoiceDateFontColor,
        invoiceDateConfirmed: existing.invoiceDateConfirmed,
        approvedDate: fieldUpdates.approvedDate ?? existing.approvedDate,
        paidDate: fieldUpdates.paidDate ?? existing.paidDate,
        paidDateFontColor: fileRow.paidDateFontColor ?? existing.paidDateFontColor,
        paidDateConfirmed: existing.paidDateConfirmed,
        poNumber: fieldUpdates.poNumber ?? existing.poNumber,
        // Recalculate cosRealised from the resolved invoice number (canonical invoice-only rule).
        // Do NOT carry forward the old value — if the invoice number changed, realisation must update.
        cosRealised: !!((fieldUpdates.invoiceNumber ?? existing.invoiceNumber) && String(fieldUpdates.invoiceNumber ?? existing.invoiceNumber).trim()),
        cashflowConfirmed: existing.cashflowConfirmed,
        status: normalizeCostLineStatus(fieldUpdates.status ?? existing.status),
        sourceSheet: existing.sourceSheet || fileRow.sourceSheet,
        sourceRow: existing.sourceRow || fileRow.sourceRow,
        importRunId: runId,
        turnaroundDays: fileRow.turnaroundDays,
        budgetQty: fieldUpdates.budgetQty ?? existing.budgetQty,
        budgetRate: fieldUpdates.budgetRate ?? existing.budgetRate,
        budgetTotal: fieldUpdates.budgetTotal ?? existing.budgetTotal,
        budgetCos: fieldUpdates.budgetCos ?? existing.budgetCos,
        revenueRecognitionAmount: fieldUpdates.revenueRecognitionAmount ?? existing.revenueRecognitionAmount,
        forecastPaymentDate: fieldUpdates.forecastPaymentDate ?? existing.forecastPaymentDate,
        subProjectName: existing.subProjectName,
        // Carry forward app-owned fields
        noRevenueLinked: existing.noRevenueLinked,
        adminDateOverride: existing.adminDateOverride || null,
        adminDateOverrideReason: existing.adminDateOverrideReason || null,
        adminDateOverrideBy: existing.adminDateOverrideBy || null,
        adminDateOverrideAt: existing.adminDateOverrideAt || null,
        effectiveFrom: commitTimestamp,
        effectiveTo: null,
        snapshotRunId: runId,
      }).returning();
      insertedIds.push(inserted.id);
      updatedIds.push(existingId);
      counts.updated++;
    }
  }

  return { canonicalSource: CANONICAL_SOURCES.EXPENDITURE, counts, insertedIds, updatedIds };
}
