import { eq, and, isNotNull, isNull } from "drizzle-orm";
import { softCloseByProjectName } from "../lib/temporal-helpers";
import { selectWinningExpenseRows } from "../lib/expense-row-selector";
import { computeCostEvidence } from "../lib/finance/qb-allocation";
import { getAssignedEvidenceByCostLineIds } from "../lib/finance/qb-allocation-read";
import {
  normalizedCostLines, projectInfo,
  type ProgramExpense, type InsertProgramExpense,
} from "@shared/schema";
import { db } from "../db";

/**
 * Resolve a project name for every cost-line row, falling back from the row's
 * own project_name TEXT column to a project_id → project_info lookup.
 *
 * Background: the database has a large population of legacy NCL rows imported
 * before normalized_cost_lines.project_name was tightened to NOT NULL. Those
 * rows carry a valid project_id FK but a NULL project_name text value. The
 * previous filter dropped them entirely, which made cashflow Total Outflows
 * miss ~60% of the real cost data on the dev environment.
 *
 * Returns an array of { row, name } pairs ready for adaptCostToExpense.
 * Truly orphan rows (no project_name AND no project_id match) are still
 * skipped because they can't be attributed to any project at all.
 */
function resolveCostRowProjectNames(
  costLines: any[],
  piRows: Array<{ id: number; projectName: string | null }>,
  logTag: string,
): Array<{ row: any; name: string }> {
  const idToName = new Map<number, string>();
  for (const p of piRows) {
    if (p.id != null && typeof p.projectName === "string" && p.projectName.length > 0) {
      idToName.set(p.id, p.projectName);
    }
  }

  const out: Array<{ row: any; name: string }> = [];
  let resolvedFromId = 0;
  let trulyOrphan = 0;
  for (const c of costLines) {
    let name: string | null = null;
    if (typeof c.projectName === "string" && c.projectName.length > 0) {
      name = c.projectName;
    } else if (c.projectId != null) {
      const fallback = idToName.get(c.projectId);
      if (fallback) {
        name = fallback;
        resolvedFromId++;
      }
    }
    if (!name) {
      trulyOrphan++;
      continue;
    }
    out.push({ row: c, name });
  }

  if (trulyOrphan > 0 || resolvedFromId > 0) {
    console.warn(
      `${logTag} processed ${costLines.length} cost rows: ${out.length} attributed (${resolvedFromId} resolved via project_id fallback), ${trulyOrphan} truly orphan (no project_name and no project_id match)`,
    );
  }

  return out;
}

