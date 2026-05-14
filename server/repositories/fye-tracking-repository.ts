import { and, desc, eq, gte, isNull } from "drizzle-orm";
import {
  fyeBudgets,
  forecastPipeline,
  lostDeals,
  fyeKpiCounters,
  fyeReportSnapshots,
  projectEditableFields,
  engineeringTickets,
  projectPlan,
  projectRevenueSummary,
  type ForecastPipeline,
  type FyeReportSnapshot,
} from "@shared/schema";
import { db } from "../db";

/**
 * FYE Revenue Tracking — repository for the FYE-specific tables and
 * adjacent lookups used only by the FYE Revenue Tracking report
 * (`server/departments/fye-revenue-tracking-routes.ts`). Holds plain
 * CRUD; the route keeps all aggregation / business logic.
 */
export class FyeTrackingRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  // ── fye_budgets ──

  async listBudgetsByFye(fye: string | null): Promise<Array<{
    id: number;
    projectName: string;
    fye: string;
    monthKey: string;
    budgetType: string;
    amount: string | null;
  }>> {
    const query = this.dbInstance
      .select({
        id: fyeBudgets.id,
        projectName: fyeBudgets.projectName,
        fye: fyeBudgets.fye,
        monthKey: fyeBudgets.monthKey,
        budgetType: fyeBudgets.budgetType,
        amount: fyeBudgets.amount,
      })
      .from(fyeBudgets);

    return fye ? query.where(eq(fyeBudgets.fye, fye)) : query;
  }

  async listBudgetTotalsByFye(fye: string | null): Promise<Array<{
    monthKey: string;
    budgetType: string;
    amount: string | null;
  }>> {
    const query = this.dbInstance
      .select({
        monthKey: fyeBudgets.monthKey,
        budgetType: fyeBudgets.budgetType,
        amount: fyeBudgets.amount,
      })
      .from(fyeBudgets);

    return fye ? query.where(eq(fyeBudgets.fye, fye)) : query;
  }

  async findBudgetIdByKey(args: {
    projectName: string;
    fye: string;
    monthKey: string;
    budgetType: string;
  }): Promise<number | null> {
    const [row] = await this.dbInstance
      .select({ id: fyeBudgets.id })
      .from(fyeBudgets)
      .where(and(
        eq(fyeBudgets.projectName, args.projectName),
        eq(fyeBudgets.fye, args.fye),
        eq(fyeBudgets.monthKey, args.monthKey),
        eq(fyeBudgets.budgetType, args.budgetType),
      ));
    return row?.id ?? null;
  }

  async updateBudgetAmount(id: number, amount: string, updatedBy: number | null): Promise<void> {
    await this.dbInstance
      .update(fyeBudgets)
      .set({ amount, updatedBy, updatedAt: new Date() })
      .where(eq(fyeBudgets.id, id));
  }

  async aggregateBudgetExists(fye: string, projectName: string): Promise<boolean> {
    const [row] = await this.dbInstance
      .select({ id: fyeBudgets.id })
      .from(fyeBudgets)
      .where(and(eq(fyeBudgets.fye, fye), eq(fyeBudgets.projectName, projectName)))
      .limit(1);
    return !!row;
  }

  // ── forecast_pipeline ──

  async listPipelineByFye(fyeYear: number): Promise<ForecastPipeline[]> {
    return this.dbInstance
      .select()
      .from(forecastPipeline)
      .where(eq(forecastPipeline.fyeYear, fyeYear));
  }

  async listActivePipelineByFye(fyeYear: number | null): Promise<ForecastPipeline[]> {
    const whereClause =
      fyeYear == null
        ? eq(forecastPipeline.status, "active")
        : and(eq(forecastPipeline.status, "active"), eq(forecastPipeline.fyeYear, fyeYear));

    return this.dbInstance
      .select()
      .from(forecastPipeline)
      .where(whereClause)
      .orderBy(desc(forecastPipeline.updatedAt));
  }

  async listHighProbabilityActivePipeline(fyeYear: number | null): Promise<Array<{
    solarRevenue: string | null;
    bessRevenue: string | null;
    forecastSignatureDate: string | null;
    forecastGpPct: string | null;
  }>> {
    const whereClause =
      fyeYear == null
        ? and(gte(forecastPipeline.dealProbabilityPct, 95), eq(forecastPipeline.status, "active"))
        : and(
            eq(forecastPipeline.fyeYear, fyeYear),
            gte(forecastPipeline.dealProbabilityPct, 95),
            eq(forecastPipeline.status, "active"),
          );

    return this.dbInstance
      .select({
        solarRevenue: forecastPipeline.solarRevenue,
        bessRevenue: forecastPipeline.bessRevenue,
        forecastSignatureDate: forecastPipeline.forecastSignatureDate,
        forecastGpPct: forecastPipeline.forecastGpPct,
      })
      .from(forecastPipeline)
      .where(whereClause);
  }

  async getLatestPipelineRow(): Promise<{ id: number; projectName: string | null } | null> {
    const [row] = await this.dbInstance
      .select({ id: forecastPipeline.id, projectName: forecastPipeline.projectName })
      .from(forecastPipeline)
      .orderBy(desc(forecastPipeline.id))
      .limit(1);
    return row ?? null;
  }

  async updatePipelineRow(id: number, fields: Record<string, unknown>): Promise<void> {
    await this.dbInstance
      .update(forecastPipeline)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(forecastPipeline.id, id));
  }

  async archivePipelineRow(id: number): Promise<void> {
    await this.dbInstance
      .update(forecastPipeline)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(forecastPipeline.id, id));
  }

  async findPipelineIdByDealName(dealName: string, fyeYear: number): Promise<number | null> {
    const [row] = await this.dbInstance
      .select({ id: forecastPipeline.id })
      .from(forecastPipeline)
      .where(and(
        eq(forecastPipeline.projectName, dealName),
        eq(forecastPipeline.fyeYear, fyeYear),
      ))
      .limit(1);
    return row?.id ?? null;
  }

  // ── lost_deals ──

  async listLostDealsByFye(fyeYear: number | null): Promise<Array<typeof lostDeals.$inferSelect>> {
    const query = this.dbInstance.select().from(lostDeals);
    return fyeYear == null
      ? query.orderBy(desc(lostDeals.updatedAt))
      : query.where(eq(lostDeals.fyeYear, fyeYear)).orderBy(desc(lostDeals.updatedAt));
  }

  async listLostDealsForKpi(fyeYear: number | null): Promise<Array<{
    id: number;
    dealName: string | null;
    dealValue: string | null;
    businessDeveloper: string | null;
    lostReason: string | null;
    lostDate: string | null;
  }>> {
    const query = this.dbInstance
      .select({
        id: lostDeals.id,
        dealName: lostDeals.dealName,
        dealValue: lostDeals.dealValue,
        businessDeveloper: lostDeals.businessDeveloper,
        lostReason: lostDeals.lostReason,
        lostDate: lostDeals.lostDate,
      })
      .from(lostDeals);

    return fyeYear == null ? query : query.where(eq(lostDeals.fyeYear, fyeYear));
  }

  async getLatestLostDealRow(): Promise<{ id: number; dealName: string | null } | null> {
    const [row] = await this.dbInstance
      .select({ id: lostDeals.id, dealName: lostDeals.dealName })
      .from(lostDeals)
      .orderBy(desc(lostDeals.id))
      .limit(1);
    return row ?? null;
  }

  async updateLostDealRow(id: number, fields: Record<string, unknown>): Promise<void> {
    await this.dbInstance
      .update(lostDeals)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(lostDeals.id, id));
  }

  async deleteLostDealById(id: number): Promise<void> {
    await this.dbInstance.delete(lostDeals).where(eq(lostDeals.id, id));
  }

  async findLostDealIdByDealName(dealName: string, fyeYear: number): Promise<number | null> {
    const [row] = await this.dbInstance
      .select({ id: lostDeals.id })
      .from(lostDeals)
      .where(and(
        eq(lostDeals.dealName, dealName),
        eq(lostDeals.fyeYear, fyeYear),
      ))
      .limit(1);
    return row?.id ?? null;
  }

  // ── fye_kpi_counters ──

  async getKpiCounterByFye(fyeYear: number): Promise<{ broughtIn: number; signed: number } | null> {
    const [row] = await this.dbInstance
      .select({ broughtIn: fyeKpiCounters.broughtIn, signed: fyeKpiCounters.signed })
      .from(fyeKpiCounters)
      .where(eq(fyeKpiCounters.fyeYear, fyeYear));
    return row ?? null;
  }

  async findKpiCounterIdByFye(fyeYear: number): Promise<number | null> {
    const [row] = await this.dbInstance
      .select({ id: fyeKpiCounters.id })
      .from(fyeKpiCounters)
      .where(eq(fyeKpiCounters.fyeYear, fyeYear))
      .limit(1);
    return row?.id ?? null;
  }

  // ── fye_report_snapshots ──

  async getLatestSnapshot(): Promise<{ id: number; snapshotLabel: string | null; status: string } | null> {
    const [row] = await this.dbInstance
      .select({
        id: fyeReportSnapshots.id,
        snapshotLabel: fyeReportSnapshots.snapshotLabel,
        status: fyeReportSnapshots.status,
      })
      .from(fyeReportSnapshots)
      .orderBy(desc(fyeReportSnapshots.id))
      .limit(1);
    return row ?? null;
  }

  async listSnapshotsByFye(fyeYear: number): Promise<Array<{
    id: number;
    fyeYear: number;
    snapshotMonth: number | null;
    snapshotDate: string | null;
    snapshotLabel: string | null;
    status: string;
    notes: string | null;
    createdBy: number | null;
    createdAt: Date | null;
    submittedAt: Date | null;
    approvedAt: Date | null;
  }>> {
    return this.dbInstance
      .select({
        id: fyeReportSnapshots.id,
        fyeYear: fyeReportSnapshots.fyeYear,
        snapshotMonth: fyeReportSnapshots.snapshotMonth,
        snapshotDate: fyeReportSnapshots.snapshotDate,
        snapshotLabel: fyeReportSnapshots.snapshotLabel,
        status: fyeReportSnapshots.status,
        notes: fyeReportSnapshots.notes,
        createdBy: fyeReportSnapshots.createdBy,
        createdAt: fyeReportSnapshots.createdAt,
        submittedAt: fyeReportSnapshots.submittedAt,
        approvedAt: fyeReportSnapshots.approvedAt,
      })
      .from(fyeReportSnapshots)
      .where(eq(fyeReportSnapshots.fyeYear, fyeYear))
      .orderBy(desc(fyeReportSnapshots.snapshotDate));
  }

  async getSnapshotById(id: number): Promise<FyeReportSnapshot | null> {
    const [row] = await this.dbInstance
      .select()
      .from(fyeReportSnapshots)
      .where(eq(fyeReportSnapshots.id, id));
    return row ?? null;
  }

  async getSnapshotStatusById(id: number): Promise<string | null> {
    const [row] = await this.dbInstance
      .select({ status: fyeReportSnapshots.status })
      .from(fyeReportSnapshots)
      .where(eq(fyeReportSnapshots.id, id));
    return row?.status ?? null;
  }

  // ── project_editable_fields ──

  async listEditableFields(): Promise<Array<{
    projectName: string;
    costProposalType: string | null;
    fundingType: string | null;
    province: string | null;
  }>> {
    return this.dbInstance
      .select({
        projectName: projectEditableFields.projectName,
        costProposalType: projectEditableFields.costProposalType,
        fundingType: projectEditableFields.fundingType,
        province: projectEditableFields.province,
      })
      .from(projectEditableFields);
  }

  async findEditableFieldIdByProjectName(projectName: string): Promise<number | null> {
    const [row] = await this.dbInstance
      .select({ id: projectEditableFields.id })
      .from(projectEditableFields)
      .where(eq(projectEditableFields.projectName, projectName));
    return row?.id ?? null;
  }

  async updateEditableField(id: number, dbField: string, value: unknown): Promise<void> {
    await this.dbInstance
      .update(projectEditableFields)
      .set({ [dbField]: value, updatedAt: new Date() })
      .where(eq(projectEditableFields.id, id));
  }

  async insertEditableField(projectName: string, dbField: string, value: unknown): Promise<void> {
    await this.dbInstance
      .insert(projectEditableFields)
      .values({ projectName, [dbField]: value } as never);
  }

  // ── engineering_tickets (province lookup) ──

  async listProvinceByProjectSiteName(): Promise<Array<{
    projectSiteName: string | null;
    province: string | null;
  }>> {
    return this.dbInstance
      .select({
        projectSiteName: engineeringTickets.projectSiteName,
        province: engineeringTickets.province,
      })
      .from(engineeringTickets)
      .where(isNull(engineeringTickets.deletedAt));
  }

  // ── project_plan ──

  async listAllPlanTasks(): Promise<Array<{
    projectName: string;
    highLevelProgramme: string | null;
    actualStart: string | null;
    actualEnd: string | null;
  }>> {
    return this.dbInstance
      .select({
        projectName: projectPlan.projectName,
        highLevelProgramme: projectPlan.highLevelProgramme,
        actualStart: projectPlan.actualStart,
        actualEnd: projectPlan.actualEnd,
      })
      .from(projectPlan);
  }

  // ── project_revenue_summary (tracker flag only) ──

  async listActiveRevenueSummaryProjectNames(): Promise<string[]> {
    const rows = await this.dbInstance
      .select({ projectName: projectRevenueSummary.projectName })
      .from(projectRevenueSummary)
      .where(isNull(projectRevenueSummary.effectiveTo));
    return rows.map((r: { projectName: string }) => r.projectName);
  }
}
