/**
 * Post-Commit Derivative Materializer (S12)
 *
 * After a v2 incremental commit writes to canonical tables, this materializer
 * refreshes the legacy derivative tables (program_expense, program_inflows,
 * project_revenue_summary) so that consumers not yet migrated to canonical
 * reads still see fresh data.
 *
 * This is a COMPATIBILITY mechanism, not a source of finance truth. The
 * canonical tables (normalized_cost_lines, normalized_revenue_lines) are
 * the authoritative source. The derivatives here reproduce v1 behavior
 * for backward compatibility only.
 *
 * Once all consumers migrate to canonical reads, this materializer is removed.
 */

import type { NormalizationResult } from "./normalizer";
import { softCloseByProjectName } from "../temporal-helpers";
import { addTemporalColumns } from "../temporal-helpers";
import {
  programExpense,
  programInflows,
  projectRevenueSummary,
  normalizedCostLines,
  normalizedRevenueLines,
} from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";

export interface MaterializerContext {
  tx: any;
  projectId: number;
  projectName: string;
  runId: number;
  commitTimestamp: Date;
  norm: NormalizationResult;
}

export interface MaterializerResult {
  programInflowsWritten: number;
  programExpenseWritten: number;
  projectRevenueSummaryUpdated: boolean;
}

/**
 * Materialize derivative tables from canonical data after v2 commit.
 *
 * Reads active rows from normalized_cost_lines and normalized_revenue_lines
 * (the rows just written/unchanged by the v2 incremental commit) and
 * produces program_expense, program_inflows, and project_revenue_summary
 * rows that match what v1 would have written.
 */