export class FinanceExpenseEngineRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  /**
   * Core implementation for getAllProgramExpenses — called by DatabaseStorage
   * through the cache wrapper. DO NOT call this directly from routes.
   *
   * Reads normalized_cost_lines only. The legacy program_expense overlay
   * was retired in the PE/PI cutover; every budget/admin-override value
   * lives on NCL directly after migration 20260414_backfill_ncl_budget_from_pe.sql.
   */
  async fetchAllProgramExpenses(): Promise<any[]> {
    const { adaptCostToExpense, createNameResolver } = await import("../lib/data-merge");
    const [costLines, piRows] = await Promise.all([
      this.dbInstance.select().from(normalizedCostLines).where(isNull(normalizedCostLines.effectiveTo)),
      this.dbInstance.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo),
    ]);
    const resolve = createNameResolver(piRows.map((r: any) => r.projectName));

    const enrichedRows = await this.attachAllocationEvidence(costLines as any[]);
    const attributed = resolveCostRowProjectNames(enrichedRows as any[], piRows as any[], "[fetchAllProgramExpenses]");
    const adaptedNormalized = attributed.map(({ row, name }) => adaptCostToExpense(row, resolve(name)));

    // Deterministic winner per business line across normalized rows (handles
    // any residual duplicates from temporal history or re-imports).
    const selected = selectWinningExpenseRows(adaptedNormalized);
    console.log(
      `[getAllProgramExpenses] Selected winners: ${selected.diagnostics.totalInput} → ${selected.diagnostics.winners}` +
      ` (removed ${selected.diagnostics.duplicatesRemoved} duplicates)`,
    );
    return selected.winners;
  }

  /**
   * Canonical cashflow cost read — NCL only, NO PE overlay.
   * Intentionally separate from fetchAllProgramExpenses.
   */
  async getAllCostLinesForCashflow(): Promise<any[]> {
    const { adaptCostToExpense, createNameResolver } = await import("../lib/data-merge");
    const [costLines, piRows] = await Promise.all([
      this.dbInstance.select().from(normalizedCostLines).where(isNull(normalizedCostLines.effectiveTo)),
      this.dbInstance.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo),
    ]);
    const resolve = createNameResolver(piRows.map((r: any) => r.projectName));

    const enrichedRows = await this.attachAllocationEvidence(costLines as any[]);
    const attributed = resolveCostRowProjectNames(enrichedRows as any[], piRows as any[], "[getAllCostLinesForCashflow]");
    const adapted = attributed.map(({ row, name }) => adaptCostToExpense(row, resolve(name)));
    const { winners, diagnostics } = selectWinningExpenseRows(adapted);
    console.log(`[getAllCostLinesForCashflow] ${costLines.length} active NCL → ${adapted.length} adapted → ${winners.length} after dedup (removed ${diagnostics.duplicatesRemoved})`);
    return winners;
  }

  /**
   * Per-project expense read with carry-forward from closed NCL rows.
   * The legacy program_expense overlay was retired in the PE/PI cutover;
   * budget columns now come directly from normalized_cost_lines.
   */
  async getProgramExpensesByProject(projectName: string): Promise<any[]> {
    const { adaptCostToExpense } = await import("../lib/data-merge");
    // Resolve project_id for the requested name so we also catch legacy rows
    // where project_name is NULL but project_id is set.
    const projectMatches = await this.dbInstance.select({ id: projectInfo.id })
      .from(projectInfo)
      .where(eq(projectInfo.projectName, projectName));
    const projectIds = projectMatches.map((p: { id: number }) => p.id);

    const allActive = await this.dbInstance.select().from(normalizedCostLines)
      .where(isNull(normalizedCostLines.effectiveTo));

    const costLines = (allActive as any[]).filter((c: any) => {
      if (typeof c.projectName === "string" && c.projectName.length > 0 && c.projectName === projectName) {
        return true;
      }
      if (c.projectId != null && projectIds.includes(c.projectId)) {
        return true;
      }
      return false;
    });

    const enrichedRows = await this.attachAllocationEvidence(costLines as any[]);
    const adapted = enrichedRows.map((c: any) => adaptCostToExpense(c, projectName));

    const needsCarryForward = adapted.some((a: any) => !a.expensePaymentDate && !a.forecastPaymentDate);
    if (needsCarryForward) {
      const closedLines = await this.dbInstance.select().from(normalizedCostLines)
        .where(and(
          eq(normalizedCostLines.projectName, projectName),
          isNotNull(normalizedCostLines.effectiveTo),
        ));
      const priorByRow = new Map<number, any>();
      for (const cl of closedLines) {
        const row = (cl as any).sourceRow;
        if (row == null) continue;
        const payDate = cl.paidDate || (cl as any).forecastPaymentDate;
        if (!payDate) continue;
        const existing = priorByRow.get(row);
        if (!existing || (cl.id > existing.id)) {
          priorByRow.set(row, cl);
        }
      }
      for (const item of adapted) {
        if (!item.expensePaymentDate && !item.forecastPaymentDate) {
          const prior = priorByRow.get(item.rowNumber);
          if (prior) {
            const priorDate = prior.paidDate || (prior as any).forecastPaymentDate;
            if (priorDate) {
              item.expensePaymentDate = priorDate;
              item.forecastPaymentDate = priorDate;
              item.paymentDateFontColor = prior.paidDateFontColor || "red";
              item.paymentDateConfirmed = prior.paidDateConfirmed ?? false;
              item._carryForward = true;
            }
          }
        }
      }
    }

    const selected = selectWinningExpenseRows(adapted);
    return selected.winners;
  }

  async createManyProgramExpenses(expenseList: InsertProgramExpense[]): Promise<ProgramExpense[]> {
    if (expenseList.length === 0) return [];
    const mapped = expenseList.map((e: any) => ({
      projectName: e.projectName,
      costCategory: e.expenseCategory || null,
      description: e.expenseLineItem || null,
      amountExVat: e.expenseActualTotal?.toString() || null,
      invoiceNumber: e.expenseInvoiceNumber || null,
      invoiceDate: e.expenseInvoicedDate || null,
      invoiceDateConfirmed: e.invoiceDateConfirmed ?? null,
      invoiceDateFontColor: e.invoiceDateFontColor || null,
      paidDate: e.expensePaymentDate || null,
      paidDateConfirmed: e.paymentDateConfirmed ?? null,
      paidDateFontColor: e.paymentDateFontColor || null,
      poNumber: e.expensePoNumber || null,
      counterpartyName: e.supplierName || null,
      sourceRow: e.rowNumber || null,
    }));
    const results = await this.dbInstance.insert(normalizedCostLines).values(mapped).returning();
    const { adaptCostToExpense } = await import("../lib/data-merge");
    return results.map((r: any) => adaptCostToExpense(r, r.projectName)) as any;
  }

  private async attachAllocationEvidence(costLines: any[]): Promise<any[]> {
    if (!Array.isArray(costLines) || costLines.length === 0) return costLines;
    const assignedByCostLineId = await getAssignedEvidenceByCostLineIds(costLines.map((c: any) => Number(c.id)));
    return costLines.map((row: any) => {
      const lineAmount = Number(row.amountExVat ?? 0);
      const assigned = assignedByCostLineId.get(Number(row.id)) ?? 0;
      const evidence = computeCostEvidence(
        Number.isFinite(lineAmount) ? lineAmount : 0,
        Number.isFinite(assigned) ? assigned : 0,
      );
      return {
        ...row,
        lineAssignedQbExVat: assigned,
        lineRealisedAmountExVat: evidence.lineRealisedAmountExVat,
        lineUnrealisedRemainderExVat: evidence.lineUnrealisedRemainderExVat,
      };
    });
  }

  async deleteProgramExpensesByProject(projectName: string): Promise<void> {
    // Temporal: soft-close instead of hard delete (Prompt 10)
    await softCloseByProjectName(this.dbInstance, "normalized_cost_lines", projectName);
  }

  async updateProgramExpenseFields(id: number, fields: Record<string, any>, expectedUpdatedAt?: string): Promise<ProgramExpense | undefined> {
    const mappedFields: Record<string, any> = {};
    const fieldMap: Record<string, string> = {
      expenseCategory: 'costCategory',
      expenseLineItem: 'description',
      expenseActualTotal: 'amountExVat',
      expenseInvoiceNumber: 'invoiceNumber',
      expenseInvoicedDate: 'invoiceDate',
      expensePaymentDate: 'paidDate',
      expensePoNumber: 'poNumber',
      supplierName: 'counterpartyName',
      invoiceDateConfirmed: 'invoiceDateConfirmed',
      invoiceDateFontColor: 'invoiceDateFontColor',
      paymentDateConfirmed: 'paidDateConfirmed',
      paymentDateFontColor: 'paidDateFontColor',
      noRevenueLinked: 'noRevenueLinked',
      cosStatusOverride: 'cosStatusOverride',
      cosStatusOverrideBy: 'cosStatusOverrideBy',
      cosStatusOverrideAt: 'cosStatusOverrideAt',
      cosStatusOverrideReason: 'cosStatusOverrideReason',
    };
    const validDbColumns = new Set(Object.values(fieldMap));
    for (const [key, value] of Object.entries(fields)) {
      const mapped = fieldMap[key] || key;
      if (validDbColumns.has(mapped) || Object.keys(normalizedCostLines).includes(mapped)) {
        mappedFields[mapped] = value;
      }
    }
    if (Object.keys(mappedFields).length === 0) {
      return undefined;
    }
    const canonicalId = id < 0 ? -id : (id >= 900000 ? id - 900000 : id);

    // Optimistic locking: if caller provides expectedUpdatedAt, verify row hasn't changed
    if (expectedUpdatedAt) {
      const [current] = await this.dbInstance
        .select({ updatedAt: normalizedCostLines.updatedAt })
        .from(normalizedCostLines)
        .where(eq(normalizedCostLines.id, canonicalId))
        .limit(1);
      if (current?.updatedAt) {
        const currentTs = new Date(current.updatedAt).getTime();
        const expectedTs = new Date(expectedUpdatedAt).getTime();
        if (currentTs !== expectedTs) {
          const err = new Error("Row was modified by another user. Please refresh and try again.");
          (err as any).status = 409;
          throw err;
        }
      }
    }

    mappedFields.updatedAt = new Date();

    const result = await this.dbInstance
      .update(normalizedCostLines)
      .set(mappedFields)
      .where(eq(normalizedCostLines.id, canonicalId))
      .returning();
    if (!result[0]) return undefined;
    const { adaptCostToExpense } = await import("../lib/data-merge");
    return adaptCostToExpense(result[0], result[0].projectName) as any;
  }

  async createManualExpense(data: InsertProgramExpense & { idempotencyKey?: string; projectId?: number; projectName?: string }): Promise<ProgramExpense> {
    const d = data as any;
    // Resolve projectId from projectName if not explicitly provided.
    let resolvedProjectId = d.projectId ?? null;
    if (!resolvedProjectId && d.projectName) {
      const [pi] = await this.dbInstance.select({ id: projectInfo.id })
        .from(projectInfo)
        .where(eq(projectInfo.projectName, d.projectName))
        .limit(1);
      if (pi) resolvedProjectId = pi.id;
    }

    // POLICY: Manual expenses MUST have a valid project assignment.
    // Without projectId, expenses are invisible to dashboards and break finance integrity.
    if (!resolvedProjectId) {
      throw new Error("Manual expense requires a valid projectId. Cannot save an expense without a project assignment.");
    }

    const mapped: Record<string, any> = {
      projectName: d.projectName,
      projectId: resolvedProjectId,
      costCategory: d.expenseCategory || null,
      description: d.expenseLineItem || null,
      amountExVat: d.expenseActualTotal?.toString() || null,
      invoiceNumber: d.expenseInvoiceNumber || null,
      invoiceDate: d.expenseInvoicedDate || null,
      invoiceDateConfirmed: d.invoiceDateConfirmed ?? null,
      invoiceDateFontColor: d.invoiceDateFontColor || null,
      paidDate: d.expensePaymentDate || null,
      paidDateConfirmed: d.paymentDateConfirmed ?? null,
      paidDateFontColor: d.paymentDateFontColor || null,
      poNumber: d.expensePoNumber || null,
      counterpartyName: d.supplierName || null,
      sourceRow: d.rowNumber || null,
    };
    if (data.idempotencyKey) {
      mapped.idempotencyKey = data.idempotencyKey;
    }
    const inserted = await this.dbInstance.insert(normalizedCostLines).values(mapped).returning();
    const { adaptCostToExpense } = await import("../lib/data-merge");
    return adaptCostToExpense(inserted[0], inserted[0].projectName) as any;
  }
}
