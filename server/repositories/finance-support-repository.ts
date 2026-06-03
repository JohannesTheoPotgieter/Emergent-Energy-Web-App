import { eq, desc, and, gte, isNull } from "drizzle-orm";
import {
  cashflowWeeklyManual, cashflowBalanceHistory, opexBudgetMonthly,
  opexWeeklyManual, availablePaymentOverrides, availablePaymentHistory,
  trackerMonthlyManual,
  type CashflowWeeklyManual, type InsertCashflowWeeklyManual,
  type CashflowBalanceHistory, type InsertCashflowBalanceHistory,
  type OpexBudgetMonthly, type InsertOpexBudgetMonthly,
  type OpexWeeklyManual, type InsertOpexWeeklyManual,
  type AvailablePaymentOverride, type InsertAvailablePaymentOverride,
  type AvailablePaymentHistory, type InsertAvailablePaymentHistory,
  type TrackerMonthlyManual, type InsertTrackerMonthlyManual,
} from "@shared/schema";
import { db } from "../db";

export class FinanceSupportRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  // Cashflow Weekly Manual
  async getAllCashflowWeeklyManual(): Promise<CashflowWeeklyManual[]> {
    return this.dbInstance.select().from(cashflowWeeklyManual);
  }

  async upsertCashflowWeeklyManual(weekStartDate: string, openingBalance: string): Promise<CashflowWeeklyManual> {
    const existing = await this.dbInstance.select().from(cashflowWeeklyManual).where(eq(cashflowWeeklyManual.weekStartDate, weekStartDate));
    if (existing[0]) {
      const updated = await this.dbInstance.update(cashflowWeeklyManual)
        .set({ openingBalance, updatedAt: new Date() })
        .where(eq(cashflowWeeklyManual.id, existing[0].id))
        .returning();
      return updated[0];
    }
    const inserted = await this.dbInstance.insert(cashflowWeeklyManual).values({ weekStartDate, openingBalance }).returning();
    return inserted[0];
  }

  async deleteCashflowWeeklyManual(weekStartDate: string): Promise<void> {
    await this.dbInstance.delete(cashflowWeeklyManual)
      .where(eq(cashflowWeeklyManual.weekStartDate, weekStartDate));
  }

  async deleteAllCashflowWeeklyManualAfter(weekStartDate: string): Promise<string[]> {
    const toDelete = await this.dbInstance.select({ weekStartDate: cashflowWeeklyManual.weekStartDate })
      .from(cashflowWeeklyManual)
      .where(gte(cashflowWeeklyManual.weekStartDate, weekStartDate));
    const weeks = toDelete.map((r: { weekStartDate: string }) => r.weekStartDate);
    if (weeks.length > 0) {
      await this.dbInstance.delete(cashflowWeeklyManual)
        .where(gte(cashflowWeeklyManual.weekStartDate, weekStartDate));
    }
    return weeks;
  }

  // Cashflow Balance History
  async getBalanceHistory(weekStartDate: string): Promise<CashflowBalanceHistory[]> {
    return this.dbInstance.select().from(cashflowBalanceHistory)
      .where(eq(cashflowBalanceHistory.weekStartDate, weekStartDate))
      .orderBy(desc(cashflowBalanceHistory.changedAt));
  }

  async getAllBalanceHistory(): Promise<CashflowBalanceHistory[]> {
    return this.dbInstance.select().from(cashflowBalanceHistory)
      .orderBy(desc(cashflowBalanceHistory.changedAt));
  }

  async addBalanceHistory(entry: InsertCashflowBalanceHistory): Promise<CashflowBalanceHistory> {
    const inserted = await this.dbInstance.insert(cashflowBalanceHistory).values(entry).returning();
    return inserted[0];
  }

  // OPEX Budget Monthly
  async getAllOpexBudgetMonthly(): Promise<OpexBudgetMonthly[]> {
    return this.dbInstance.select().from(opexBudgetMonthly);
  }

  async upsertOpexBudgetMonthly(monthKey: string, amount: string): Promise<OpexBudgetMonthly> {
    const existing = await this.dbInstance.select().from(opexBudgetMonthly).where(eq(opexBudgetMonthly.monthKey, monthKey));
    if (existing[0]) {
      const updated = await this.dbInstance.update(opexBudgetMonthly)
        .set({ amount, updatedAt: new Date() })
        .where(eq(opexBudgetMonthly.id, existing[0].id))
        .returning();
      return updated[0];
    }
    const inserted = await this.dbInstance.insert(opexBudgetMonthly).values({ monthKey, amount }).returning();
    return inserted[0];
  }

  // OPEX Weekly Manual
  async getAllOpexWeeklyManual(): Promise<OpexWeeklyManual[]> {
    return this.dbInstance.select().from(opexWeeklyManual);
  }

  async upsertOpexWeeklyManual(weekStartDate: string, opexAmount: string): Promise<OpexWeeklyManual> {
    const existing = await this.dbInstance.select().from(opexWeeklyManual).where(eq(opexWeeklyManual.weekStartDate, weekStartDate));
    if (existing[0]) {
      const updated = await this.dbInstance.update(opexWeeklyManual)
        .set({ opexAmount, updatedAt: new Date() })
        .where(eq(opexWeeklyManual.id, existing[0].id))
        .returning();
      return updated[0];
    }
    const inserted = await this.dbInstance.insert(opexWeeklyManual).values({ weekStartDate, opexAmount }).returning();
    return inserted[0];
  }

  async deleteOpexWeeklyManual(weekStartDate: string): Promise<void> {
    await this.dbInstance.delete(opexWeeklyManual).where(eq(opexWeeklyManual.weekStartDate, weekStartDate));
  }

  // Available Payment Overrides
  async getAllAvailablePaymentOverrides(): Promise<AvailablePaymentOverride[]> {
    return this.dbInstance.select().from(availablePaymentOverrides);
  }

  async upsertAvailablePaymentOverride(weekStartDate: string, overrideValue: string, reason: string | null, updatedBy: string | null): Promise<AvailablePaymentOverride> {
    const existing = await this.dbInstance.select().from(availablePaymentOverrides).where(eq(availablePaymentOverrides.weekStartDate, weekStartDate));
    if (existing[0]) {
      const updated = await this.dbInstance.update(availablePaymentOverrides)
        .set({ overrideValue, reason, updatedBy, updatedAt: new Date() })
        .where(eq(availablePaymentOverrides.id, existing[0].id))
        .returning();
      return updated[0];
    }
    const inserted = await this.dbInstance.insert(availablePaymentOverrides).values({ weekStartDate, overrideValue, reason, updatedBy }).returning();
    return inserted[0];
  }

  async deleteAvailablePaymentOverride(weekStartDate: string): Promise<void> {
    await this.dbInstance.delete(availablePaymentOverrides).where(eq(availablePaymentOverrides.weekStartDate, weekStartDate));
  }

  // Available Payment History
  async getAvailablePaymentHistory(weekStartDate: string): Promise<AvailablePaymentHistory[]> {
    return this.dbInstance.select().from(availablePaymentHistory)
      .where(eq(availablePaymentHistory.weekStartDate, weekStartDate))
      .orderBy(desc(availablePaymentHistory.changedAt));
  }

  async addAvailablePaymentHistory(entry: InsertAvailablePaymentHistory): Promise<AvailablePaymentHistory> {
    const inserted = await this.dbInstance.insert(availablePaymentHistory).values(entry).returning();
    return inserted[0];
  }

  // Tracker Monthly Manual
  async getTrackerMonthlyManual(trackerType: string, projectInfoId: number | null = null): Promise<TrackerMonthlyManual[]> {
    return this.dbInstance.select().from(trackerMonthlyManual).where(
      and(
        eq(trackerMonthlyManual.trackerType, trackerType),
        // Default (null) = program-wide rows only, so existing program
        // callers are unaffected; a project id scopes to that project.
        projectInfoId == null
          ? isNull(trackerMonthlyManual.projectInfoId)
          : eq(trackerMonthlyManual.projectInfoId, projectInfoId),
      ),
    );
  }

  async upsertTrackerMonthlyManual(data: InsertTrackerMonthlyManual): Promise<TrackerMonthlyManual> {
    const scopeProjectInfoId = (data as any).projectInfoId ?? null;
    const existing = await this.dbInstance.select().from(trackerMonthlyManual)
      .where(and(
        eq(trackerMonthlyManual.trackerType, (data as any).trackerType),
        eq(trackerMonthlyManual.monthKey, (data as any).monthKey),
        scopeProjectInfoId == null
          ? isNull(trackerMonthlyManual.projectInfoId)
          : eq(trackerMonthlyManual.projectInfoId, scopeProjectInfoId),
      ));
    if (existing[0]) {
      const updated = await this.dbInstance.update(trackerMonthlyManual)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(trackerMonthlyManual.id, existing[0].id))
        .returning();
      return updated[0];
    }
    const inserted = await this.dbInstance.insert(trackerMonthlyManual).values(data).returning();
    return inserted[0];
  }
}
