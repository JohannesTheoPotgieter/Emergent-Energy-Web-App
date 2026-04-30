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

  /**
   * Excel-vs-App drift detail for a project. For each tracked field on
   * each active canonical row, classifies the field as `none` /
   * `verified` / `unverified` drift by comparing:
   *   - liveValue       = row[field]
   *   - snapshotValue   = importSnapshot[field]
   *   - overrideValue   = manualOverrides[field]?.value (or null)
   *   - displayValue    = override ?? live
   *
   *   - none       — valuesEqual(displayValue, snapshotValue).
   *   - verified   — drift AND manual_overrides[field] present.
   *   - unverified — drift AND manual_overrides[field] absent
   *                  (live column was changed via a path that bypassed
   *                  the override pipeline; needs operator
   *                  resolution).
   *
   * Pure read; reuses `valuesEqual` from `merge-engine.ts` so the
   * loose-equality semantics (1500 vs "1,500.00", ISO vs Excel
   * date) match what the import engine considers a conflict.
   */
  async getDriftDetail(projectId: number): Promise<DriftDetail> {
    const { valuesEqual } = await import("../lib/import/merge-engine");
    const {
      PLAN_TRACKED_FIELDS,
      REVENUE_TRACKED_FIELDS,
      EXPENDITURE_TRACKED_FIELDS,
    } = await import("@shared/excel-vs-app/contract");

    function readJsonbObject(v: unknown): Record<string, any> {
      if (!v || typeof v !== "object" || Array.isArray(v)) return {};
      return v as Record<string, any>;
    }

    function classify(
      live: unknown,
      snapshot: unknown,
      override: unknown,
      hasOverrideEntry: boolean,
    ): "none" | "verified" | "unverified" {
      const display = hasOverrideEntry ? override : live;
      if (valuesEqual(display as any, snapshot as any)) return "none";
      return hasOverrideEntry ? "verified" : "unverified";
    }

    function buildRowFields(
      row: Record<string, any>,
      trackedFields: readonly string[],
    ) {
      const snapshot = readJsonbObject(row.importSnapshot);
      const overrides = readJsonbObject(row.manualOverrides);
      const cellFormat = row.cellFormat ?? null;
      const fields: DriftRowField[] = [];
      for (const f of trackedFields) {
        const live = row[f] ?? null;
        const snap = snapshot[f] ?? null;
        const overrideEntry = overrides[f];
        const hasOverride = overrideEntry != null && typeof overrideEntry === "object" && "value" in overrideEntry;
        const overrideValue = hasOverride ? overrideEntry.value : null;
        const driftClass = classify(live, snap, overrideValue, hasOverride);
        fields.push({
          fieldName: f,
          liveValue: live as any,
          snapshotValue: snap as any,
          overrideValue: hasOverride ? (overrideValue as any) : null,
          overrideEditor: hasOverride ? (overrideEntry.editedBy ?? null) : null,
          overrideEditedAt: hasOverride ? (overrideEntry.editedAt ?? null) : null,
          overrideReason: hasOverride ? (overrideEntry.note ?? null) : null,
          cellFormat: cellFormat && typeof cellFormat === "object" && (cellFormat as any)[f]
            ? (cellFormat as any)[f]
            : null,
          drift: driftClass,
        });
      }
      return fields;
    }

    function summarise(rows: DriftRow[]): { verified: number; unverified: number } {
      let verified = 0, unverified = 0;
      for (const r of rows) {
        for (const f of r.fields) {
          if (f.drift === "verified") verified++;
          else if (f.drift === "unverified") unverified++;
        }
      }
      return { verified, unverified };
    }

    const [costRows, revRows, planRows] = await Promise.all([
      this.dbInstance
        .select()
        .from(normalizedCostLines)
        .where(
          and(
            eq(normalizedCostLines.projectId, projectId),
            isNull(normalizedCostLines.effectiveTo),
            isNull(normalizedCostLines.deletedAt),
          ),
        )
        .orderBy(asc(normalizedCostLines.sourceRow)),
      this.dbInstance
        .select()
        .from(normalizedRevenueLines)
        .where(
          and(
            eq(normalizedRevenueLines.projectId, projectId),
            isNull(normalizedRevenueLines.effectiveTo),
            isNull(normalizedRevenueLines.deletedAt),
          ),
        )
        .orderBy(asc(normalizedRevenueLines.sourceRow)),
      this.dbInstance
        .select()
        .from(workItems)
        .where(
          and(
            eq(workItems.projectId, projectId),
            isNull(workItems.deletedAt),
          ),
        )
        .orderBy(asc(workItems.sortOrder), asc(workItems.sourceRow)),
    ]);

    const costLines: DriftRow[] = costRows.map((r: any) => ({
      id: r.id,
      rowHash: r.rowHash ?? null,
      displayLabel: r.description ?? `Row ${r.sourceRow ?? r.id}`,
      sourceRow: r.sourceRow ?? null,
      fields: buildRowFields(r, EXPENDITURE_TRACKED_FIELDS),
    }));
    const revenueLines: DriftRow[] = revRows.map((r: any) => ({
      id: r.id,
      rowHash: r.rowHash ?? null,
      displayLabel: r.milestoneName ?? `Row ${r.sourceRow ?? r.id}`,
      sourceRow: r.sourceRow ?? null,
      fields: buildRowFields(r, REVENUE_TRACKED_FIELDS),
    }));
    const planTasks: DriftRow[] = planRows.map((r: any) => ({
      id: r.id,
      rowHash: r.rowHash ?? null,
      displayLabel: r.title ?? `Task ${r.sourceRow ?? r.id}`,
      sourceRow: r.sourceRow ?? null,
      fields: buildRowFields(r, PLAN_TRACKED_FIELDS),
    }));

    return {
      projectId,
      costLines,
      revenueLines,
      planTasks,
      summary: {
        EXPENDITURE: summarise(costLines),
        REVENUE: summarise(revenueLines),
        PLAN: summarise(planTasks),
      },
    };
  }
}

export interface DriftRowField {
  fieldName: string;
  liveValue: string | number | boolean | null;
  snapshotValue: string | number | boolean | null;
  overrideValue: string | number | boolean | null;
  overrideEditor: number | null;
  overrideEditedAt: string | null;
  overrideReason: string | null;
  cellFormat: { font?: string | null; fill?: string | null; bold?: boolean | null } | null;
  drift: "none" | "verified" | "unverified";
}

export interface DriftRow {
  id: number;
  rowHash: string | null;
  displayLabel: string;
  sourceRow: number | null;
  fields: DriftRowField[];
}

export interface DriftSectionSummary {
  verified: number;
  unverified: number;
}

export interface DriftDetail {
  projectId: number;
  costLines: DriftRow[];
  revenueLines: DriftRow[];
  planTasks: DriftRow[];
  summary: {
    EXPENDITURE: DriftSectionSummary;
    REVENUE: DriftSectionSummary;
    PLAN: DriftSectionSummary;
  };
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
