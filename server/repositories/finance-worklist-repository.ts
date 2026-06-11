/**
 * AR / AP / missing-invoice worklist repository — READ-ONLY.
 *
 * Composes the two canonical, snapshot-guarded line reads the cashflow surface
 * already uses, and runs them through the pure `ar-ap-worklist` engine. No new
 * finance math, no schema change, no write path — these are reporting views
 * (GP4). The frozen finance computation paths (line-level repository, cashflow
 * engine, QB matcher, recognition predicates, fy-window) are untouched.
 *
 *   AR  ← FinanceInflowsRepository.listAllActiveRevenueLines()  (normalized_revenue_lines)
 *   AP  ← FinanceExpenseEngineRepository.listAllActiveCostLines() (cost ⨝ actuals, line grain)
 *
 * Both reads filter `effectiveTo IS NULL` + `deletedAt IS NULL` (§ 3.1), so the
 * worklist rows tie to the same line population the COS / Revenue trackers read.
 */

import { isNull } from "drizzle-orm";
import { projectInfo } from "@shared/schema";
import { db } from "../db";
import { FinanceInflowsRepository } from "./finance-inflows-repository";
import { FinanceExpenseEngineRepository } from "./finance-expense-engine-repository";
import {
  buildMissingInvoices,
  buildPayables,
  buildReceivables,
  sastTodayIso,
  type AgedWorklist,
  type CostWorklistInput,
  type MissingInvoiceWorklist,
  type RevenueWorklistInput,
  type WorklistSourceRef,
} from "../lib/finance/ar-ap-worklist";

// Excel tracker column letters on the Expenditure Breakdown sheet, fixed by the
// workbook layout (mirrors TRACKER_COLUMNS in lib/finance/finance-drilldown.ts).
// Used to name a cost line's source cell for drill-to-source.
const EXP_COL = { invoiceNumber: "S", invoiceDate: "T", financePaymentDate: "W", actualTotal: "Q" } as const;

export interface WorklistQueryOptions {
  /** Restrict to these project names (matches the cashflow detail `?project=`). */
  projectNames?: string[] | null;
  /** As-at ISO date for aging. Defaults to the SAST calendar date. */
  asOf?: string;
}

export class FinanceWorklistRepository {
  private inflows: FinanceInflowsRepository;
  private expenses: FinanceExpenseEngineRepository;
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
    this.inflows = new FinanceInflowsRepository(dbInstance);
    this.expenses = new FinanceExpenseEngineRepository(dbInstance);
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  private async projectNameById(): Promise<Map<number, string>> {
    const rows = await this.dbInstance
      .select({ id: projectInfo.id, projectName: projectInfo.projectName })
      .from(projectInfo)
      .where(isNull(projectInfo.deletedAt));
    const map = new Map<number, string>();
    for (const r of rows) {
      if (r.id != null && typeof r.projectName === "string" && r.projectName.length > 0) {
        map.set(r.id, r.projectName);
      }
    }
    return map;
  }

