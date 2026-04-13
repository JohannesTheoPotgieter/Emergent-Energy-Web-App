import { eq, and, isNull } from "drizzle-orm";
import { softCloseByProjectName } from "../lib/temporal-helpers";
import {
  normalizedRevenueLines, projectInfo,
  type ProgramInflows, type InsertProgramInflows,
} from "@shared/schema";
import { db } from "../db";

export class FinanceInflowsRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  async getAllProgramInflows(): Promise<any[]> {
    const { adaptRevenueToInflow, createNameResolver } = await import("../lib/data-merge");
    const [revLines, piRows] = await Promise.all([
      this.dbInstance.select().from(normalizedRevenueLines).where(isNull(normalizedRevenueLines.effectiveTo)),
      this.dbInstance.select({ projectName: projectInfo.projectName }).from(projectInfo),
    ]);
    const resolve = createNameResolver(piRows.map((r: any) => r.projectName));
    // Skip orphan rows with NULL project_name — they cannot be attributed.
    const attributed = revLines.filter((r: any) => typeof r.projectName === "string" && r.projectName.length > 0);
    const skipped = revLines.length - attributed.length;
    if (skipped > 0) {
      console.warn(`[getAllProgramInflows] Skipped ${skipped} revenue line(s) with NULL project_name`);
    }
    return attributed.map((r: any) => adaptRevenueToInflow(r, resolve(r.projectName)));
  }

  async getAllRevenueLinesForCashflow(): Promise<any[]> {
    // Canonical read: normalized_revenue_lines only, no promoted fallback complexity.
    // Aligns cashflow inflow reads with the canonical source.
    const { adaptRevenueToInflow, createNameResolver } = await import("../lib/data-merge");
    const [revLines, piRows] = await Promise.all([
      this.dbInstance.select().from(normalizedRevenueLines).where(isNull(normalizedRevenueLines.effectiveTo)),
      this.dbInstance.select({ projectName: projectInfo.projectName }).from(projectInfo),
    ]);
    const resolve = createNameResolver(piRows.map((r: any) => r.projectName));
    // Skip orphan rows with NULL project_name — they cannot be attributed and
    // would otherwise crash resolve() or contaminate cashflow totals.
    const attributed = revLines.filter((r: any) => typeof r.projectName === "string" && r.projectName.length > 0);
    const skipped = revLines.length - attributed.length;
    if (skipped > 0) {
      console.warn(`[getAllRevenueLinesForCashflow] Skipped ${skipped} revenue line(s) with NULL project_name`);
    }
    return attributed.map((r: any) => adaptRevenueToInflow(r, resolve(r.projectName)));
  }

  async getProgramInflowsByProject(projectName: string): Promise<any[]> {
    const { adaptRevenueToInflow } = await import("../lib/data-merge");
    const revLines = await this.dbInstance.select().from(normalizedRevenueLines)
      .where(and(eq(normalizedRevenueLines.projectName, projectName), isNull(normalizedRevenueLines.effectiveTo)));
    return revLines.map((r: any) => adaptRevenueToInflow(r, projectName));
  }

  async updateProgramInflowFields(id: number, fields: Record<string, any>): Promise<any | undefined> {
    const fieldMap: Record<string, string> = {
      milestoneInvoiceNumber: 'invoiceNumber',
      invoiceRaisedDate: 'invoiceDate',
      paymentReceivedDate: 'paidDate',
      plannedPaymentDate: 'expectedPaymentDate',
      milestoneAmount: 'amountExVat',
      milestoneName: 'milestoneName',
      milestoneNotes: 'description',
      invoiceDateFontColor: 'invoiceDateFontColor',
      invoiceDateConfirmed: 'invoiceDateConfirmed',
      paidDateFontColor: 'paidDateFontColor',
      paidDateConfirmed: 'paidDateConfirmed',
      inBankDate: 'inBankDate',
    };
    const mappedFields: Record<string, any> = {};
    for (const [key, value] of Object.entries(fields)) {
      const mapped = fieldMap[key] || key;
      mappedFields[mapped] = value;
    }
    if (Object.keys(mappedFields).length === 0) return undefined;
    const canonicalId = id < 0 ? -id : (id >= 900000 ? id - 900000 : id);
    const result = await this.dbInstance
      .update(normalizedRevenueLines)
      .set(mappedFields)
      .where(eq(normalizedRevenueLines.id, canonicalId))
      .returning();
    if (!result[0]) return undefined;
    const { adaptRevenueToInflow } = await import("../lib/data-merge");
    return adaptRevenueToInflow(result[0], result[0].projectName);
  }

  async createManyProgramInflows(inflowList: InsertProgramInflows[]): Promise<ProgramInflows[]> {
    if (inflowList.length === 0) return [];
    const mapped = inflowList.map((i: any) => ({
      projectName: i.projectName,
      milestoneName: i.milestoneName || null,
      description: i.milestoneName || null,
      amountExVat: i.milestoneAmount?.toString() || null,
      invoiceNumber: i.milestoneInvoiceNumber || null,
      invoiceDate: i.invoiceRaisedDate || null,
      expectedPaymentDate: i.plannedPaymentDate || null,
      paidDate: i.paymentReceivedDate || null,
      sourceRow: i.rowNumber || null,
      importRunId: 0,
    }));
    const results = await this.dbInstance.insert(normalizedRevenueLines).values(mapped).returning();
    const { adaptRevenueToInflow } = await import("../lib/data-merge");
    return results.map((r: any) => adaptRevenueToInflow(r, r.projectName)) as any;
  }

  async deleteProgramInflowsByProject(projectName: string): Promise<void> {
    // Temporal: soft-close instead of hard delete (Prompt 10)
    await softCloseByProjectName(this.dbInstance, "normalized_revenue_lines", projectName);
  }
}
