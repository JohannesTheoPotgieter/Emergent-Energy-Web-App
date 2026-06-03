/**
 * FYE Tracking — data access for the spec'd tab (View A project table + View B
 * dashboard). Reads project identity / execution state / tracker source-file
 * metadata and the manual Revised-Budget rows. All snapshot reads apply the
 * `effectiveTo IS NULL` guard (§ 3.1). The canonical per-line revenue/COS comes
 * from `FinanceLineLevelRepository` — not from here.
 */

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  projectInfo,
  projectExecutionState,
  trackerProjectMetadata,
  fyeRevisedBudgetMonthly,
  smartImportRuns,
} from "@shared/schema";
import { db } from "../db";

export interface FyeProjectMetaRow {
  projectId: number;
  projectName: string;
  projectCode: string | null;
  projectStatus: string | null;
  phase: string | null;
  archivedStatus: string | null;
  pcActual: string | null;
  pcTarget: string | null;
  constructionStartActual: string | null;
  constructionStartDate: string | null;
}

export interface TrackerSourceRow {
  sourceFileName: string | null;
  committedAt: Date | null;
  uploadedAt: Date | null;
}

const asIso = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

export class FyeTrackingDataRepository {
  private _db?: typeof db;
  constructor(dbInstance?: typeof db) {
    this._db = dbInstance;
  }
  private get dbi(): typeof db {
    return this._db || db;
  }

  /** All projects joined to execution state, with the date/phase fields the
   * FYE tab needs to derive Type and Start/End-PC. */
  async listProjectMeta(): Promise<FyeProjectMetaRow[]> {
    const rows = (await this.dbi
      .select({
        projectId: projectInfo.id,
        projectName: projectInfo.projectName,
        projectCode: projectInfo.projectCode,
        projectStatus: projectInfo.projectStatus,
        phase: projectExecutionState.phase,
        archivedStatus: projectExecutionState.archivedStatus,
        pcActual: projectExecutionState.practicalCompletionActual,
        pcTarget: projectExecutionState.practicalCompletionTarget,
        constructionStartActual: projectExecutionState.constructionStartActual,
        constructionStartDate: projectExecutionState.constructionStartDate,
      })
      .from(projectInfo)
      .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
      .where(isNull(projectInfo.deletedAt))) as Array<{
      projectId: number;
      projectName: string | null;
      projectCode: string | null;
      projectStatus: string | null;
      phase: string | null;
      archivedStatus: string | null;
      pcActual: unknown;
      pcTarget: unknown;
      constructionStartActual: unknown;
      constructionStartDate: unknown;
    }>;

    return rows.map((r) => ({
      projectId: Number(r.projectId),
      projectName: r.projectName ?? "",
      projectCode: r.projectCode ?? null,
      projectStatus: r.projectStatus ?? null,
      phase: r.phase ?? null,
      archivedStatus: r.archivedStatus ?? null,
      pcActual: asIso(r.pcActual),
      pcTarget: asIso(r.pcTarget),
      constructionStartActual: asIso(r.constructionStartActual),
      constructionStartDate: asIso(r.constructionStartDate),
    }));
  }

  /** Latest committed tracker source file per project (for exclusion matching
   * on file/folder name). One entry per project — the most recent run. */
  async listLatestTrackerSourceByProject(): Promise<Map<number, TrackerSourceRow>> {
    const rows = await this.dbi
      .select({
        projectId: smartImportRuns.projectId,
        sourceFileName: smartImportRuns.sourceFileName,
        committedAt: smartImportRuns.committedAt,
        uploadedAt: smartImportRuns.uploadedAt,
        status: smartImportRuns.status,
      })
      .from(smartImportRuns)
      .where(inArray(smartImportRuns.status, ["committed", "superseded"]))
      .orderBy(desc(smartImportRuns.committedAt), desc(smartImportRuns.uploadedAt));

    const out = new Map<number, TrackerSourceRow>();
    for (const r of rows) {
      const pid = r.projectId == null ? null : Number(r.projectId);
      if (pid == null || out.has(pid)) continue; // rows are newest-first → keep first
      out.set(pid, {
        sourceFileName: r.sourceFileName ?? null,
        committedAt: r.committedAt ?? null,
        uploadedAt: r.uploadedAt ?? null,
      });
    }
    return out;
  }

