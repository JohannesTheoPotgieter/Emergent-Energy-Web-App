// ============================================================
// Execution Board repository — READ/COMPOSE ONLY
//
// Batched reads for the program-wide Execution control tower. Every method
// fetches one capability across a SET of project ids in a single query
// (no N+1), mirroring computeAllProjectPlanPills.
//
// HARD: this layer is READ-ONLY against the canonical/finance surfaces it
// reads (normalized_plan_tasks, project_plan, procurement_items,
// counterparties, project_eng_*, snags). It NEVER writes them. The schedule
// backbone is read VERBATIM from the latest import run per project
// (normalized_plan_tasks) — NOT via plan-rollup-service (owner decision
// 2026-06-19).
// ============================================================

import { and, asc, desc, eq, inArray, isNull, notInArray, count } from "drizzle-orm";
import { db } from "../db";
import {
  projectInfo,
  projectExecutionState,
  projectEditableFields,
  projectSubcontractorAssignments,
  projectDeliveryMilestones,
  procurementItems,
  counterparties,
  projectEngStages,
  projectEngTasks,
  snags,
  qcPlanLink,
  normalizedPlanTasks,
  smartImportRuns,
  users,
  type NormalizedPlanTask,
  type ProjectDeliveryMilestone,
} from "@shared/schema";

export interface ActiveProjectRow {
  id: number;
  projectName: string;
  phase: string | null;
  pmUserId: number | null;
  pdUserId: number | null;
  pmText: string | null;
  pdText: string | null;
  sizeKwp: string | null;
  contractValue: string | null;
}

export interface InstallerRow {
  id: number;
  projectId: number;
  counterpartyId: number;
  counterpartyName: string | null;
  counterpartyType: string | null;
  workPackage: string | null;
  scopeDescription: string | null;
  status: string;
}

export interface ProcurementDeliveryRow {
  id: number;
  projectId: number;
  title: string;
  status: string;
  requiredDate: string | null;
  supplierId: number | null;
  progressPercent: number | null;
}

export interface EngStageRow {
  projectId: number;
  status: string;
}

export interface SnagRow {
  projectId: number;
  severity: string | null;
  status: string | null;
  dueDate: string | null;
}

/** Plan tasks + the import-run provenance they were read from. */
export interface ProjectPlanTasks {
  runId: number | null;
  importedAt: Date | null;
  tasks: NormalizedPlanTask[];
}

