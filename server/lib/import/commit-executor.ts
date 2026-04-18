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
  const { workItemsTable: workItems } = ctx;
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

  // Identity is owned by the row matcher. Every MatchedRow arrives with a
  // stable `rowUid` (unique within this import's section) and — for PLAN —
  // a `canonicalExternalRef` that the executor writes to
  // `work_items.external_ref`. The executor never rewrites identity based
  // on file position; it only writes what the matcher computed.
  //
  // NEW rows in a duplicate-key group arrive with a temporary
  // `...#new-<fileIdx>` suffix that is unique-within-this-run but not yet
  // tied to a DB row. After insert we fix those up to `#pk<id>` so the
  // identity survives future commits deterministically.
  const fallbackRef = (bkKey: string) => `PID-${projectId}::PLAN::BK::${bkKey}`;
  const swapRowUidInRef = (ref: string, oldRowUid: string, newRowUid: string) =>
    ref.endsWith(oldRowUid) ? `${ref.slice(0, ref.length - oldRowUid.length)}${newRowUid}` : ref;

  /**
   * Resolve a safe external_ref to write for a given row. If the preferred
   * ref is already owned by a different active work_items row, fall back to
   * a `#pk<ownId>` variant which is guaranteed unique (the row's own id
   * cannot collide with anyone else's). Returns `null` if no safe ref
   * could be computed without the caller's own id.
   */
  async function resolveSafeRef(preferred: string, ownId: number | null, bkKey: string): Promise<string> {
    const rowsWithRef = await tx
      .select({ id: workItems.id })
      .from(workItems)
      .where(and(eq(workItems.externalRef, preferred), sqlTag`${workItems.deletedAt} IS NULL`))
      .limit(1);
    if (rowsWithRef.length === 0) return preferred;
    const holderId = rowsWithRef[0].id;
    if (ownId != null && holderId === ownId) return preferred;
    if (ownId != null) return `${fallbackRef(bkKey)}#pk${ownId}`;
    // No own id yet (pre-insert) — we have no safe alternative to offer
    // the caller, so surface an error. This path should only be reachable
    // after a buggy matcher emits two NEW rows with identical rowUids.
    throw Object.assign(new Error(`external_ref collision on ${preferred} with no self-id fallback`), {
      code: "EXTREF_COLLISION",
      preferred,
      holderId,
    });
  }

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

    const rowUid = mr.rowUid ?? mr.businessKey.key;
    const canonicalRef = mr.canonicalExternalRef ?? fallbackRef(rowUid);

    if (mr.classification === "NEW") {
      const fileRow = mr.fileRow!;
      const wbsCode = fileRow.taskNo || null;

      // Defensive: if some other active row still carries the canonical ref
      // (e.g. a race, or a legacy row not yet normalized), UPDATE-in-place
      // rather than insert a colliding row. This should be a rare path
      // now that the matcher owns identity.
      const existingByRef = await tx
        .select({ id: workItems.id })
        .from(workItems)
        .where(and(
          eq(workItems.externalRef, canonicalRef),
          sqlTag`${workItems.deletedAt} IS NULL`,
        ))
        .limit(1);

      if (existingByRef.length > 0) {
        const existingId = existingByRef[0].id;
        await tx.update(workItems).set({
          updatedAt: new Date(),
          importRunId: runId,
          title: fileRow.taskName,
          description: fileRow.comment || null,
          status: fileRow.status || "Not Started",
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
          ownerName: fileRow.owner || null,
          sourceRow: fileRow.sourceRow || null,
          sourceSheet: fileRow.sourceSheet || null,
          subProjectName: fileRow.subProjectName || null,
          externalRef: canonicalRef,
        }).where(eq(workItems.id, existingId));
        updatedIds.push(existingId);
        counts.updated++;
        continue;
      }

      const insertValues = {
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
        externalRef: canonicalRef,
        sourceRow: fileRow.sourceRow || null,
        sourceSheet: fileRow.sourceSheet || null,
        importRunId: runId,
        subProjectName: fileRow.subProjectName || null,
        createdBy: userId || 1,
      };

      const [inserted] = await tx
        .insert(workItems)
        .values(insertValues)
        .returning({ id: workItems.id });

      // Post-insert fixup: if this was a duplicate-group NEW, the matcher
      // stamped a temporary `#new-<fileIdx>` rowUid. Rewrite the row's
      // external_ref to the permanent `#pk<insertedId>` form so the
      // identity survives future commits deterministically.
      if (mr.inDuplicateGroup) {
        const permanentRowUid = `${mr.businessKey.key}#pk${inserted.id}`;
        const permanentRef = swapRowUidInRef(canonicalRef, rowUid, permanentRowUid);
        await tx.update(workItems)
          .set({ externalRef: permanentRef })
          .where(eq(workItems.id, inserted.id));
      }

      insertedIds.push(inserted.id);
      counts.inserted++;
      continue;
    }

    if (mr.classification === "CHANGED" || mr.classification === "CONFLICT_PLACEHOLDER") {
      const existingId = mr.existingRowId!;
      const fileRow = mr.fileRow!;
      const mergeResult = mergeResults.get(rowUid) ?? mergeResults.get(mr.businessKey.key) ?? null;

      const fieldUpdates = resolveFieldValues(fileRow, mr.existingRow || {}, mergeResult, conflictDecisions, PLAN_UPDATE_FIELDS);

      if (mergeResult) {
        const resolvedConflicts = mergeResult.fields.filter(f => f.mergeCase === "CONFLICT");
        counts.conflictsResolved += resolvedConflicts.length;
      }

      // Normalize legacy externalRefs whenever the row's current value
      // drifts from the canonical form (old `#idxN` suffix, missing
      // suffix after a dup-group promotion, etc.).
      const existingRef = (mr.existingRow as any)?.externalRef ?? null;
      const needsRefNormalize = existingRef !== canonicalRef;

      if (Object.keys(fieldUpdates).length === 0 && !needsRefNormalize) {
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
      if (needsRefNormalize) {
        // Self-id fallback: if the canonical ref would collide with
        // another active row, fall back to `#pk<ownId>` which is
        // guaranteed unique. Protects against buggy matcher output or
        // unexpected legacy state.
        wiUpdates.externalRef = await resolveSafeRef(canonicalRef, existingId, mr.businessKey.key);
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
  const {
    applyQbPrecedence,
    lookupQbLink,
    writeQbVariances,
    repointQbLinks,
    isQbPrecedenceEnabled,
  } = await import("./qb-precedence");
  const qbPrecedenceOn = await isQbPrecedenceEnabled();

  const counts: CommitCounts = { inserted: 0, updated: 0, unchanged: 0, missing: 0, conflictsResolved: 0 };
  const insertedIds: number[] = [];
  const updatedIds: number[] = [];

  const COMPARE_FIELDS = [
    "amountExVat", "vat", "milestonePercent", "invoiceNumber", "invoiceDate",
    "expectedPaymentDate", "paidDate", "inBankDate", "status",
  ];

  // Admin-override carry-forward: see expenditure section for rationale.
  type RevPredecessor = {
    milestoneName: string | null;
    description: string | null;
    amountExVat: any;
    adminDateOverride: any;
    adminDateOverrideReason: string | null;
    adminDateOverrideBy: any;
    adminDateOverrideAt: any;
  };
  const closedRevPreds: RevPredecessor[] = [];
  const consumedRevIdxs = new Set<number>();
  function normStrR(s: any): string {
    return (s == null ? "" : String(s)).trim().toLowerCase();
  }
  function normAmtR(v: any): string {
    if (v == null || v === "") return "";
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return String(v).trim();
    return n.toFixed(2);
  }
  function findRevPredecessor(f: Record<string, any>): RevPredecessor | null {
    const fa = normAmtR(f.amountExVat);
    const fm = normStrR(f.milestoneName);
    const fd = normStrR(f.description);
    for (let i = 0; i < closedRevPreds.length; i++) {
      if (consumedRevIdxs.has(i)) continue;
      const p = closedRevPreds[i];
      if (
        normStrR(p.milestoneName) === fm &&
        normStrR(p.description) === fd &&
        normAmtR(p.amountExVat) === fa
      ) {
        consumedRevIdxs.add(i);
        return p;
      }
    }
    return null;
  }

  // Per-row QB variances accumulated during this commit; flushed once at end.
  type PendingVariance = { appEntityId: number; variances: any[] };
  const qbVariancePending: PendingVariance[] = [];

  // PRE-PASS: process MISSING_FROM_UPLOAD rows first so the predecessor
  // pool is fully populated before any NEW row is inserted. matchRows()
  // emits NEW/CHANGED/UNCHANGED in file-row order and MISSING last, so
  // without this pre-pass findRevPredecessor() would always come up empty
  // for key-shift cases (the most common admin-override loss path).
  for (const mr of matchedRows) {
    if (mr.classification !== "MISSING_FROM_UPLOAD") continue;
    counts.missing++;
    if (mr.existingRowId == null) continue;

    // QB precedence: if the row is QB-linked, the workbook's silence on it
    // does NOT justify removal — QB still considers the document to exist.
    // Suppress the soft-close and log a "missing_preserved" variance so the
    // operator can see what happened.
    if (qbPrecedenceOn) {
      const link = await lookupQbLink({ tx, appEntityType: "revenue_line", appEntityId: mr.existingRowId });
      if (link) {
        qbVariancePending.push({
          appEntityId: mr.existingRowId,
          variances: [{
            field: "row",
            workbookValue: "missing",
            qbValue: link.qbDocNumber ?? link.qbEntityId,
            resolution: "missing_preserved",
            notes: `Row preserved because QB link ${link.id} is active`,
            qbLinkId: link.id,
            qbDocId: null,
            qbRealmId: link.qbRealmId,
          }],
        });
        continue;
      }
    }

    await tx.update(normalizedRevenueLines)
      .set({ effectiveTo: commitTimestamp })
      .where(eq(normalizedRevenueLines.id, mr.existingRowId));
    const er = (mr.existingRow ?? {}) as any;
    if (er.adminDateOverride) {
      closedRevPreds.push({
        milestoneName: er.milestoneName ?? null,
        description: er.description ?? null,
        amountExVat: er.amountExVat,
        adminDateOverride: er.adminDateOverride ?? null,
        adminDateOverrideReason: er.adminDateOverrideReason ?? null,
        adminDateOverrideBy: er.adminDateOverrideBy ?? null,
        adminDateOverrideAt: er.adminDateOverrideAt ?? null,
      });
    }
  }

  for (const mr of matchedRows) {
    if (mr.classification === "UNCHANGED") {
      counts.unchanged++;
      continue;
    }
    if (mr.classification === "MISSING_FROM_UPLOAD") {
      // Already handled in pre-pass above.
      continue;
    }
    if (mr.classification === "NEW") {
      const f = mr.fileRow!;
      const carriedRev = findRevPredecessor(f);
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
        // Carry forward admin overrides from a soft-closed predecessor row
        // (key-shift case — see expenditure section for full rationale).
        adminDateOverride: carriedRev?.adminDateOverride ?? null,
        adminDateOverrideReason: carriedRev?.adminDateOverrideReason ?? null,
        adminDateOverrideBy: carriedRev?.adminDateOverrideBy ?? null,
        adminDateOverrideAt: carriedRev?.adminDateOverrideAt ?? null,
      }).returning();
      insertedIds.push(inserted.id);
      counts.inserted++;
      continue;
    }

    if (mr.classification === "CHANGED" || mr.classification === "CONFLICT_PLACEHOLDER") {
      const existingId = mr.existingRowId!;
      const fileRow = mr.fileRow!;
      const rowUid = mr.rowUid ?? mr.businessKey.key;
      const mergeResult = mergeResults.get(rowUid) ?? mergeResults.get(mr.businessKey.key) ?? null;

      const fieldUpdates = resolveFieldValues(fileRow, mr.existingRow || {}, mergeResult, conflictDecisions, COMPARE_FIELDS);

      if (mergeResult) {
        counts.conflictsResolved += mergeResult.fields.filter(f => f.mergeCase === "CONFLICT").length;
      }

      // QB precedence: for QB-linked rows, lock amount/VAT/invoice-number/
      // dates to the QB-canonical values. Mutate fieldUpdates so the insert
      // below picks up the locked values automatically.
      let qbVariancesForRow: any[] = [];
      if (qbPrecedenceOn) {
        const existingForProposed = (mr.existingRow ?? {}) as any;
        const proposed: Record<string, any> = {
          amountExVat: fieldUpdates.amountExVat ?? existingForProposed.amountExVat,
          vat: fieldUpdates.vat ?? existingForProposed.vat,
          invoiceNumber: fieldUpdates.invoiceNumber ?? existingForProposed.invoiceNumber,
          invoiceDate: fieldUpdates.invoiceDate ?? existingForProposed.invoiceDate,
          paidDate: fieldUpdates.paidDate ?? existingForProposed.paidDate,
          inBankDate: fieldUpdates.inBankDate ?? existingForProposed.inBankDate,
        };
        const qbResult = await applyQbPrecedence({
          tx,
          appEntityType: "revenue_line",
          appEntityId: existingId,
          proposedValues: proposed,
        });
        if (qbResult.isLinked) {
          for (const f of qbResult.lockedFields) {
            if (qbResult.finalValues[f] !== undefined) fieldUpdates[f] = qbResult.finalValues[f];
          }
          qbVariancesForRow = qbResult.variances;
        }
      }

      if (Object.keys(fieldUpdates).length === 0 && qbVariancesForRow.length === 0) {
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
      if (qbVariancesForRow.length > 0) {
        qbVariancePending.push({ appEntityId: inserted.id, variances: qbVariancesForRow });
        // Re-point any active QB link from the soft-closed predecessor to
        // the new inserted row id so the gate keeps firing on the next
        // import. This MUST happen for any QB-linked CHANGED row, not just
        // those with variances — but when the gate fires we know the link
        // exists; do it here unconditionally for linked rows.
        try {
          await repointQbLinks({
            tx,
            appEntityType: "revenue_line",
            oldAppEntityId: existingId,
            newAppEntityId: inserted.id,
          });
        } catch (err) {
          console.error("[commit-executor] Failed to re-point QB link for revenue:", err);
        }
      }
    }
  }

  // Flush QB variances. Failure to log MUST NOT fail the import.
  if (qbPrecedenceOn && qbVariancePending.length > 0) {
    try {
      for (const p of qbVariancePending) {
        await writeQbVariances({
          tx,
          importRunId: runId,
          projectId,
          appEntityType: "revenue_line",
          appEntityId: p.appEntityId,
          variances: p.variances,
        });
      }
    } catch (err) {
      console.error("[commit-executor] Failed to log QB variances for revenue:", err);
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
  const {
    applyQbPrecedence,
    lookupQbLink,
    writeQbVariances,
    repointQbLinks,
    isQbPrecedenceEnabled,
  } = await import("./qb-precedence");
  const qbPrecedenceOn = await isQbPrecedenceEnabled();

  const counts: CommitCounts = { inserted: 0, updated: 0, unchanged: 0, missing: 0, conflictsResolved: 0 };
  const insertedIds: number[] = [];
  const updatedIds: number[] = [];

  const COMPARE_FIELDS = [
    "amountExVat", "budgetQty", "budgetRate", "budgetTotal", "budgetCos",
    "invoiceNumber", "invoiceDate", "approvedDate", "paidDate",
    "forecastPaymentDate", "poNumber", "costCategory", "status",
    "counterpartyName", "revenueRecognitionAmount",
  ];

  // Admin-override carry-forward: when a row's business key shifts between
  // imports (e.g. invoice_number filled in for the first time), the matcher
  // classifies the old row as MISSING and the new row as NEW. To avoid
  // losing user-applied overrides on that identity shift, we collect every
  // soft-closed MISSING row up front and then, in the NEW insert path,
  // look for a similarity match (counterparty + description + amount) and
  // carry forward override fields from the closed predecessor.
  type ClosedPredecessor = {
    counterpartyName: string | null;
    description: string | null;
    amountExVat: any;
    adminDateOverride: any;
    adminDateOverrideReason: string | null;
    adminDateOverrideBy: any;
    adminDateOverrideAt: any;
    cosStatusOverride: any;
    cosStatusOverrideReason: string | null;
    cosStatusOverrideBy: any;
    cosStatusOverrideAt: any;
  };
  const closedPredecessors: ClosedPredecessor[] = [];
  const consumedPredecessorIdxs = new Set<number>();

  function normStr(s: any): string {
    return (s == null ? "" : String(s)).trim().toLowerCase();
  }
  function normAmt(v: any): string {
    if (v == null || v === "") return "";
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return String(v).trim();
    return n.toFixed(2);
  }
  function findPredecessor(f: Record<string, any>): ClosedPredecessor | null {
    const fa = normAmt(f.amountExVat);
    const fc = normStr(f.counterpartyName);
    const fd = normStr(f.description);
    for (let i = 0; i < closedPredecessors.length; i++) {
      if (consumedPredecessorIdxs.has(i)) continue;
      const p = closedPredecessors[i];
      if (
        normStr(p.counterpartyName) === fc &&
        normStr(p.description) === fd &&
        normAmt(p.amountExVat) === fa
      ) {
        consumedPredecessorIdxs.add(i);
        return p;
      }
    }
    return null;
  }

  // Per-row QB variances accumulated during this commit; flushed once at end.
  type PendingCostVariance = { appEntityId: number; variances: any[] };
  const qbCostVariancePending: PendingCostVariance[] = [];

  // PRE-PASS: process MISSING_FROM_UPLOAD rows first so the predecessor
  // pool is fully populated before any NEW row is inserted. matchRows()
  // emits NEW/CHANGED/UNCHANGED in file-row order and MISSING last, so
  // without this pre-pass findPredecessor() would always come up empty
  // for key-shift cases (the most common admin-override loss path).
  for (const mr of matchedRows) {
    if (mr.classification !== "MISSING_FROM_UPLOAD") continue;
    counts.missing++;
    if (mr.existingRowId == null) continue;

    // QB precedence: suppress soft-close if the row is QB-linked.
    if (qbPrecedenceOn) {
      const link = await lookupQbLink({ tx, appEntityType: "cost_line", appEntityId: mr.existingRowId });
      if (link) {
        qbCostVariancePending.push({
          appEntityId: mr.existingRowId,
          variances: [{
            field: "row",
            workbookValue: "missing",
            qbValue: link.qbDocNumber ?? link.qbEntityId,
            resolution: "missing_preserved",
            notes: `Row preserved because QB link ${link.id} is active`,
            qbLinkId: link.id,
            qbDocId: null,
            qbRealmId: link.qbRealmId,
          }],
        });
        continue;
      }
    }

    await tx.update(normalizedCostLines)
      .set({ effectiveTo: commitTimestamp })
      .where(eq(normalizedCostLines.id, mr.existingRowId));
    const er = (mr.existingRow ?? {}) as any;
    if (er.adminDateOverride || er.cosStatusOverride) {
      closedPredecessors.push({
        counterpartyName: er.counterpartyName ?? null,
        description: er.description ?? null,
        amountExVat: er.amountExVat,
        adminDateOverride: er.adminDateOverride ?? null,
        adminDateOverrideReason: er.adminDateOverrideReason ?? null,
        adminDateOverrideBy: er.adminDateOverrideBy ?? null,
        adminDateOverrideAt: er.adminDateOverrideAt ?? null,
        cosStatusOverride: er.cosStatusOverride ?? null,
        cosStatusOverrideReason: er.cosStatusOverrideReason ?? null,
        cosStatusOverrideBy: er.cosStatusOverrideBy ?? null,
        cosStatusOverrideAt: er.cosStatusOverrideAt ?? null,
      });
    }
  }

  for (const mr of matchedRows) {
    if (mr.classification === "UNCHANGED") {
      counts.unchanged++;
      continue;
    }
    if (mr.classification === "MISSING_FROM_UPLOAD") {
      // Already handled in pre-pass above.
      continue;
    }
    if (mr.classification === "NEW") {
      const f = mr.fileRow!;
      const carried = findPredecessor(f);
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
        // Carry forward admin overrides from a soft-closed predecessor row
        // when this NEW row is the same business entity under a shifted key.
        adminDateOverride: carried?.adminDateOverride ?? null,
        adminDateOverrideReason: carried?.adminDateOverrideReason ?? null,
        adminDateOverrideBy: carried?.adminDateOverrideBy ?? null,
        adminDateOverrideAt: carried?.adminDateOverrideAt ?? null,
        cosStatusOverride: carried?.cosStatusOverride ?? null,
        cosStatusOverrideReason: carried?.cosStatusOverrideReason ?? null,
        cosStatusOverrideBy: carried?.cosStatusOverrideBy ?? null,
        cosStatusOverrideAt: carried?.cosStatusOverrideAt ?? null,
      }).returning();
      insertedIds.push(inserted.id);
      counts.inserted++;
      continue;
    }

    if (mr.classification === "CHANGED" || mr.classification === "CONFLICT_PLACEHOLDER") {
      const existingId = mr.existingRowId!;
      const fileRow = mr.fileRow!;
      const rowUid = mr.rowUid ?? mr.businessKey.key;
      const mergeResult = mergeResults.get(rowUid) ?? mergeResults.get(mr.businessKey.key) ?? null;

      const fieldUpdates = resolveFieldValues(fileRow, mr.existingRow || {}, mergeResult, conflictDecisions, COMPARE_FIELDS);

      if (mergeResult) {
        counts.conflictsResolved += mergeResult.fields.filter(f => f.mergeCase === "CONFLICT").length;
      }

      // QB precedence: lock fields, force auto-realisation when QB shows
      // Paid, and surface variances. We track the link result so we can
      // re-point the QB link after the temporal insert below.
      let qbVariancesForRow: any[] = [];
      let qbLinkedRow = false;
      let qbForceCosRealised: boolean | null = null;
      if (qbPrecedenceOn) {
        const existingForProposed = (mr.existingRow ?? {}) as any;
        const proposed: Record<string, any> = {
          amountExVat: fieldUpdates.amountExVat ?? existingForProposed.amountExVat,
          invoiceNumber: fieldUpdates.invoiceNumber ?? existingForProposed.invoiceNumber,
          invoiceDate: fieldUpdates.invoiceDate ?? existingForProposed.invoiceDate,
          paidDate: fieldUpdates.paidDate ?? existingForProposed.paidDate,
          inBankDate: fieldUpdates.inBankDate ?? existingForProposed.inBankDate,
          cosRealised: existingForProposed.cosRealised,
        };
        const qbResult = await applyQbPrecedence({
          tx,
          appEntityType: "cost_line",
          appEntityId: existingId,
          proposedValues: proposed,
        });
        if (qbResult.isLinked) {
          qbLinkedRow = true;
          for (const f of qbResult.lockedFields) {
            if (qbResult.finalValues[f] !== undefined) fieldUpdates[f] = qbResult.finalValues[f];
          }
          qbVariancesForRow = qbResult.variances;
          // QB Paid → cosRealised must be true regardless of workbook flag.
          if (qbResult.autoRealised || qbResult.finalValues.cosRealised === true) {
            qbForceCosRealised = true;
          }
        }
      }

      if (Object.keys(fieldUpdates).length === 0 && qbVariancesForRow.length === 0) {
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
        // QB precedence override: when the row is QB-linked AND QB shows the doc as Paid,
        // force cosRealised=true even if the invoice-only rule would not (e.g. invoice number cleared).
        cosRealised: qbForceCosRealised === true
          ? true
          : !!((fieldUpdates.invoiceNumber ?? existing.invoiceNumber) && String(fieldUpdates.invoiceNumber ?? existing.invoiceNumber).trim()),
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
        // Carry forward app-owned fields (admin overrides survive re-imports
        // for CHANGED rows just as they do for the NEW key-shift path).
        noRevenueLinked: existing.noRevenueLinked,
        adminDateOverride: existing.adminDateOverride || null,
        adminDateOverrideReason: existing.adminDateOverrideReason || null,
        adminDateOverrideBy: existing.adminDateOverrideBy || null,
        adminDateOverrideAt: existing.adminDateOverrideAt || null,
        cosStatusOverride: existing.cosStatusOverride || null,
        cosStatusOverrideReason: existing.cosStatusOverrideReason || null,
        cosStatusOverrideBy: existing.cosStatusOverrideBy || null,
        cosStatusOverrideAt: existing.cosStatusOverrideAt || null,
        effectiveFrom: commitTimestamp,
        effectiveTo: null,
        snapshotRunId: runId,
      }).returning();
      insertedIds.push(inserted.id);
      updatedIds.push(existingId);
      counts.updated++;
      if (qbVariancesForRow.length > 0) {
        qbCostVariancePending.push({ appEntityId: inserted.id, variances: qbVariancesForRow });
      }
      // Re-point any active QB link from the soft-closed predecessor to
      // the new inserted row id so the gate keeps firing on the next
      // import. Without this, the link stays pinned to the dead row and
      // applyQbPrecedence becomes a no-op forever after.
      if (qbLinkedRow) {
        try {
          await repointQbLinks({
            tx,
            appEntityType: "cost_line",
            oldAppEntityId: existingId,
            newAppEntityId: inserted.id,
          });
        } catch (err) {
          console.error("[commit-executor] Failed to re-point QB link for cost:", err);
        }
      }
    }
  }

  // Flush QB variances. Failure to log MUST NOT fail the import.
  if (qbPrecedenceOn && qbCostVariancePending.length > 0) {
    try {
      for (const p of qbCostVariancePending) {
        await writeQbVariances({
          tx,
          importRunId: runId,
          projectId,
          appEntityType: "cost_line",
          appEntityId: p.appEntityId,
          variances: p.variances,
        });
      }
    } catch (err) {
      console.error("[commit-executor] Failed to log QB variances for cost:", err);
    }
  }

  return { canonicalSource: CANONICAL_SOURCES.EXPENDITURE, counts, insertedIds, updatedIds };
}
