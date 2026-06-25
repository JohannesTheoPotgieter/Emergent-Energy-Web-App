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

import { and, asc, eq, inArray, isNull, notInArray, count } from "drizzle-orm";
import { isMilestoneWbs } from "@shared/lib/milestone-wbs";
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
  workItems,
  users,
  type ProjectDeliveryMilestone,
} from "@shared/schema";
import type { PlanTask } from "../services/execution-board-math";

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
  // Editable project-info fields surfaced for the board's inline editors
  // (RAG status + Edit Project Info modal). ragStatus + the planned key dates
  // live on projectExecutionState; pd/pm/sizeKwp on projectInfo.
  ragStatus: string | null;
  constructionStartDate: string | null;
  commissioningDate: string | null;
  omHandoverDate: string | null;
  clientHandoverDate: string | null;
}

export interface InstallerRow {
  id: number;
  projectId: number;
  counterpartyId: number;
  counterpartyName: string | null;
  counterpartyType: string | null;
  /** Per-assignment role on this project (SUBCONTRACTOR_ROLES); falls back to the
   *  counterparty type for display when not set. */
  role: string | null;
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

/** A procurement order as a planned delivery: its lead-time fields plus the
 *  execution task it feeds (the task's start date is the "needed on site" date). */
export interface ProcurementDeliveryFullRow {
  id: number;
  projectId: number;
  title: string;
  status: string;
  requiredDate: string | null;
  leadTimeDays: number | null;
  orderDate: string | null;
  deliveryExpectedDate: string | null;
  deliveryActualDate: string | null;
  deliveryStatus: string | null;
  isLongLead: boolean | null;
  linkedWorkItemId: number | null;
  taskNo: string | null;
  taskTitle: string | null;
  taskStartDate: string | null;
  taskEndDate: string | null;
}

/** A work item exposed for the deliveries task picker. */
export interface WorkItemPickRow {
  id: number;
  taskNo: string | null;
  title: string;
  startDate: string | null;
  endDate: string | null;
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

/** Plan tasks + an approximate "as imported" date. */
export interface ProjectPlanTasks {
  runId: number | null;
  importedAt: Date | null;
  tasks: PlanTask[];
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
  /**
   * Projects for the execution lenses. By default only ACTIVE (non-archived)
   * projects — the active-delivery lists. Pass `includeArchived` for the board,
   * which shows the full phase universe so a by-phase filter returns EVERY
   * project in that phase, including completed/archived ones. Deleted rows are
   * always excluded.
   */
  async getActiveProjects(includeArchived = false): Promise<ActiveProjectRow[]> {
    const conditions = [
      isNull(projectExecutionState.deletedAt),
      isNull(projectInfo.deletedAt),
    ];
    if (!includeArchived) {
      conditions.push(eq(projectExecutionState.archivedStatus, "ACTIVE"));
    }
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
        ragStatus: projectExecutionState.ragStatus,
        constructionStartDate: projectExecutionState.constructionStartDate,
        commissioningDate: projectExecutionState.commissioningDate,
        omHandoverDate: projectExecutionState.omHandoverDate,
        clientHandoverDate: projectExecutionState.clientHandoverDate,
      })
      .from(projectInfo)
      .innerJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
      .where(and(...conditions))
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
        ragStatus: projectExecutionState.ragStatus,
        constructionStartDate: projectExecutionState.constructionStartDate,
        commissioningDate: projectExecutionState.commissioningDate,
        omHandoverDate: projectExecutionState.omHandoverDate,
        clientHandoverDate: projectExecutionState.clientHandoverDate,
      })
      .from(projectInfo)
      .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
      .where(and(eq(projectInfo.id, projectId), isNull(projectInfo.deletedAt)));
    return row;
  }

  // ── Program plan, read from work_items (the canonical Plan-tab table) ──
  // The imported program plan lives in work_items (PM/ENG/QUALITY workstreams),
  // NOT in the dead normalized_plan_tasks table. The filter mirrors the Plan
  // tab's per-project fetch so the board's row set matches what the Plan tab
  // shows. (We compute our own duration-weighted % — not plan-rollup pills.)
  private async fetchPlanWorkItems(projectIds: number[]) {
    return this.dbInstance
      .select({
        id: workItems.id,
        projectId: workItems.projectId,
        wbsCode: workItems.wbsCode,
        outlineNumber: workItems.outlineNumber,
        title: workItems.title,
        phase: workItems.phase,
        workstream: workItems.workstream,
        startDate: workItems.startDate,
        endDate: workItems.endDate,
        actualStart: workItems.actualStart,
        actualEnd: workItems.actualEnd,
        duration: workItems.duration,
        percentComplete: workItems.percentComplete,
        expectedPctComplete: workItems.expectedPctComplete,
        isMilestone: workItems.isMilestone,
        parentId: workItems.parentId,
        description: workItems.description,
        updatedAt: workItems.updatedAt,
      })
      .from(workItems)
      .where(
        and(
          inArray(workItems.workstream, ["PM", "ENG", "QUALITY"]),
          isNull(workItems.deletedAt),
          inArray(workItems.projectId, projectIds),
        ),
      )
      .orderBy(asc(workItems.projectId), asc(workItems.sortOrder), asc(workItems.sourceRow), asc(workItems.id));
  }

  private toPlanTasksByProject(
    rows: Awaited<ReturnType<ExecutionBoardRepository["fetchPlanWorkItems"]>>,
  ): Map<number, PlanTask[]> {
    const idToTaskNo = new Map<number, string>();
    for (const r of rows) idToTaskNo.set(r.id, r.wbsCode || r.outlineNumber || `#${r.id}`);
    const byProject = new Map<number, PlanTask[]>();
    for (const r of rows) {
      if (r.projectId == null) continue;
      const task: PlanTask = {
        id: r.id,
        taskNo: r.wbsCode || r.outlineNumber || `#${r.id}`,
        taskName: r.title,
        phase: r.phase ?? null,
        workstream: r.workstream ?? null,
        startDate: r.startDate ?? null,
        endDate: r.endDate ?? null,
        actualStartDate: r.actualStart ?? null,
        actualEndDate: r.actualEnd ?? null,
        durationDays: r.duration ?? null,
        pctComplete: r.percentComplete ?? null,
        expectedPctComplete: r.expectedPctComplete ?? null,
        isMilestone: isMilestoneWbs(r.wbsCode),
        parentTaskNo: r.parentId != null ? (idToTaskNo.get(r.parentId) ?? null) : null,
        comment: r.description ?? null,
      };
      const arr = byProject.get(r.projectId) ?? [];
      arr.push(task);
      byProject.set(r.projectId, arr);
    }
    return byProject;
  }

  /** Program-plan tasks for a set of projects (batched, one query). */
  async getPlanTasksForProjects(projectIds: number[]): Promise<Map<number, PlanTask[]>> {
    if (projectIds.length === 0) return new Map();
    const rows = await this.fetchPlanWorkItems(projectIds);
    return this.toPlanTasksByProject(rows);
  }

  /** Program-plan tasks for one project + an approximate "as imported" date. */
  async getPlanTasksForProject(projectId: number): Promise<ProjectPlanTasks> {
    const rows = await this.fetchPlanWorkItems([projectId]);
    const tasks = this.toPlanTasksByProject(rows).get(projectId) ?? [];
    let importedAt: Date | null = null;
    for (const r of rows) {
      if (r.updatedAt && (!importedAt || r.updatedAt > importedAt)) importedAt = r.updatedAt;
    }
    return { runId: null, importedAt, tasks };
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
        role: projectSubcontractorAssignments.role,
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

  /** All (non-deleted) procurement orders as planned deliveries, with the linked
   *  execution task's dates for "needed on site". Includes completed ones so the
   *  Deliveries view can hide/show them (the board still uses the open-only read). */
  async getProcurementDeliveriesForProjects(projectIds: number[]): Promise<ProcurementDeliveryFullRow[]> {
    if (projectIds.length === 0) return [];
    const rows = await this.dbInstance
      .select({
        id: procurementItems.id,
        projectId: procurementItems.projectId,
        title: procurementItems.title,
        status: procurementItems.status,
        requiredDate: procurementItems.requiredDate,
        leadTimeDays: procurementItems.leadTimeDays,
        orderDate: procurementItems.orderDate,
        deliveryExpectedDate: procurementItems.deliveryExpectedDate,
        deliveryActualDate: procurementItems.deliveryActualDate,
        deliveryStatus: procurementItems.deliveryStatus,
        isLongLead: procurementItems.isLongLead,
        linkedWorkItemId: procurementItems.linkedWorkItemId,
        wbsCode: workItems.wbsCode,
        outlineNumber: workItems.outlineNumber,
        taskTitle: workItems.title,
        taskStartDate: workItems.startDate,
        taskEndDate: workItems.endDate,
      })
      .from(procurementItems)
      .leftJoin(workItems, eq(workItems.id, procurementItems.linkedWorkItemId))
      .where(and(inArray(procurementItems.projectId, projectIds), isNull(procurementItems.deletedAt)));
    const out: ProcurementDeliveryFullRow[] = [];
    for (const r of rows) {
      out.push({
        id: r.id,
        projectId: r.projectId,
        title: r.title,
        status: r.status,
        requiredDate: r.requiredDate,
        leadTimeDays: r.leadTimeDays,
        orderDate: r.orderDate,
        deliveryExpectedDate: r.deliveryExpectedDate,
        deliveryActualDate: r.deliveryActualDate,
        deliveryStatus: r.deliveryStatus,
        isLongLead: r.isLongLead,
        linkedWorkItemId: r.linkedWorkItemId,
        taskNo: r.wbsCode || r.outlineNumber || (r.linkedWorkItemId ? `#${r.linkedWorkItemId}` : null),
        taskTitle: r.taskTitle ?? null,
        taskStartDate: r.taskStartDate ?? null,
        taskEndDate: r.taskEndDate ?? null,
      });
    }
    return out;
  }

  /** Work items for a project, for the deliveries task picker. */
  async getWorkItemsForProject(projectId: number): Promise<WorkItemPickRow[]> {
    const rows = await this.dbInstance
      .select({
        id: workItems.id,
        wbsCode: workItems.wbsCode,
        outlineNumber: workItems.outlineNumber,
        title: workItems.title,
        startDate: workItems.startDate,
        endDate: workItems.endDate,
      })
      .from(workItems)
      .where(and(eq(workItems.projectId, projectId), isNull(workItems.deletedAt)));
    const out: WorkItemPickRow[] = [];
    for (const r of rows) {
      out.push({
        id: r.id,
        taskNo: r.wbsCode || r.outlineNumber || `#${r.id}`,
        title: r.title,
        startDate: r.startDate ?? null,
        endDate: r.endDate ?? null,
      });
    }
    return out;
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
