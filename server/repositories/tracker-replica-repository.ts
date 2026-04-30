/**
 * Tracker Replica Repository.
 *
 * Read-only data access for the per-project Tracker workbook replicas:
 *   - Revenue Tracking sheet
 *   - Expenditure Breakdown sheet
 *   - Project Plan sheet
 *
 * All reads filter active rows only:
 *   - effective_to IS NULL on temporal tables (normalized_*, tracker_*).
 *   - deleted_at IS NULL on work_items (per CLAUDE.md note about retired
 *     writable view; soft-delete is the active filter).
 *
 * No writes — these screens are read-only in v1.
 */
import { eq, and, isNull, asc } from "drizzle-orm";
import {
  normalizedRevenueLines,
  normalizedCostLines,
  normalizedCostLineActuals,
  trackerRevenueSummary,
  trackerProjectMetadata,
  type NormalizedRevenueLine,
  type NormalizedCostLine,
  type NormalizedCostLineActual,
  type TrackerRevenueSummary,
  type TrackerProjectMetadata,
} from "@shared/schema/finance";
import { workItems, type WorkItem } from "@shared/schema/tasks";
import { projectInfo } from "@shared/schema/projects";
import { db } from "../db";

export class TrackerReplicaRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  /** Returns true iff a project_info row exists for the given id. */
  async projectExists(projectId: number): Promise<boolean> {
    const rows = await this.dbInstance
      .select({ id: projectInfo.id })
      .from(projectInfo)
      .where(eq(projectInfo.id, projectId))
      .limit(1);
    return rows.length > 0;
  }

  /** Latest active tracker_revenue_summary row for the project, or null. */
  async getRevenueSummary(projectId: number): Promise<TrackerRevenueSummary | null> {
    const rows = await this.dbInstance
      .select()
      .from(trackerRevenueSummary)
      .where(
        and(
          eq(trackerRevenueSummary.projectId, projectId),
          isNull(trackerRevenueSummary.effectiveTo),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Active normalized_revenue_lines (milestones) ordered by milestone_no. */
  async getRevenueLines(projectId: number): Promise<NormalizedRevenueLine[]> {
    return this.dbInstance
      .select()
      .from(normalizedRevenueLines)
      .where(
        and(
          eq(normalizedRevenueLines.projectId, projectId),
          isNull(normalizedRevenueLines.effectiveTo),
          isNull(normalizedRevenueLines.deletedAt),
        ),
      )
      .orderBy(asc(normalizedRevenueLines.sourceRow));
  }

  /** Active normalized_cost_lines for the project. */
  async getCostLines(projectId: number): Promise<NormalizedCostLine[]> {
    return this.dbInstance
      .select()
      .from(normalizedCostLines)
      .where(
        and(
          eq(normalizedCostLines.projectId, projectId),
          isNull(normalizedCostLines.effectiveTo),
          isNull(normalizedCostLines.deletedAt),
        ),
      )
      .orderBy(asc(normalizedCostLines.sourceRow));
  }

  /** Active normalized_cost_line_actuals (extra batches) for the project. */
  async getCostLineActuals(projectId: number): Promise<NormalizedCostLineActual[]> {
    return this.dbInstance
      .select()
      .from(normalizedCostLineActuals)
      .where(
        and(
          eq(normalizedCostLineActuals.projectId, projectId),
          isNull(normalizedCostLineActuals.effectiveTo),
          isNull(normalizedCostLineActuals.deletedAt),
        ),
      )
      .orderBy(asc(normalizedCostLineActuals.costLineId), asc(normalizedCostLineActuals.actualNo));
  }

  /** Latest active tracker_project_metadata for the project, or null. */
  async getProjectMetadata(projectId: number): Promise<TrackerProjectMetadata | null> {
    const rows = await this.dbInstance
      .select()
      .from(trackerProjectMetadata)
      .where(
        and(
          eq(trackerProjectMetadata.projectId, projectId),
          isNull(trackerProjectMetadata.effectiveTo),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Active PM-workstream Smart-Import work_items for the project, ordered by
   * sortOrder then sourceRow so the resulting list matches the workbook
   * top-to-bottom.
   */
  async getProgramPlanTasks(projectId: number): Promise<WorkItem[]> {
    return this.dbInstance
      .select()
      .from(workItems)
      .where(
        and(
          eq(workItems.projectId, projectId),
          eq(workItems.source, "SMART_IMPORT"),
          eq(workItems.workstream, "PM"),
          isNull(workItems.deletedAt),
        ),
      )
      .orderBy(asc(workItems.sortOrder), asc(workItems.sourceRow));
  }
}

export const trackerReplicaRepository = new TrackerReplicaRepository();
