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

  /**
   * Flatten the per-row `manual_overrides` JSONB columns across all three
   * canonical tables into a single audit-style list. Used by the
   * "manual overrides" read surface so an auditor can answer "who edited
   * what when" for a given project without diving into raw SQL.
   *
   * The shape per entry:
   *   { table, rowId, sourceRow, displayLabel, fieldName, value,
   *     fromValue, editedBy, editedAt }
   *
   * Sorted by editedAt DESC so the most recent edit is first.
   */
  async getManualOverrides(projectId: number): Promise<ManualOverrideEntry[]> {
    const out: ManualOverrideEntry[] = [];

    // Helper that turns one row's JSONB map into N flat entries.
    const flatten = (
      table: ManualOverrideEntry["table"],
      rowId: number,
      sourceRow: number | null,
      displayLabel: string,
      overrides: unknown,
    ) => {
      if (!overrides || typeof overrides !== "object") return;
      for (const [fieldName, raw] of Object.entries(overrides as Record<string, unknown>)) {
        if (!raw || typeof raw !== "object") continue;
        const entry = raw as Record<string, unknown>;
        out.push({
          table,
          rowId,
          sourceRow,
          displayLabel,
          fieldName,
          value: entry.value as string | number | boolean | null,
          fromValue: entry.fromValue as string | number | boolean | null,
          editedBy: typeof entry.editedBy === "number" ? entry.editedBy : null,
          editedAt: typeof entry.editedAt === "string" ? entry.editedAt : "",
        });
      }
    };

    // Revenue
    const revRows = await this.dbInstance
      .select({
        id: normalizedRevenueLines.id,
        sourceRow: normalizedRevenueLines.sourceRow,
        milestoneName: normalizedRevenueLines.milestoneName,
        manualOverrides: normalizedRevenueLines.manualOverrides,
      })
      .from(normalizedRevenueLines)
      .where(
        and(
          eq(normalizedRevenueLines.projectId, projectId),
          isNull(normalizedRevenueLines.effectiveTo),
        ),
      );
    for (const r of revRows) {
      flatten("normalized_revenue_lines", r.id, r.sourceRow, r.milestoneName ?? `Row ${r.sourceRow ?? r.id}`, r.manualOverrides);
    }

    // Cost lines
    const costRows = await this.dbInstance
      .select({
        id: normalizedCostLines.id,
        sourceRow: normalizedCostLines.sourceRow,
        description: normalizedCostLines.description,
        manualOverrides: normalizedCostLines.manualOverrides,
      })
      .from(normalizedCostLines)
      .where(
        and(
          eq(normalizedCostLines.projectId, projectId),
          isNull(normalizedCostLines.effectiveTo),
        ),
      );
    for (const r of costRows) {
      flatten("normalized_cost_lines", r.id, r.sourceRow, r.description ?? `Row ${r.sourceRow ?? r.id}`, r.manualOverrides);
    }

    // Plan tasks
    const planRows = await this.dbInstance
      .select({
        id: workItems.id,
        sourceRow: workItems.sourceRow,
        title: workItems.title,
        manualOverrides: workItems.manualOverrides,
      })
      .from(workItems)
      .where(
        and(
          eq(workItems.projectId, projectId),
          eq(workItems.source, "SMART_IMPORT"),
          eq(workItems.workstream, "PM"),
          isNull(workItems.deletedAt),
        ),
      );
    for (const r of planRows) {
      flatten("work_items", r.id, r.sourceRow, r.title ?? `Task ${r.sourceRow ?? r.id}`, r.manualOverrides);
    }

    // Newest edits first.
    out.sort((a, b) => (a.editedAt < b.editedAt ? 1 : a.editedAt > b.editedAt ? -1 : 0));
    return out;
  }
}

export interface ManualOverrideEntry {
  table: "normalized_revenue_lines" | "normalized_cost_lines" | "work_items";
  rowId: number;
  sourceRow: number | null;
  displayLabel: string;
  fieldName: string;
  value: string | number | boolean | null;
  fromValue: string | number | boolean | null;
  editedBy: number | null;
  editedAt: string;
}

export const trackerReplicaRepository = new TrackerReplicaRepository();