  /** Tracker metadata dates per project (snapshot-guarded). */
  async listTrackerMetadataDates(): Promise<
    Map<number, { startDate: string | null; baselineCompletion: string | null; forecastedCompletion: string | null }>
  > {
    const rows = await this.dbi
      .select({
        projectId: trackerProjectMetadata.projectId,
        projectStartDate: trackerProjectMetadata.projectStartDate,
        baselineCompletionDate: trackerProjectMetadata.baselineCompletionDate,
        forecastedCompletionDate: trackerProjectMetadata.forecastedCompletionDate,
      })
      .from(trackerProjectMetadata)
      .where(isNull(trackerProjectMetadata.effectiveTo));

    const out = new Map<number, { startDate: string | null; baselineCompletion: string | null; forecastedCompletion: string | null }>();
    for (const r of rows) {
      out.set(Number(r.projectId), {
        startDate: asIso(r.projectStartDate),
        baselineCompletion: asIso(r.baselineCompletionDate),
        forecastedCompletion: asIso(r.forecastedCompletionDate),
      });
    }
    return out;
  }

  /** Most-recent committed import run overall — drives the "as at" banner. */
  async getLatestCommittedImportRun(): Promise<{ sourceFileName: string | null; committedAt: Date | null } | null> {
    const [row] = await this.dbi
      .select({ sourceFileName: smartImportRuns.sourceFileName, committedAt: smartImportRuns.committedAt })
      .from(smartImportRuns)
      .where(eq(smartImportRuns.status, "committed"))
      .orderBy(desc(smartImportRuns.committedAt))
      .limit(1);
    return row ? { sourceFileName: row.sourceFileName ?? null, committedAt: row.committedAt ?? null } : null;
  }

  // ── Revised Budget (manual, once-off monthly) ──────────────────────────────

  async getRevisedBudget(fye: number): Promise<Array<{ metric: string; monthKey: string; amount: number }>> {
    const rows = (await this.dbi
      .select({
        metric: fyeRevisedBudgetMonthly.metric,
        monthKey: fyeRevisedBudgetMonthly.monthKey,
        amount: fyeRevisedBudgetMonthly.amount,
      })
      .from(fyeRevisedBudgetMonthly)
      .where(eq(fyeRevisedBudgetMonthly.fye, fye))) as Array<{
      metric: string;
      monthKey: string;
      amount: unknown;
    }>;
    return rows.map((r) => ({ metric: r.metric, monthKey: r.monthKey, amount: Number(r.amount ?? 0) }));
  }

  /** Upsert one Revised-Budget cell. Single statement with CURRENT_TIMESTAMP
   * defaults (outside the no-raw-SQL repository lint scope). */
  async upsertRevisedBudget(input: {
    fye: number;
    metric: string;
    monthKey: string;
    amount: string;
    userId: number | null;
  }): Promise<void> {
    const existing = await this.dbi
      .select({ id: fyeRevisedBudgetMonthly.id })
      .from(fyeRevisedBudgetMonthly)
      .where(
        and(
          eq(fyeRevisedBudgetMonthly.fye, input.fye),
          eq(fyeRevisedBudgetMonthly.metric, input.metric),
          eq(fyeRevisedBudgetMonthly.monthKey, input.monthKey),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await this.dbi
        .update(fyeRevisedBudgetMonthly)
        .set({ amount: input.amount, updatedBy: input.userId, updatedAt: new Date() })
        .where(eq(fyeRevisedBudgetMonthly.id, existing[0].id));
    } else {
      await this.dbi.insert(fyeRevisedBudgetMonthly).values({
        fye: input.fye,
        metric: input.metric,
        monthKey: input.monthKey,
        amount: input.amount,
        updatedBy: input.userId,
      });
    }
  }
}