export class ExecutionBoardRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  /** Every active, non-archived project (one row each). */
  async getActiveProjects(): Promise<ActiveProjectRow[]> {
    return this.dbInstance
      .select({
        id: projectInfo.id,
        projectName: projectInfo.projectName,
        phase: projectExecutionState.phase,
        pmUserId: projectInfo.pmUserId,
        pdUserId: projectInfo.pdUserId,
        pmText: projectInfo.pm,
        pdText: projectInfo.pd,
        sizeKwp: projectInfo.sizeKwp,
        contractValue: projectInfo.contractValue,
      })
      .from(projectInfo)
      .innerJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
      .where(
        and(
          eq(projectExecutionState.archivedStatus, "ACTIVE"),
          isNull(projectExecutionState.deletedAt),
          isNull(projectInfo.deletedAt),
        ),
      )
      .orderBy(asc(projectInfo.projectName));
  }

  /** Single project header (active or not) — for the detail view. */
  async getProjectHeader(projectId: number): Promise<ActiveProjectRow | undefined> {
    const [row] = await this.dbInstance
      .select({
        id: projectInfo.id,
        projectName: projectInfo.projectName,
        phase: projectExecutionState.phase,
        pmUserId: projectInfo.pmUserId,
        pdUserId: projectInfo.pdUserId,
        pmText: projectInfo.pm,
        pdText: projectInfo.pd,
        sizeKwp: projectInfo.sizeKwp,
        contractValue: projectInfo.contractValue,
      })
      .from(projectInfo)
      .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
      .where(and(eq(projectInfo.id, projectId), isNull(projectInfo.deletedAt)));
    return row;
  }

  /** Map of projectId → latest smart-import run id (by uploadedAt). */
  async getLatestRunIdsByProjects(projectIds: number[]): Promise<Map<number, { runId: number; uploadedAt: Date | null }>> {
    const out = new Map<number, { runId: number; uploadedAt: Date | null }>();
    if (projectIds.length === 0) return out;
    const rows = await this.dbInstance
      .select({
        id: smartImportRuns.id,
        projectId: smartImportRuns.projectId,
        uploadedAt: smartImportRuns.uploadedAt,
        status: smartImportRuns.status,
      })
      .from(smartImportRuns)
      .where(inArray(smartImportRuns.projectId, projectIds))
      .orderBy(desc(smartImportRuns.uploadedAt));

    // Prefer the latest COMMITTED import (the published plan), but fall back to
    // the latest non-failed run so a project whose imports were never formally
    // committed still shows its plan instead of a blank schedule.
    const BAD_STATUSES = new Set(["failed", "rolled_back", "rejected"]);
    const committed = new Map<number, { runId: number; uploadedAt: Date | null }>();
    const fallback = new Map<number, { runId: number; uploadedAt: Date | null }>();
    for (const row of rows) {
      if (row.projectId == null) continue;
      const pick = { runId: row.id, uploadedAt: row.uploadedAt ?? null };
      if (row.status === "committed" && !committed.has(row.projectId)) {
        committed.set(row.projectId, pick);
      }
      if (!BAD_STATUSES.has(row.status ?? "") && !fallback.has(row.projectId)) {
        fallback.set(row.projectId, pick);
      }
    }
    for (const pid of projectIds) {
      const pick = committed.get(pid) ?? fallback.get(pid);
      if (pick) out.set(pid, pick);
    }
    return out;
  }

  /** All plan tasks for a set of run ids (one query). */
  async getPlanTasksByRunIds(runIds: number[]): Promise<NormalizedPlanTask[]> {
    if (runIds.length === 0) return [];
    return this.dbInstance
      .select()
      .from(normalizedPlanTasks)
      .where(inArray(normalizedPlanTasks.importRunId, runIds))
      .orderBy(asc(normalizedPlanTasks.taskNo));
  }

  /** Verbatim WBS for one project, from its latest import run. */
  async getPlanTasksForProject(projectId: number): Promise<ProjectPlanTasks> {
    const latest = await this.getLatestRunIdsByProjects([projectId]);
    const meta = latest.get(projectId);
    if (!meta) return { runId: null, importedAt: null, tasks: [] };
    const tasks = await this.dbInstance
      .select()
      .from(normalizedPlanTasks)
      .where(eq(normalizedPlanTasks.importRunId, meta.runId))
      .orderBy(asc(normalizedPlanTasks.taskNo));
    return { runId: meta.runId, importedAt: meta.uploadedAt, tasks };
  }

  /** Active subcontractor/supplier assignments for a set of projects. */
  async getInstallersForProjects(projectIds: number[]): Promise<InstallerRow[]> {
    if (projectIds.length === 0) return [];
    return this.dbInstance
      .select({
        id: projectSubcontractorAssignments.id,
        projectId: projectSubcontractorAssignments.projectId,
        counterpartyId: projectSubcontractorAssignments.counterpartyId,
        counterpartyName: counterparties.nameCanonical,
        counterpartyType: counterparties.typeDefault,
        workPackage: projectSubcontractorAssignments.workPackage,
        scopeDescription: projectSubcontractorAssignments.scopeDescription,
        status: projectSubcontractorAssignments.status,
      })
      .from(projectSubcontractorAssignments)
      .leftJoin(counterparties, eq(counterparties.id, projectSubcontractorAssignments.counterpartyId))
      .where(
        and(
          inArray(projectSubcontractorAssignments.projectId, projectIds),
          eq(projectSubcontractorAssignments.status, "active"),
        ),
      );
  }

  /** Live delivery milestones for a set of projects. */
  async getDeliveryMilestonesForProjects(projectIds: number[]): Promise<ProjectDeliveryMilestone[]> {
    if (projectIds.length === 0) return [];
    return this.dbInstance
      .select()
      .from(projectDeliveryMilestones)
      .where(
        and(
          inArray(projectDeliveryMilestones.projectId, projectIds),
          isNull(projectDeliveryMilestones.deletedAt),
        ),
      );
  }

  /** Open procurement items (not received/invoiced/closed) for a set of projects. */
  async getOpenProcurementForProjects(projectIds: number[]): Promise<ProcurementDeliveryRow[]> {
    if (projectIds.length === 0) return [];
    return this.dbInstance
      .select({
        id: procurementItems.id,
        projectId: procurementItems.projectId,
        title: procurementItems.title,
        status: procurementItems.status,
        requiredDate: procurementItems.requiredDate,
        supplierId: procurementItems.supplierId,
        progressPercent: procurementItems.progressPercent,
      })
      .from(procurementItems)
      .where(
        and(
          inArray(procurementItems.projectId, projectIds),
          notInArray(procurementItems.status, ["received", "invoiced", "closed"]),
        ),
      );
  }

  /** Engineering stage statuses for a set of projects. */
  async getEngStagesForProjects(projectIds: number[]): Promise<EngStageRow[]> {
    if (projectIds.length === 0) return [];
    return this.dbInstance
      .select({ projectId: projectEngStages.projectId, status: projectEngStages.status })
      .from(projectEngStages)
      .where(inArray(projectEngStages.projectId, projectIds));
  }

  /** Count of incomplete engineering tasks per project (one grouped query). */
  async getOpenEngTaskCounts(projectIds: number[]): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    if (projectIds.length === 0) return out;
    const rows = await this.dbInstance
      .select({ projectId: projectEngStages.projectId, c: count() })
      .from(projectEngTasks)
      .innerJoin(projectEngStages, eq(projectEngTasks.projectEngStageId, projectEngStages.id))
      .where(
        and(
          inArray(projectEngStages.projectId, projectIds),
          notInArray(projectEngTasks.status, ["complete", "skipped"]),
        ),
      )
      .groupBy(projectEngStages.projectId);
    for (const row of rows) out.set(row.projectId, Number(row.c));
    return out;
  }

  /** Snags for a set of projects. */
  async getSnagsForProjects(projectIds: number[]): Promise<SnagRow[]> {
    if (projectIds.length === 0) return [];
    return this.dbInstance
      .select({
        projectId: snags.projectId,
        severity: snags.severity,
        status: snags.status,
        dueDate: snags.dueDate,
      })
      .from(snags)
      .where(inArray(snags.projectId, projectIds));
  }

  /** Set of projectIds that have at least one QC plan link. */
  async getQcLinkedProjectIds(projectIds: number[]): Promise<Set<number>> {
    const out = new Set<number>();
    if (projectIds.length === 0) return out;
    const rows = await this.dbInstance
      .select({ projectId: qcPlanLink.projectId })
      .from(qcPlanLink)
      .where(inArray(qcPlanLink.projectId, projectIds))
      .groupBy(qcPlanLink.projectId);
    for (const row of rows) if (row.projectId != null) out.add(row.projectId);
    return out;
  }

  /**
   * The free-text "latest update" note for a project (construction manager's
   * running status). Keyed by projectName — the same key the PATCH
   * /api/projects-summary/:projectName/latest-update endpoint upserts on.
   */
  async getLatestUpdate(
    projectName: string,
  ): Promise<{ latestUpdate: string | null; latestUpdateBy: string | null; latestUpdateAt: Date | null } | undefined> {
    const [row] = await this.dbInstance
      .select({
        latestUpdate: projectEditableFields.latestUpdate,
        latestUpdateBy: projectEditableFields.latestUpdateBy,
        latestUpdateAt: projectEditableFields.latestUpdateAt,
      })
      .from(projectEditableFields)
      .where(eq(projectEditableFields.projectName, projectName));
    return row;
  }

  /** Resolve user display names for a set of user ids. */
  async getUserNamesByIds(userIds: number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    const ids = userIds.filter((x): x is number => typeof x === "number");
    if (ids.length === 0) return out;
    const rows = await this.dbInstance
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, ids));
    for (const row of rows) out.set(row.id, row.name);
    return out;
  }
}

export const executionBoardRepository = new ExecutionBoardRepository();