  private async loadInputs(): Promise<{
    revenue: RevenueWorklistInput[];
    cost: CostWorklistInput[];
  }> {
    const [revRows, costRows, nameById] = await Promise.all([
      this.inflows.listAllActiveRevenueLines(),
      this.expenses.listAllActiveCostLines(),
      this.projectNameById(),
    ]);

    const resolveName = (row: { projectName?: string | null; projectId?: number | null }): string | null => {
      if (typeof row.projectName === "string" && row.projectName.length > 0) return row.projectName;
      if (row.projectId != null) return nameById.get(row.projectId) ?? null;
      return null;
    };

    const revenue: RevenueWorklistInput[] = revRows.map((r) => {
      const sourceSheet = r.sourceSheet ?? "Revenue Tracking";
      const source: WorklistSourceRef = {
        sourceSheet,
        sourceRow: r.sourceRow ?? null,
        // Revenue sheet column letters differ from the Expenditure Breakdown
        // layout, so surface the stored cell ref (importer / backfill-provenance)
        // rather than fabricating a letter.
        sourceCell: r.sourceCell ?? null,
      };
      return {
        lineId: r.id,
        projectId: r.projectId ?? null,
        projectName: resolveName(r),
        label: r.milestoneName ?? r.description ?? null,
        invoiceNumber: r.invoiceNumber ?? null,
        invoiceDate: r.invoiceDate != null ? String(r.invoiceDate) : null,
        amountExVat: r.amountExVat ?? null,
        paidDate: r.paidDate != null ? String(r.paidDate) : null,
        paidDateFontColor: r.paidDateFontColor ?? null,
        paidDateConfirmed: r.paidDateConfirmed ?? null,
        inBankDate: r.inBankDate != null ? String(r.inBankDate) : null,
        status: r.status ?? null,
        disputeOpenedAt: r.disputeOpenedAt ?? null,
        disputeResolvedAt: r.disputeResolvedAt ?? null,
        writeOffAuthorisedAt: r.writeOffAuthorisedAt ?? null,
        source,
      };
    });

    const cost: CostWorklistInput[] = costRows.map((row) => {
      const sourceSheet = row.sourceSheet ?? "Expenditure Breakdown";
      const sourceRow = row.sourceRow ?? null;
      const source: WorklistSourceRef = {
        sourceSheet,
        sourceRow,
        // Anchor on the invoice-number cell (col S) — the cost sheet layout is
        // fixed, so the cell ref is derivable from the row number.
        sourceCell: sourceRow != null ? `${EXP_COL.invoiceNumber}${sourceRow}` : null,
      };
      return {
        lineId: row.id,
        projectId: row.projectId ?? null,
        projectName: resolveName(row),
        supplierName: row.counterpartyName ?? null,
        label: row.description ?? row.costCategory ?? null,
        invoiceNumber: row.invoiceNumber ?? null,
        invoiceDate: row.invoiceDate != null ? String(row.invoiceDate) : null,
        amountExVat: row.amountExVat ?? null,
        paidDate: row.paidDate != null ? String(row.paidDate) : null,
        paidDateFontColor: row.paidDateFontColor ?? null,
        paidDateConfirmed: row.paidDateConfirmed ?? null,
        status: row.status ?? null,
        disputeOpenedAt: row.disputeOpenedAt ?? null,
        disputeResolvedAt: row.disputeResolvedAt ?? null,
        source,
      };
    });

    return { revenue, cost };
  }

  private filterByProject<T extends { projectName: string | null }>(
    rows: T[],
    projectNames?: string[] | null,
  ): T[] {
    if (!projectNames || projectNames.length === 0) return rows;
    const wanted = new Set(projectNames.map((n) => n.trim()).filter(Boolean));
    if (wanted.size === 0) return rows;
    return rows.filter((r) => r.projectName != null && wanted.has(r.projectName));
  }

  async getReceivables(opts: WorklistQueryOptions = {}): Promise<AgedWorklist> {
    const asOf = opts.asOf ?? sastTodayIso();
    const { revenue } = await this.loadInputs();
    return buildReceivables(this.filterByProject(revenue, opts.projectNames), asOf);
  }

  async getPayables(opts: WorklistQueryOptions = {}): Promise<AgedWorklist> {
    const asOf = opts.asOf ?? sastTodayIso();
    const { cost } = await this.loadInputs();
    return buildPayables(this.filterByProject(cost, opts.projectNames), asOf);
  }

  async getMissingInvoices(opts: WorklistQueryOptions = {}): Promise<MissingInvoiceWorklist> {
    const asOf = opts.asOf ?? sastTodayIso();
    const { revenue, cost } = await this.loadInputs();
    return buildMissingInvoices(
      this.filterByProject(revenue, opts.projectNames),
      this.filterByProject(cost, opts.projectNames),
      asOf,
    );
  }
}