export async function materializeDerivatives(ctx: MaterializerContext): Promise<MaterializerResult> {
  const { tx, projectId, projectName, runId, commitTimestamp, norm } = ctx;
  const result: MaterializerResult = {
    programInflowsWritten: 0,
    programExpenseWritten: 0,
    projectRevenueSummaryUpdated: false,
  };

  // ── Program Inflows (from active NRL rows) ──
  if (norm.revenueLines && norm.revenueLines.length > 0) {
    // Read current active NRL rows (just committed by v2)
    const activeNrl = await tx.select()
      .from(normalizedRevenueLines)
      .where(and(eq(normalizedRevenueLines.projectId, projectId), isNull(normalizedRevenueLines.effectiveTo)));

    // Read old PI rows for status carry-forward
    const oldPiRows = await tx.select({
      rowNumber: programInflows.rowNumber,
      inBank: programInflows.inBank,
      paymentReceivedDate: programInflows.paymentReceivedDate,
      milestoneName: programInflows.milestoneName,
      milestoneAmount: programInflows.milestoneAmount,
      source: programInflows.source,
    }).from(programInflows)
      .where(and(eq(programInflows.projectName, projectName), isNull(programInflows.effectiveTo)));

    const oldCompositeMap = new Map<string, { inBank: number | null; paymentReceivedDate: string | null; source: string | null }>();
    const oldRowMap = new Map<number, { inBank: number | null; paymentReceivedDate: string | null; source: string | null }>();
    for (const r of oldPiRows) {
      if (r.rowNumber != null) {
        oldRowMap.set(r.rowNumber, { inBank: r.inBank, paymentReceivedDate: r.paymentReceivedDate, source: r.source || null });
      }
      if (r.milestoneName) {
        const key = `${r.milestoneName}::${r.milestoneAmount || ""}`;
        oldCompositeMap.set(key, { inBank: r.inBank, paymentReceivedDate: r.paymentReceivedDate, source: r.source || null });
      }
    }

    // Soft-close existing PI rows
    await softCloseByProjectName(tx, "program_inflows", projectName);

    // Build new PI rows from active NRL
    let milestoneIdx = 0;
    const piValues: any[] = [];
    for (const nrl of activeNrl) {
      milestoneIdx++;
      const name = nrl.milestoneName || nrl.description || null;
      const amount = nrl.amountExVat ? String(nrl.amountExVat) : null;

      // Carry forward inBank/paymentReceivedDate from old PI rows (composite key match, then row number fallback)
      let prevInBank: number | null | undefined = undefined;
      let prevPaymentReceivedDate: string | null | undefined = undefined;
      const compositeKey = name ? `${name}::${amount || ""}` : null;
      if (compositeKey && oldCompositeMap.has(compositeKey)) {
        const match = oldCompositeMap.get(compositeKey)!;
        prevInBank = match.inBank;
        prevPaymentReceivedDate = match.paymentReceivedDate;
      }
      if (prevInBank === undefined && nrl.sourceRow != null && oldRowMap.has(nrl.sourceRow)) {
        const rowMatch = oldRowMap.get(nrl.sourceRow)!;
        prevInBank = rowMatch.inBank ?? null;
        prevPaymentReceivedDate = rowMatch.paymentReceivedDate ?? null;
      }

      const paidDateIsBlack = nrl.paidDateConfirmed === true;
      const derivedInBank = nrl.paidDate ? (paidDateIsBlack ? 1 : 0) : 0;

      piValues.push({
        projectName,
        rowNumber: nrl.sourceRow,
        milestoneNo: String(milestoneIdx),
        milestoneName: name,
        milestoneAmount: amount,
        plannedPaymentDate: nrl.expectedPaymentDate || null,
        milestoneInvoiceNumber: nrl.invoiceNumber || null,
        invoiceRaisedDate: nrl.invoiceDate || null,
        paymentReceivedDate: prevPaymentReceivedDate ?? (nrl.paidDate || null),
        inBank: prevInBank != null ? prevInBank : derivedInBank,
        subProjectName: nrl.subProjectName || null,
        dataSource: "SMART_IMPORT",
        projectId,
        importRunId: runId,
      });
    }

    if (piValues.length > 0) {
      await tx.insert(programInflows).values(addTemporalColumns(piValues, runId, commitTimestamp) as any);
      result.programInflowsWritten = piValues.length;
    }
  }

  // ── Program Expense (from active NCL rows) ──
  if (norm.costLines && norm.costLines.length > 0) {
    // Read old PE rows for status carry-forward
    const oldPeRows = await tx.select({
      id: programExpense.id,
      rowNumber: programExpense.rowNumber,
      source: programExpense.source,
      expensePaymentDate: programExpense.expensePaymentDate,
      paymentDateConfirmed: programExpense.paymentDateConfirmed,
      paymentDateFontColor: programExpense.paymentDateFontColor,
    }).from(programExpense)
      .where(and(eq(programExpense.projectName, projectName), isNull(programExpense.effectiveTo)));

    // Soft-close existing PE rows
    await softCloseByProjectName(tx, "program_expense", projectName);

    // Read active NCL rows
    const activeNcl = await tx.select()
      .from(normalizedCostLines)
      .where(and(eq(normalizedCostLines.projectId, projectId), isNull(normalizedCostLines.effectiveTo)));

    const oldPeByRow = new Map<number, any>(
      oldPeRows.filter((r: any) => r.rowNumber != null).map((r: any) => [r.rowNumber as number, r]),
    );
    const toStr = (v: any): string | null => v != null ? String(v) : null;

    const peValues: any[] = [];
    let currentCategory = "";
    for (const ncl of activeNcl) {
      const previous = ncl.sourceRow != null ? oldPeByRow.get(ncl.sourceRow) : undefined;
      const preserveManualRow = previous?.source === "imported_edited";
      const expensePaymentDate = preserveManualRow
        ? (previous?.expensePaymentDate || null)
        : (ncl.paidDate || null);
      const paymentDateFontColor = preserveManualRow
        ? (previous?.paymentDateFontColor || null)
        : (ncl.paidDateFontColor || null);
      if (ncl.costCategory && ncl.costCategory !== currentCategory) currentCategory = ncl.costCategory;

      peValues.push({
        projectName,
        rowNumber: ncl.sourceRow,
        rowType: "item" as const,
        expenseCategory: currentCategory || ncl.costCategory || null,
        expenseLineItem: ncl.description || null,
        budgetQty: toStr(ncl.budgetQty),
        budgetRateUnit: toStr(ncl.budgetRate),
        budgetTotal: toStr(ncl.budgetTotal),
        budgetCosTotal: toStr(ncl.budgetCos),
        forecastPaymentDate: ncl.forecastPaymentDate || null,
        expenseActualTotal: toStr(ncl.amountExVat),
        expensePoNumber: ncl.poNumber || null,
        expenseInvoiceNumber: ncl.invoiceNumber || null,
        expenseInvoicedDate: ncl.invoiceDate || null,
        invoiceDateFontColor: ncl.invoiceDateFontColor || null,
        invoiceDateConfirmed: ncl.invoiceDateFontColor === "black",
        expensePaymentDate,
        paymentDateFontColor,
        paymentDateConfirmed: ncl.paidDateFontColor === "black",
        subProjectName: ncl.subProjectName || null,
        dataSource: "SMART_IMPORT",
        projectId,
        importRunId: runId,
      });
    }

    if (peValues.length > 0) {
      await tx.insert(programExpense).values(addTemporalColumns(peValues, runId, commitTimestamp) as any);
      result.programExpenseWritten = peValues.length;
    }
  }

  // ── Project Revenue Summary (from costedSummary) ──
  if (norm.costedSummary && projectName) {
    const cs = norm.costedSummary;
    const hasData = cs.plannedRevenue != null || cs.plannedExpenditure != null;
    if (hasData) {
      const [existing] = await tx.select({ id: projectRevenueSummary.id })
        .from(projectRevenueSummary)
        .where(eq(projectRevenueSummary.projectName, projectName))
        .limit(1);
      const vals: Record<string, any> = {};
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
          .where(eq(projectRevenueSummary.id, existing.id));
      } else {
        await tx.insert(projectRevenueSummary).values(addTemporalColumns({ projectName, projectId, ...vals }, runId, commitTimestamp) as any);
      }
      result.projectRevenueSummaryUpdated = true;
    }
  }

  return result;
}
