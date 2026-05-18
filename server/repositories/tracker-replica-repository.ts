/**
 * Tracker Replica Repository.
 *
 * Data access for the per-project Tracker workbook replicas
 * (Revenue Tracking / Expenditure Breakdown / Project Plan) AND the
 * Excel-vs-App diff system that consumes the same data.
 *
 * All reads filter active rows only:
 *   - effective_to IS NULL on temporal tables (normalized_*, tracker_*).
 *   - deleted_at IS NULL on work_items (per CLAUDE.md note about retired
 *     writable view; soft-delete is the active filter).
 *
 * Writes are limited to the diff system's drift-resolution pipeline:
 * `createDriftApprovalRequest` files a `financial_edit_requests` row
 * routed to the section's reviewers. The drift-resolve cell-edit
 * helpers (apply / clear) live in `server/lib/manual-overrides.ts`
 * because they're shared between the import engine and the diff page.
 */
import { eq, and, isNull, asc, desc, inArray } from "drizzle-orm";
import {
  normalizedRevenueLines,
  normalizedCostLines,
  normalizedCostLineActuals,
  trackerRevenueSummary,
  trackerProjectMetadata,
  financialEditRequests,
  type NormalizedRevenueLine,
  type NormalizedCostLine,
  type NormalizedCostLineActual,
  type TrackerRevenueSummary,
  type TrackerProjectMetadata,
  type FinancialEditRequest,
} from "@shared/schema/finance";
import { workItems, type WorkItem } from "@shared/schema/tasks";
import { projectInfo } from "@shared/schema/projects";
import { smartImportRuns } from "@shared/schema/imports";
import { users } from "@shared/schema/users";
import { db } from "../db";
import type { FieldValue } from "../lib/import/merge-engine";

/** Parsed jsonb object (importSnapshot / manualOverrides cells). */
type JsonbRecord = Record<string, unknown>;

/** A manual-override jsonb entry: `{ value, editedBy?, editedAt?, note? }`. */
interface OverrideEntry {
  value: unknown;
  editedBy?: number | null;
  editedAt?: string | null;
  note?: string | null;
}

function isOverrideEntry(v: unknown): v is OverrideEntry {
  return v != null && typeof v === "object" && "value" in v;
}

/**
 * Coerce a dynamic jsonb / column value to the scalar `FieldValue` the
 * merge-engine comparator accepts. Non-scalar values (objects/arrays) are
 * normalised to their JSON string so equality still works deterministically.
 */
function toFieldValue(v: unknown): FieldValue {
  if (v == null) return v as null | undefined;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return v;
  }
  return JSON.stringify(v);
}

/** Display-side coercion: scalars pass through, everything else → null. */
function scalarOrNull(v: unknown): string | number | boolean | null {
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return v;
  }
  return null;
}

/**
 * Drift source rows expose the canonical columns plus the dynamic tracked
 * fields addressed via `row[fieldName]`. `WorkItem` plan rows share the
 * shape (importSnapshot / manualOverrides / cellFormat live columns).
 */
