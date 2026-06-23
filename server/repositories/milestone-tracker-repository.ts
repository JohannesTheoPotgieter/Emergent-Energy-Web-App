// ============================================================
// Milestone Tracker repository
//
// READS the canonical finance + plan surfaces (normalized_revenue_lines =
// payment milestones / inflows, normalized_cost_lines = expenditure / outflows,
// work_items = plan tasks) and READS/WRITES the two augmentation link tables
// (revenue_milestone_task_links, task_cost_line_links).
//
// HARD: the finance line tables are READ-ONLY here and are temporal SNAPSHOTS —
// every read filters effective_to IS NULL AND deleted_at IS NULL so only the
// live row participates. Links reference the STABLE (project_id, row_hash)
// identity, never the serial id (which changes on every re-import).
// ============================================================

import { and, eq, inArray, isNull, isNotNull } from "drizzle-orm";
import { db } from "../db";
import {
  normalizedRevenueLines,
  normalizedCostLines,
  workItems,
  workItemDependencies,
  revenueMilestoneTaskLinks,
  taskCostLineLinks,
} from "@shared/schema";

export interface RevenueMilestoneRow {
  projectId: number;
  rowHash: string;
  milestoneNo: string | null;
  milestoneName: string | null;
  milestonePercent: string | null;
  amountExVat: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  expectedPaymentDate: string | null;
  paidDate: string | null;
  /** Font colour of the "Payment Received Date" cell: true = black (confirmed /
   *  actual receipt), false = red (forecast), null = unknown. */
  paidDateConfirmed: boolean | null;
  inBankDate: string | null;
  status: string;
  milestoneNotes: string | null;
}

export interface CostLineRow {
  projectId: number;
  rowHash: string;
  costCategory: string | null;
  counterpartyName: string | null;
  description: string | null;
  amountExVat: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  approvedDate: string | null;
  paidDate: string | null;
  forecastPaymentDate: string | null;
  poNumber: string | null;
  status: string;
}

export interface MtPlanTaskRow {
  id: number;
  projectId: number;
  taskNo: string | null;
  title: string;
  workstream: string | null;
  phase: string | null;
  startDate: string | null;
  endDate: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  percentComplete: number | null;
  isMilestone: boolean;
}

export interface RmTaskLinkRow {
  id: number;
  projectId: number;
  revenueRowHash: string;
  workItemId: number;
}

export interface TaskCostLinkRow {
  id: number;
  projectId: number;
  workItemId: number;
  costRowHash: string;
}

export interface TaskDependencyRow {
  id: number;
  predecessorId: number;
  successorId: number;
  /** "SMART_IMPORT" = derived from the workbook (read-only here); "MANUAL" =
   *  created in Activity Planning (editable, never touched by re-import). */
  source: string;
}

