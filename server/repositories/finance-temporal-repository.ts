import { eq, desc, and, isNull } from "drizzle-orm";
import { softCloseByProjectName, addTemporalColumns } from "../lib/temporal-helpers";
import {
  cashflowPoints, financeRevenueMonthly, financeCosMonthly,
  projectRevenueSummary,
  type CashflowPoint, type InsertCashflowPoint,
  type FinanceRevenueMonthly, type InsertFinanceRevenueMonthly,
  type FinanceCosMonthly, type InsertFinanceCosMonthly,
  type ProjectRevenueSummary, type InsertProjectRevenueSummary,
} from "@shared/schema";
import { db } from "../db";

export class FinanceTemporalRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  // Cashflow Points
  async getAllCashflowPoints(): Promise<CashflowPoint[]> {
    return this.dbInstance.select().from(cashflowPoints).where(isNull(cashflowPoints.effectiveTo)).orderBy(desc(cashflowPoints.createdAt));
  }

  async getCashflowPointsByProject(projectName: string): Promise<CashflowPoint[]> {
    return this.dbInstance.select().from(cashflowPoints).where(and(eq(cashflowPoints.projectName, projectName), isNull(cashflowPoints.effectiveTo)));
  }

  async createManyCashflowPoints(pointList: InsertCashflowPoint[]): Promise<CashflowPoint[]> {
    if (pointList.length === 0) return [];
    // Explicitly provide timestamp for SQLite compatibility
    const now = new Date();
    const withTimestamps = pointList.map(p => ({ ...p, createdAt: now }));

    // Batch inserts to avoid SQLite variable limit (max ~999 variables, each row has ~6 fields)
    const batchSize = 100;
    const results: CashflowPoint[] = [];
    for (let i = 0; i < withTimestamps.length; i += batchSize) {
      const batch = withTimestamps.slice(i, i + batchSize);
      const batchResults = await this.dbInstance.insert(cashflowPoints).values(batch).returning();
      results.push(...batchResults);
    }
    return results;
  }

  async deleteCashflowPointsByProject(projectName: string): Promise<void> {
    // Temporal: soft-close instead of hard delete (Prompt 10)
    await softCloseByProjectName(this.dbInstance, "cashflow_points", projectName);
  }

  // Finance Revenue Monthly
  async getAllFinanceRevenueMonthly(): Promise<FinanceRevenueMonthly[]> {
    return this.dbInstance.select().from(financeRevenueMonthly).where(isNull(financeRevenueMonthly.effectiveTo)).orderBy(desc(financeRevenueMonthly.createdAt));
  }

  async getFinanceRevenueMonthlyByProject(projectName: string): Promise<FinanceRevenueMonthly[]> {
    return this.dbInstance.select().from(financeRevenueMonthly).where(and(eq(financeRevenueMonthly.projectName, projectName), isNull(financeRevenueMonthly.effectiveTo)));
  }

  async createManyFinanceRevenueMonthly(dataList: InsertFinanceRevenueMonthly[]): Promise<FinanceRevenueMonthly[]> {
    if (dataList.length === 0) return [];
    // Explicitly provide timestamp for SQLite compatibility
    const now = new Date();
    const withTimestamps = dataList.map(d => ({ ...d, createdAt: now }));

    // Batch inserts to avoid SQLite variable limit
    const batchSize = 100;
    const results: FinanceRevenueMonthly[] = [];
    for (let i = 0; i < withTimestamps.length; i += batchSize) {
      const batch = withTimestamps.slice(i, i + batchSize);
      const batchResults = await this.dbInstance.insert(financeRevenueMonthly).values(batch).returning();
      results.push(...batchResults);
    }
    return results;
  }

  async deleteFinanceRevenueMonthlyByProject(projectName: string): Promise<void> {
    // Temporal: soft-close instead of hard delete (Prompt 10)
    await softCloseByProjectName(this.dbInstance, "finance_revenue_monthly", projectName);
  }

  // Finance COS Monthly
  async getAllFinanceCosMonthly(): Promise<FinanceCosMonthly[]> {
    return this.dbInstance.select().from(financeCosMonthly).where(isNull(financeCosMonthly.effectiveTo)).orderBy(desc(financeCosMonthly.createdAt));
  }

  async getFinanceCosMonthlyByProject(projectName: string): Promise<FinanceCosMonthly[]> {
    return this.dbInstance.select().from(financeCosMonthly).where(and(eq(financeCosMonthly.projectName, projectName), isNull(financeCosMonthly.effectiveTo)));
  }

  async createManyFinanceCosMonthly(dataList: InsertFinanceCosMonthly[]): Promise<FinanceCosMonthly[]> {
    if (dataList.length === 0) return [];
    // Explicitly provide timestamp for SQLite compatibility
    const now = new Date();
    const withTimestamps = dataList.map(d => ({ ...d, createdAt: now }));

    // Batch inserts to avoid SQLite variable limit
    const batchSize = 100;
    const results: FinanceCosMonthly[] = [];
    for (let i = 0; i < withTimestamps.length; i += batchSize) {
      const batch = withTimestamps.slice(i, i + batchSize);
      const batchResults = await this.dbInstance.insert(financeCosMonthly).values(batch).returning();
      results.push(...batchResults);
    }
    return results;
  }

  async deleteFinanceCosMonthlyByProject(projectName: string): Promise<void> {
    // Temporal: soft-close instead of hard delete (Prompt 10)
    await softCloseByProjectName(this.dbInstance, "finance_cos_monthly", projectName);
  }

  // Project Revenue Summary
  async getAllProjectRevenueSummaries(): Promise<ProjectRevenueSummary[]> {
    return this.dbInstance.select().from(projectRevenueSummary).where(isNull(projectRevenueSummary.effectiveTo));
  }

  async getProjectRevenueSummary(projectName: string): Promise<ProjectRevenueSummary | undefined> {
    const results = await this.dbInstance.select().from(projectRevenueSummary).where(and(eq(projectRevenueSummary.projectName, projectName), isNull(projectRevenueSummary.effectiveTo)));
    return results[0];
  }

  async upsertProjectRevenueSummary(data: InsertProjectRevenueSummary): Promise<ProjectRevenueSummary> {
    const existing = await this.getProjectRevenueSummary((data as any).projectName);
    if (existing) {
      // Temporal: soft-close old row, insert new version (Prompt 10)
      await softCloseByProjectName(this.dbInstance, "project_revenue_summary", (data as any).projectName);
      const inserted = await this.dbInstance.insert(projectRevenueSummary)
        .values(addTemporalColumns({ ...data, capturedAt: new Date() }) as any)
        .returning();
      return inserted[0];
    } else {
      const inserted = await this.dbInstance.insert(projectRevenueSummary)
        .values(addTemporalColumns(data) as any)
        .returning();
      return inserted[0];
    }
  }
}
