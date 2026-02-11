import { db } from "../db";
import { programExpense, programInflows, projectInfo, type ProjectInfo } from "@shared/schema";
import { eq, isNull, sql } from "drizzle-orm";
import { classifyExpenseState } from "./calculations/stateClassifier";
import { computeExpenseLineHash, computeInflowLineHash } from "./calculations/hashing";
import { forecastExpensePaymentDate, forecastInflowReceiptDate } from "./calculations/forecaster";
import { extractSupplierName } from "./calculations/supplierExtractor";

async function getProjectMap(): Promise<Map<string, ProjectInfo>> {
  const projects = await db.select().from(projectInfo);
  return new Map(projects.map((p: ProjectInfo) => [p.projectName, p]));
}

export async function backfillExpenseComputedFields(): Promise<{ updated: number }> {
  const expenses = await db.select().from(programExpense).where(isNull(programExpense.expenseLineHash));
  const projectMap = await getProjectMap();

  let updated = 0;
  const batchSize = 200;

  for (let i = 0; i < expenses.length; i += batchSize) {
    const batch = expenses.slice(i, i + batchSize);

    for (const exp of batch) {
      const state = classifyExpenseState({
        expensePaymentDate: exp.expensePaymentDate,
        expenseInvoiceNumber: exp.expenseInvoiceNumber,
        expenseInvoicedDate: exp.expenseInvoicedDate,
        expensePoNumber: exp.expensePoNumber,
      });

      const hash = computeExpenseLineHash({
        projectName: exp.projectName,
        expenseCategory: exp.expenseCategory,
        expenseLineItem: exp.expenseLineItem,
        expenseActualTotal: exp.expenseActualTotal,
        expenseInvoicedDate: exp.expenseInvoicedDate,
        expenseInvoiceNumber: exp.expenseInvoiceNumber,
        rowNumber: exp.rowNumber,
      });

      const proj = projectMap.get(exp.projectName);
      const forecastDate = forecastExpensePaymentDate({
        expensePaymentDate: exp.expensePaymentDate,
        expenseInvoicedDate: exp.expenseInvoicedDate,
        expensePoNumber: exp.expensePoNumber,
        forecastPaymentDate: exp.forecastPaymentDate,
        constructionStart: proj?.constructionStartDate ?? null,
        commissioningDate: proj?.commissioningDate ?? null,
      }, 30);

      const supplier = extractSupplierName(exp.expenseInvoiceNumber);

      await db.update(programExpense)
        .set({
          expenseLineHash: hash,
          computedState: state,
          computedForecastPaymentDate: forecastDate,
          supplierName: supplier,
        })
        .where(eq(programExpense.id, exp.id));

      updated++;
    }
  }

  return { updated };
}

export async function backfillInflowComputedFields(): Promise<{ updated: number }> {
  const inflows = await db.select().from(programInflows).where(isNull(programInflows.inflowLineHash));

  const projectMap = await getProjectMap();

  let updated = 0;

  for (const inf of inflows) {
    const hash = computeInflowLineHash({
      projectName: inf.projectName,
      milestoneName: inf.milestoneName,
      milestoneAmount: inf.milestoneAmount,
      invoiceRaisedDate: inf.invoiceRaisedDate,
      milestoneInvoiceNumber: inf.milestoneInvoiceNumber,
      rowNumber: inf.rowNumber,
    });

    const proj = projectMap.get(inf.projectName);
    const forecastDate = forecastInflowReceiptDate({
      paymentReceivedDate: inf.paymentReceivedDate,
      invoiceRaisedDate: inf.invoiceRaisedDate,
      plannedPaymentDate: inf.plannedPaymentDate,
      commissioningDate: proj?.commissioningDate ?? null,
    }, 30);

    await db.update(programInflows)
      .set({
        inflowLineHash: hash,
        computedForecastReceiptDate: forecastDate,
      })
      .where(eq(programInflows.id, inf.id));

    updated++;
  }

  return { updated };
}

export async function runBackfill(): Promise<void> {
  try {
    console.log('[Backfill] Starting computed field backfill...');
    const expResult = await backfillExpenseComputedFields();
    console.log(`[Backfill] Updated ${expResult.updated} expense rows`);
    const infResult = await backfillInflowComputedFields();
    console.log(`[Backfill] Updated ${infResult.updated} inflow rows`);
    console.log('[Backfill] Complete');
  } catch (err) {
    console.error('[Backfill] Error:', err);
  }
}