export class MilestoneTrackerRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  // ── Canonical reads (live snapshot rows only) ──

  /** Revenue (payment) milestones with a stable row_hash, for a set of projects. */
  async getRevenueMilestonesForProjects(projectIds: number[]): Promise<RevenueMilestoneRow[]> {
    if (projectIds.length === 0) return [];
    return this.dbInstance
      .select({
        projectId: normalizedRevenueLines.projectId,
        rowHash: normalizedRevenueLines.rowHash,
        milestoneNo: normalizedRevenueLines.milestoneNo,
        milestoneName: normalizedRevenueLines.milestoneName,
        milestonePercent: normalizedRevenueLines.milestonePercent,
        amountExVat: normalizedRevenueLines.amountExVat,
        invoiceNumber: normalizedRevenueLines.invoiceNumber,
        invoiceDate: normalizedRevenueLines.invoiceDate,
        expectedPaymentDate: normalizedRevenueLines.expectedPaymentDate,
        paidDate: normalizedRevenueLines.paidDate,
        paidDateConfirmed: normalizedRevenueLines.paidDateConfirmed,
        inBankDate: normalizedRevenueLines.inBankDate,
        status: normalizedRevenueLines.status,
        milestoneNotes: normalizedRevenueLines.milestoneNotes,
      })
      .from(normalizedRevenueLines)
      .where(
        and(
          inArray(normalizedRevenueLines.projectId, projectIds),
          isNull(normalizedRevenueLines.effectiveTo),
          isNull(normalizedRevenueLines.deletedAt),
          isNotNull(normalizedRevenueLines.rowHash),
        ),
      ) as Promise<RevenueMilestoneRow[]>;
  }

  /** Expenditure-breakdown cost lines (outflows) with a stable row_hash. */
  async getCostLinesForProjects(projectIds: number[]): Promise<CostLineRow[]> {
    if (projectIds.length === 0) return [];
    return this.dbInstance
      .select({
        projectId: normalizedCostLines.projectId,
        rowHash: normalizedCostLines.rowHash,
        costCategory: normalizedCostLines.costCategory,
        counterpartyName: normalizedCostLines.counterpartyName,
        description: normalizedCostLines.description,
        amountExVat: normalizedCostLines.amountExVat,
        invoiceNumber: normalizedCostLines.invoiceNumber,
        invoiceDate: normalizedCostLines.invoiceDate,
        approvedDate: normalizedCostLines.approvedDate,
        paidDate: normalizedCostLines.paidDate,
        forecastPaymentDate: normalizedCostLines.forecastPaymentDate,
        poNumber: normalizedCostLines.poNumber,
        status: normalizedCostLines.status,
      })
      .from(normalizedCostLines)
      .where(
        and(
          inArray(normalizedCostLines.projectId, projectIds),
          isNull(normalizedCostLines.effectiveTo),
          isNull(normalizedCostLines.deletedAt),
          isNotNull(normalizedCostLines.rowHash),
        ),
      ) as Promise<CostLineRow[]>;
  }

  /** Plan tasks (work_items) for a set of projects. */
  async getPlanTasksForProjects(projectIds: number[]): Promise<MtPlanTaskRow[]> {
    if (projectIds.length === 0) return [];
    const rows = await this.dbInstance
      .select({
        id: workItems.id,
        projectId: workItems.projectId,
        wbsCode: workItems.wbsCode,
        outlineNumber: workItems.outlineNumber,
        title: workItems.title,
        workstream: workItems.workstream,
        phase: workItems.phase,
        startDate: workItems.startDate,
        endDate: workItems.endDate,
        actualStart: workItems.actualStart,
        actualEnd: workItems.actualEnd,
        percentComplete: workItems.percentComplete,
        isMilestone: workItems.isMilestone,
      })
      .from(workItems)
      .where(and(inArray(workItems.projectId, projectIds), isNull(workItems.deletedAt)));
    const out: MtPlanTaskRow[] = [];
    for (const r of rows) {
      if (r.projectId == null) continue;
      out.push({
        id: r.id,
        projectId: r.projectId,
        taskNo: r.wbsCode || r.outlineNumber || `#${r.id}`,
        title: r.title,
        workstream: r.workstream ?? null,
        phase: r.phase ?? null,
        startDate: r.startDate ?? null,
        endDate: r.endDate ?? null,
        actualStart: r.actualStart ?? null,
        actualEnd: r.actualEnd ?? null,
        percentComplete: r.percentComplete ?? null,
        isMilestone: Boolean(r.isMilestone),
      });
    }
    return out;
  }

  // ── Link reads ──

  async getMilestoneTaskLinksForProjects(projectIds: number[]): Promise<RmTaskLinkRow[]> {
    if (projectIds.length === 0) return [];
    return this.dbInstance
      .select({
        id: revenueMilestoneTaskLinks.id,
        projectId: revenueMilestoneTaskLinks.projectId,
        revenueRowHash: revenueMilestoneTaskLinks.revenueRowHash,
        workItemId: revenueMilestoneTaskLinks.workItemId,
      })
      .from(revenueMilestoneTaskLinks)
      .where(inArray(revenueMilestoneTaskLinks.projectId, projectIds)) as Promise<RmTaskLinkRow[]>;
  }

  async getTaskCostLinksForProjects(projectIds: number[]): Promise<TaskCostLinkRow[]> {
    if (projectIds.length === 0) return [];
    return this.dbInstance
      .select({
        id: taskCostLineLinks.id,
        projectId: taskCostLineLinks.projectId,
        workItemId: taskCostLineLinks.workItemId,
        costRowHash: taskCostLineLinks.costRowHash,
      })
      .from(taskCostLineLinks)
      .where(inArray(taskCostLineLinks.projectId, projectIds)) as Promise<TaskCostLinkRow[]>;
  }

  // ── Task dependencies (reuse work_item_dependencies; MANUAL = Activity-Planning-owned) ──

  /** Active dependency edges whose successor is one of the given work items —
   *  i.e. every intra-project edge (both SMART_IMPORT and MANUAL). */
  async getDependenciesByWorkItemIds(workItemIds: number[]): Promise<TaskDependencyRow[]> {
    if (workItemIds.length === 0) return [];
    return this.dbInstance
      .select({
        id: workItemDependencies.id,
        predecessorId: workItemDependencies.predecessorId,
        successorId: workItemDependencies.successorId,
        source: workItemDependencies.source,
      })
      .from(workItemDependencies)
      .where(and(
        inArray(workItemDependencies.successorId, workItemIds),
        isNull(workItemDependencies.deletedAt),
      )) as Promise<TaskDependencyRow[]>;
  }

  /** Add a MANUAL (Activity-Planning) dependency. Idempotent: skips if any active
   *  edge already exists for the same pair (so it never duplicates an imported one). */
  async addManualDependency(input: { predecessorId: number; successorId: number; createdBy: number | null }): Promise<void> {
    const [existing] = await this.dbInstance
      .select({ id: workItemDependencies.id })
      .from(workItemDependencies)
      .where(and(
        eq(workItemDependencies.predecessorId, input.predecessorId),
        eq(workItemDependencies.successorId, input.successorId),
        isNull(workItemDependencies.deletedAt),
      ))
      .limit(1);
    if (existing) return;
    await this.dbInstance.insert(workItemDependencies).values({
      predecessorId: input.predecessorId,
      successorId: input.successorId,
      depType: "FS",
      lagDays: 0,
      source: "MANUAL",
    });
  }

  /** Remove a dependency — only MANUAL edges can be deleted here (imported edges
   *  are owned by the workbook). */
  async removeManualDependency(input: { predecessorId: number; successorId: number }): Promise<void> {
    await this.dbInstance
      .delete(workItemDependencies)
      .where(and(
        eq(workItemDependencies.predecessorId, input.predecessorId),
        eq(workItemDependencies.successorId, input.successorId),
        eq(workItemDependencies.source, "MANUAL"),
      ));
  }

  // ── Validation helpers (links must point at live rows in the same project) ──

  async revenueRowExists(projectId: number, rowHash: string): Promise<boolean> {
    const [row] = await this.dbInstance
      .select({ rowHash: normalizedRevenueLines.rowHash })
      .from(normalizedRevenueLines)
      .where(
        and(
          eq(normalizedRevenueLines.projectId, projectId),
          eq(normalizedRevenueLines.rowHash, rowHash),
          isNull(normalizedRevenueLines.effectiveTo),
          isNull(normalizedRevenueLines.deletedAt),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async costRowExists(projectId: number, rowHash: string): Promise<boolean> {
    const [row] = await this.dbInstance
      .select({ rowHash: normalizedCostLines.rowHash })
      .from(normalizedCostLines)
      .where(
        and(
          eq(normalizedCostLines.projectId, projectId),
          eq(normalizedCostLines.rowHash, rowHash),
          isNull(normalizedCostLines.effectiveTo),
          isNull(normalizedCostLines.deletedAt),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async taskBelongsToProject(projectId: number, workItemId: number): Promise<boolean> {
    const [row] = await this.dbInstance
      .select({ id: workItems.id })
      .from(workItems)
      .where(and(eq(workItems.id, workItemId), eq(workItems.projectId, projectId), isNull(workItems.deletedAt)))
      .limit(1);
    return Boolean(row);
  }

  // ── Link writes (idempotent via the unique indexes) ──

  async addMilestoneTaskLink(input: { projectId: number; revenueRowHash: string; workItemId: number; createdBy: number | null }): Promise<void> {
    await this.dbInstance
      .insert(revenueMilestoneTaskLinks)
      .values(input)
      .onConflictDoNothing();
  }

  async removeMilestoneTaskLink(input: { projectId: number; revenueRowHash: string; workItemId: number }): Promise<void> {
    await this.dbInstance
      .delete(revenueMilestoneTaskLinks)
      .where(
        and(
          eq(revenueMilestoneTaskLinks.projectId, input.projectId),
          eq(revenueMilestoneTaskLinks.revenueRowHash, input.revenueRowHash),
          eq(revenueMilestoneTaskLinks.workItemId, input.workItemId),
        ),
      );
  }

  async addTaskCostLink(input: { projectId: number; workItemId: number; costRowHash: string; createdBy: number | null }): Promise<void> {
    await this.dbInstance
      .insert(taskCostLineLinks)
      .values(input)
      .onConflictDoNothing();
  }

  async removeTaskCostLink(input: { projectId: number; workItemId: number; costRowHash: string }): Promise<void> {
    await this.dbInstance
      .delete(taskCostLineLinks)
      .where(
        and(
          eq(taskCostLineLinks.projectId, input.projectId),
          eq(taskCostLineLinks.workItemId, input.workItemId),
          eq(taskCostLineLinks.costRowHash, input.costRowHash),
        ),
      );
  }
}

export const milestoneTrackerRepository = new MilestoneTrackerRepository();
