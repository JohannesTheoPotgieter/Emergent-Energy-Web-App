/**
 * Tracker Replica Repository.
 *
 * Data access for the per-project Tracker workbook replicas
 * (Revenue Tracking / Expenditure Breakdown / Project Plan) and the
 * manual-overrides edit log.
 *
 * All reads filter active rows only:
 *   - effective_to IS NULL on temporal tables (normalized_*, tracker_*).
 *   - deleted_at IS NULL on work_items (per CLAUDE.md note about retired
 *     writable view; soft-delete is the active filter).
 *
 * The manual-override cell-edit helpers (apply / clear) live in
 * `server/lib/manual-overrides.ts` because they're shared with the import engine.
 */
import { eq, and, isNull, asc, desc, inArray, sql } from "drizzle-orm";
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
import { workItems, workItemDependencies, type WorkItem } from "@shared/schema/tasks";
import { projectInfo } from "@shared/schema/projects";
import { smartImportRuns } from "@shared/schema/imports";
import { users } from "@shared/schema/users";
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

  /**
   * Returns the most recent committed Smart Import run for this project.
   * Used to render the "Tracker last synced: X days ago" badge on project
   * pages for all Execution roles — gated at work_items:view on the route.
   * Queries by projectId first; falls back to projectName match so projects
   * imported before projectId was wired (pre-v2) are still covered.
   */
  async getImportFreshness(projectId: number): Promise<{
    lastImportAt: string | null;
    daysSinceImport: number | null;
    isStale: boolean;
  }> {
    // Resolve project name for the fallback query.
    const [proj] = await this.dbInstance
      .select({ projectName: projectInfo.projectName })
      .from(projectInfo)
      .where(eq(projectInfo.id, projectId))
      .limit(1);

    if (!proj) return { lastImportAt: null, daysSinceImport: null, isStale: true };

    // Latest committed run for this project — prefer projectId match, fall
    // back to projectName match for legacy runs where projectId was NULL.
    const byId = await this.dbInstance
      .select({ committedAt: smartImportRuns.committedAt })
      .from(smartImportRuns)
      .where(and(eq(smartImportRuns.projectId, projectId), eq(smartImportRuns.status, "committed")))
      .orderBy(desc(smartImportRuns.committedAt))
      .limit(1);

    const byName = byId.length === 0
      ? await this.dbInstance
          .select({ committedAt: smartImportRuns.committedAt })
          .from(smartImportRuns)
          .where(and(eq(smartImportRuns.projectName, proj.projectName), eq(smartImportRuns.status, "committed")))
          .orderBy(desc(smartImportRuns.committedAt))
          .limit(1)
      : [];

    const row = byId[0] ?? byName[0] ?? null;
    if (!row?.committedAt) return { lastImportAt: null, daysSinceImport: null, isStale: true };

    const lastImportAt = row.committedAt.toISOString();
    const daysSinceImport = Math.floor((Date.now() - row.committedAt.getTime()) / 86_400_000);
    const isStale = daysSinceImport > 7;

    return { lastImportAt, daysSinceImport, isStale };
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
   * Active Smart-Import work_items (PM + ENG + QUALITY) for the project,
   * ordered by sortOrder then sourceRow so the resulting list matches the
   * workbook top-to-bottom. Broadened from PM-only on 2026-05-19 so the
   * tracker replica's Actual % / Expected % computation matches the Plan
   * tab and the Excel project-plan rollup (see
   * work-items-adapter.ts → getAllWorkItemsForProgress).
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
   * Dependency edges (predecessor → successor) among this project's plan tasks,
   * for the Gantt's dependency arrows and critical-path calculation. Includes
   * both importer-derived and manual links; cross-project edges are excluded.
   */
  async getProgramPlanDependencies(
    projectId: number,
  ): Promise<Array<{ predecessorId: number; successorId: number; depType: string; lagDays: number }>> {
    const planRows: Array<{ id: number }> = await this.dbInstance
      .select({ id: workItems.id })
      .from(workItems)
      .where(
        and(
          eq(workItems.projectId, projectId),
          eq(workItems.source, "SMART_IMPORT"),
          eq(workItems.workstream, "PM"),
          isNull(workItems.deletedAt),
        ),
      );
    const ids = planRows.map((r) => r.id);
    if (ids.length === 0) return [];
    const idSet = new Set(ids);
    const rows: Array<{ predecessorId: number; successorId: number; depType: string | null; lagDays: number | null }> =
      await this.dbInstance
        .select({
          predecessorId: workItemDependencies.predecessorId,
          successorId: workItemDependencies.successorId,
          depType: workItemDependencies.depType,
          lagDays: workItemDependencies.lagDays,
        })
        .from(workItemDependencies)
        .where(
          and(
            inArray(workItemDependencies.successorId, ids),
            isNull(workItemDependencies.deletedAt),
          ),
        );
    // Keep only edges whose predecessor is also part of this project's plan.
    return rows
      .filter((r) => idSet.has(r.predecessorId))
      .map((r) => ({
        predecessorId: r.predecessorId,
        successorId: r.successorId,
        depType: String(r.depType ?? "FS"),
        lagDays: r.lagDays ?? 0,
      }));
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
          editedByName: null,
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

    // Resolve user IDs to display names in a single batch query.
    const uniqueIds = [...new Set(out.map(e => e.editedBy).filter((id): id is number => id !== null))];
    if (uniqueIds.length > 0) {
      const userRows = await this.dbInstance
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, uniqueIds));
      const nameMap = new Map<number, string | null>(
        userRows.map((u: { id: number; name: string | null }) => [u.id, u.name]),
      );
      for (const entry of out) {
        if (entry.editedBy !== null) {
          entry.editedByName = nameMap.get(entry.editedBy) ?? null;
        }
      }
    }

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
  editedByName: string | null;
  editedAt: string;
}

export const trackerReplicaRepository = new TrackerReplicaRepository();