type DriftSourceRow = {
  id: number;
  projectId: number;
  sourceRow: number | null;
  rowHash?: string | null;
  importSnapshot?: unknown;
  manualOverrides?: unknown;
  cellFormat?: unknown;
} & Record<string, unknown>;

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

    function readJsonbObject(v: unknown): JsonbRecord {
      if (!v || typeof v !== "object" || Array.isArray(v)) return {};
      return v as JsonbRecord;
    }

    function classify(
      live: unknown,
      snapshot: unknown,
      override: unknown,
      hasOverrideEntry: boolean,
    ): "none" | "verified" | "unverified" {
      const display = hasOverrideEntry ? override : live;
      if (valuesEqual(toFieldValue(display), toFieldValue(snapshot))) return "none";
      return hasOverrideEntry ? "verified" : "unverified";
    }

    function buildRowFields(
      row: DriftSourceRow,
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
        const hasOverride = isOverrideEntry(overrideEntry);
        const overrideValue = hasOverride ? overrideEntry.value : null;
        const driftClass = classify(live, snap, overrideValue, hasOverride);
        const cellFmt =
          cellFormat && typeof cellFormat === "object"
            ? (cellFormat as Record<string, DriftRowField["cellFormat"]>)[f] ?? null
            : null;
        fields.push({
          fieldName: f,
          liveValue: scalarOrNull(live),
          snapshotValue: scalarOrNull(snap),
          overrideValue: hasOverride ? scalarOrNull(overrideValue) : null,
          overrideEditor: hasOverride ? overrideEntry.editedBy ?? null : null,
          overrideEditedAt: hasOverride ? overrideEntry.editedAt ?? null : null,
          overrideReason: hasOverride ? overrideEntry.note ?? null : null,
          cellFormat: cellFmt,
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

    function countLegacyRows(rawRows: Array<{ importSnapshot?: unknown }>): number {
      // Active rows where import_snapshot has never been populated.
      // Drift detection on these rows treats every non-null live value
      // as drift (because the snapshot is null), so a project still
      // pending the workstream-B backfill will look 100% drifted. The
      // diff page surfaces this count via a banner so the operator
      // knows to run `scripts/backfill-import-snapshot.ts` first.
      let n = 0;
      for (const r of rawRows) if (r.importSnapshot == null) n++;
      return n;
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

    // The Drizzle row types are a structural superset of DriftSourceRow at
    // runtime (id/projectId/sourceRow + the dynamic tracked-field columns);
    // narrow once at the boundary so the helpers stay precisely typed.
    const costSrc = costRows as unknown as DriftSourceRow[];
    const revSrc = revRows as unknown as DriftSourceRow[];
    const planSrc = planRows as unknown as DriftSourceRow[];

    const costLines: DriftRow[] = costSrc.map((r) => ({
      id: r.id,
      rowHash: r.rowHash ?? null,
      displayLabel: typeof r.description === "string" ? r.description : `Row ${r.sourceRow ?? r.id}`,
      sourceRow: r.sourceRow ?? null,
      fields: buildRowFields(r, EXPENDITURE_TRACKED_FIELDS),
    }));
    const revenueLines: DriftRow[] = revSrc.map((r) => ({
      id: r.id,
      rowHash: r.rowHash ?? null,
      displayLabel: typeof r.milestoneName === "string" ? r.milestoneName : `Row ${r.sourceRow ?? r.id}`,
      sourceRow: r.sourceRow ?? null,
      fields: buildRowFields(r, REVENUE_TRACKED_FIELDS),
    }));
    const planTasks: DriftRow[] = planSrc.map((r) => ({
      id: r.id,
      rowHash: r.rowHash ?? null,
      displayLabel: typeof r.title === "string" ? r.title : `Task ${r.sourceRow ?? r.id}`,
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
      legacyRowsWithoutSnapshot: {
        EXPENDITURE: countLegacyRows(costSrc),
        REVENUE: countLegacyRows(revSrc),
        PLAN: countLegacyRows(planSrc),
      },
    };
  }

  /**
   * Program-wide drift summary in a single round of queries.
   *
   * Replaces the N+1 pattern (`Promise.all(projects.map(getDriftDetail))`)
   * the route used to issue. Reads each canonical table ONCE for all
   * projects, buckets by `project_id`, and classifies fields in JS.
   *
   * For a 50-project portfolio with Mondi-sized data this is roughly
   * 3 + 50 = 53 round trips replaced by 4 round trips, plus identical
   * per-row JS classification cost. The dominant cost on large
   * portfolios was query latency, not classification time.
   *
   * Returns the same per-project rows the program endpoint already
   * exposes — no API contract change.
   */
  async getProgramDriftSummary(): Promise<ProgramDriftRow[]> {
    const { valuesEqual } = await import("../lib/import/merge-engine");
    const {
      PLAN_TRACKED_FIELDS,
      REVENUE_TRACKED_FIELDS,
      EXPENDITURE_TRACKED_FIELDS,
    } = await import("@shared/excel-vs-app/contract");

    function readJsonbObject(v: unknown): JsonbRecord {
      if (!v || typeof v !== "object" || Array.isArray(v)) return {};
      return v as JsonbRecord;
    }

    function summariseRows(
      rows: DriftSourceRow[],
      trackedFields: readonly string[],
    ): { verified: number; unverified: number; legacyRows: number } {
      let verified = 0, unverified = 0, legacyRows = 0;
      for (const row of rows) {
        const snapshot = readJsonbObject(row.importSnapshot);
        const overrides = readJsonbObject(row.manualOverrides);
        if (row.importSnapshot == null) legacyRows++;
        for (const f of trackedFields) {
          const live = row[f] ?? null;
          const snap = snapshot[f] ?? null;
          const overrideEntry = overrides[f];
          const hasOverride = isOverrideEntry(overrideEntry);
          const display = hasOverride ? overrideEntry.value : live;
          if (valuesEqual(toFieldValue(display), toFieldValue(snap))) continue;
          if (hasOverride) verified++;
          else unverified++;
        }
      }
      return { verified, unverified, legacyRows };
    }

    function bucketBy<T extends { projectId: number }>(rows: T[]): Map<number, T[]> {
      const m = new Map<number, T[]>();
      for (const r of rows) {
        const k = r.projectId;
        const bucket = m.get(k);
        if (bucket) bucket.push(r);
        else m.set(k, [r]);
      }
      return m;
    }

    const [projects, costRows, revRows, planRows] = await Promise.all([
      this.dbInstance
        .select({ id: projectInfo.id, projectName: projectInfo.projectName })
        .from(projectInfo),
      this.dbInstance
        .select()
        .from(normalizedCostLines)
        .where(
          and(
            isNull(normalizedCostLines.effectiveTo),
            isNull(normalizedCostLines.deletedAt),
          ),
        ),
      this.dbInstance
        .select()
        .from(normalizedRevenueLines)
        .where(
          and(
            isNull(normalizedRevenueLines.effectiveTo),
            isNull(normalizedRevenueLines.deletedAt),
          ),
        ),
      this.dbInstance
        .select()
        .from(workItems)
        .where(isNull(workItems.deletedAt)),
    ]);

    // Same boundary narrowing as getDriftDetail: the Drizzle rows are a
    // structural superset of DriftSourceRow at runtime.
    const costByProject = bucketBy(costRows as unknown as DriftSourceRow[]);
    const revByProject = bucketBy(revRows as unknown as DriftSourceRow[]);
    const planByProject = bucketBy(planRows as unknown as DriftSourceRow[]);

    return projects.map((p: { id: number; projectName: string }) => {
      const costSummary = summariseRows(costByProject.get(p.id) ?? [], EXPENDITURE_TRACKED_FIELDS);
      const revSummary = summariseRows(revByProject.get(p.id) ?? [], REVENUE_TRACKED_FIELDS);
      const planSummary = summariseRows(planByProject.get(p.id) ?? [], PLAN_TRACKED_FIELDS);
      return {
        projectId: p.id,
        projectName: p.projectName,
        section: {
          EXPENDITURE: { verified: costSummary.verified, unverified: costSummary.unverified },
          REVENUE: { verified: revSummary.verified, unverified: revSummary.unverified },
          PLAN: { verified: planSummary.verified, unverified: planSummary.unverified },
        },
        verified: costSummary.verified + revSummary.verified + planSummary.verified,
        unverified: costSummary.unverified + revSummary.unverified + planSummary.unverified,
        legacyRowsWithoutSnapshot: {
          EXPENDITURE: costSummary.legacyRows,
          REVENUE: revSummary.legacyRows,
          PLAN: planSummary.legacyRows,
        },
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Drift-resolution writes (diff page)
// ---------------------------------------------------------------------------
//
// These small methods exist so excel-vs-app.routes.ts doesn't bypass the
// repository layer (CLAUDE.md "Repository layer: CRUD in routes must
// go through server/repositories/*"). Each is a thin wrapper around a
// single SQL operation; the routes file owns the orchestration.

export class TrackerReplicaWriteRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  /** Look up a project's name by id. Returns null when no project_info
   *  row matches — caller surfaces a 404. */
  async getProjectName(projectId: number): Promise<string | null> {
    const [row] = await this.dbInstance
      .select({ projectName: projectInfo.projectName })
      .from(projectInfo)
      .where(eq(projectInfo.id, projectId))
      .limit(1);
    return row?.projectName ?? null;
  }

  /** Read the work_item.ownerUserId for the PLAN-section owner
   *  exception. Returns null when the row doesn't exist. */
  async getWorkItemOwnerUserId(workItemId: number): Promise<number | null> {
    const [row] = await this.dbInstance
      .select({ ownerUserId: workItems.ownerUserId })
      .from(workItems)
      .where(eq(workItems.id, workItemId))
      .limit(1);
    return row?.ownerUserId ?? null;
  }

  /** File a drift-approval request into the financial_edit_requests
   *  queue. The section's reviewers see it via the diff page's
   *  pending-requests panel. */
  async createDriftApprovalRequest(input: {
    projectId: number;
    projectName: string;
    requestedByUserId: number;
    editType: string;
    editPayload: string;
    editSummary: string;
    affectsRevenue: boolean;
    affectsExpenditure: boolean;
  }): Promise<FinancialEditRequest> {
    const [saved] = await this.dbInstance
      .insert(financialEditRequests)
      .values({
        projectName: input.projectName,
        projectId: input.projectId,
        requestedByUserId: input.requestedByUserId,
        editType: input.editType,
        editTarget: "excel_vs_app",
        editPayload: input.editPayload,
        editSummary: input.editSummary,
        isCriticalPath: false,
        affectsRevenue: input.affectsRevenue,
        affectsExpenditure: input.affectsExpenditure,
        affectsQuality: false,
      })
      .returning();
    return saved as FinancialEditRequest;
  }
}

export const trackerReplicaWriteRepository = new TrackerReplicaWriteRepository();

export interface ProgramDriftRow {
  projectId: number;
  projectName: string;
  section: {
    EXPENDITURE: DriftSectionSummary;
    REVENUE: DriftSectionSummary;
    PLAN: DriftSectionSummary;
  };
  verified: number;
  unverified: number;
  legacyRowsWithoutSnapshot: {
    EXPENDITURE: number;
    REVENUE: number;
    PLAN: number;
  };
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
  /** Per-section count of active rows whose import_snapshot is NULL.
   *  When non-zero on any section, the diff page renders a "backfill
   *  required" banner — drift detection on those rows is unreliable
   *  until the backfill script populates their snapshots. */
  legacyRowsWithoutSnapshot: {
    EXPENDITURE: number;
    REVENUE: number;
    PLAN: number;
  };
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
  editedByName: string | null;
  editedAt: string;
}

export const trackerReplicaRepository = new TrackerReplicaRepository();
