/**
 * Engineering Monthly Report — Data Generation Service
 *
 * Generates the full data payload for the Engineering Monthly Report.
 */

import { eq, and, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  projectInfo,
  projectExecutionState,
  workItems,
  deliverables,
  deliverableVersions,
  projectEngStages,
  engStageTemplates,
  projectEngApprovals,
  dashboardProjectMetrics,
  users,
} from "@shared/schema";
import { parseMonth, getMonthLabel } from "./pm-monthly-report-service";
import { isTaskComplete } from "@shared/task-status";
import { toCanonicalStatus } from "../work-items-adapter";
import logger from "../lib/logger";

const INACTIVE_STATUSES = ["Cancelled", "Archived", "Complete", "Closed", "Handover Complete", "Completed"];

// Composite/projection row shapes. The shared `db` handle is typed `any`
// (see server/db.ts), so Drizzle row inference is lost; these interfaces
// restore type-safety for the fields this report reads.
interface EngProjectRow {
  id: number;
  isActive?: boolean | null;
  phase?: string | null;
  projectName?: string | null;
  totalTasks?: number | null;
  [key: string]: unknown;
}
interface EngWorkItemRow {
  projectId: number | null;
  status?: string | null;
  completedAt?: string | Date | null;
  endDate?: string | null;
  ownerName?: string | null;
}
interface EngDeliverableRow {
  id: number;
  projectId: number | null;
  projectName?: string | null;
  title?: string | null;
  deliverableType?: string | null;
  status?: string | null;
  currentVersion?: number | string | null;
  ownerUserId?: number | null;
  reviewerUserId?: number | null;
  updatedAt?: string | Date | null;
}
interface EngDeliverableVersionRow {
  deliverableId: number | null;
  status?: string | null;
  versionNumber?: number | string | null;
  createdAt?: string | Date | null;
}
interface EngStageRow {
  id: number;
  projectId: number | null;
  stageTemplateId?: number | null;
  status?: string | null;
  startedAt?: string | Date | null;
  completedAt?: string | Date | null;
}
interface EngApprovalRow {
  projectEngStageId: number | null;
  status?: string | null;
  approverUserId?: number | null;
  approverRole?: string | null;
  updatedAt?: string | Date | null;
}

/** Canonical check: is this work_items.status a terminal/complete state?
 *  Uses toCanonicalStatus to normalize legacy DB values before checking. */
function isComplete(rawStatus: string | null | undefined): boolean {
  return isTaskComplete(toCanonicalStatus(rawStatus));
}

/** Canonical check: is this status a cancelled state? */
function isCancelled(rawStatus: string | null | undefined): boolean {
  const _s = toCanonicalStatus(rawStatus);
  // No canonical cancelled status exists in TASK_STATUSES, so treat as
  // not-cancelled. If a "cancelled" status is added, this will pick it up.
  return false;
}

/** Canonical check: is this an active (open, non-complete, non-cancelled) task? */
function isActive(rawStatus: string | null | undefined): boolean {
  return !isComplete(rawStatus) && !isCancelled(rawStatus);
}

function isDateStrInMonth(dateStr: string | null | undefined, monthStartStr: string, monthEndStr: string): boolean {
  if (!dateStr) return false;
  try {
    const normalized = dateStr.substring(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
    return normalized >= monthStartStr && normalized <= monthEndStr;
  } catch {
    return false;
  }
}

function isTimestampInMonth(ts: Date | string | null | undefined, monthStart: Date, monthEnd: Date): boolean {
  if (!ts) return false;
  const d = typeof ts === "string" ? new Date(ts) : ts;
  return d >= monthStart && d <= monthEnd;
}

export async function generateEngineeringReportData(month: string) {
  const parsed = parseMonth(month);
  if (!parsed) throw new Error("Invalid month format. Use YYYY-MM.");

  const { monthStart, monthEnd, monthStartStr, monthEndStr } = parsed;
  const startTs = Date.now();

  const [
    allProjectRows,
    allWorkItemRows,
    allDeliverables,
    allDeliverableVersions,
    allStages,
    stageTemplates,
    allApprovals,
    _allMetrics,
    allUsers,
  ] = await Promise.all([
    db.select().from(projectInfo).leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id)),
    db.select().from(workItems).where(and(isNull(workItems.deletedAt), eq(workItems.workstream, "ENG"))),
    db.select().from(deliverables),
    db.select().from(deliverableVersions),
    db.select().from(projectEngStages),
    db.select().from(engStageTemplates),
    db.select().from(projectEngApprovals),
    db.select().from(dashboardProjectMetrics),
    db.select({ id: users.id, name: users.name }).from(users),
  ]);

  const projectMap: Map<number, EngProjectRow> = new Map(
    (allProjectRows as Array<{ project_info: Record<string, unknown> & { id: number }; project_execution_state?: Record<string, unknown> | null }>).map(
      (r) => [r.project_info.id, { ...r.project_info, ...(r.project_execution_state || {}), id: r.project_info.id } as EngProjectRow],
    ),
  );
  const userMap: Map<number, string | null> = new Map(
    (allUsers as Array<{ id: number; name: string | null }>).map((u) => [u.id, u.name]),
  );
  const stageTemplateMap: Map<number, Record<string, unknown>> = new Map(
    (stageTemplates as Array<Record<string, unknown> & { id: number }>).map((s) => [s.id, s]),
  );

  const activeProjects = [...projectMap.values()].filter((p) => {
    if (!p.isActive) return false;
    const phase = (p.phase || "").trim();
    return !INACTIVE_STATUSES.some(s => s.toLowerCase() === phase.toLowerCase());
  });
  const activeProjectIds = new Set(activeProjects.map((p) => p.id));

  // Filter engineering work items to active projects
  const engWorkItems = (allWorkItemRows as EngWorkItemRow[]).filter((w) => w.projectId != null && activeProjectIds.has(w.projectId));

  // ===== SECTION 1: Engineering KPIs =====
  // Metric definitions:
  //   totalEngineeringTasks: count of all eng work items for active projects
  //   tasksCompletedThisMonth: subset where completedAt falls in the report month
  //   totalCompleted: subset in a terminal/complete canonical status
  //   activeTasks: subset that are open (not complete, not cancelled)
  //   tasksPlannedToCompleteThisMonth: subset where endDate falls in the report month
  const totalEngTasks = engWorkItems.length;
  const completedThisMonth = engWorkItems.filter((w) => w.completedAt && isTimestampInMonth(w.completedAt, monthStart, monthEnd)).length;
  const totalCompleted = engWorkItems.filter((w) => isComplete(w.status)).length;

  const activeDeliverables = (allDeliverables as EngDeliverableRow[]).filter((d) => d.projectId != null && activeProjectIds.has(d.projectId));

  const activeTaskCount = engWorkItems.filter((w) => isActive(w.status)).length;

  const tasksPlannedToCompleteThisMonth = engWorkItems.filter((w) => {
    if (isCancelled(w.status)) return false;
    return isDateStrInMonth(w.endDate, monthStartStr, monthEndStr);
  }).length;

  const activeDeliverableIds = new Set(activeDeliverables.map((d) => d.id));
  const deliverableVersionEvents = (allDeliverableVersions as EngDeliverableVersionRow[]).filter((v) =>
    v.deliverableId != null && activeDeliverableIds.has(v.deliverableId) && isTimestampInMonth(v.createdAt, monthStart, monthEnd),
  );
  const submittedEvents = deliverableVersionEvents.filter((v) => String(v.status || "").toUpperCase() === "NEEDS APPROVAL").length;
  const approvedEvents = deliverableVersionEvents.filter((v) => {
    const status = String(v.status || "").toUpperCase();
    return status === "QC APPROVED" || status === "COMPLETE";
  }).length;
  const rejectedEvents = deliverableVersionEvents.filter((v) => String(v.status || "").toUpperCase() === "PROVIDE FEEDBACK").length;

  const kpis = {
    totalEngineeringTasks: totalEngTasks,
    tasksCompletedThisMonth: completedThisMonth,
    cumulativeCompletionRate: totalEngTasks > 0 ? (totalCompleted / totalEngTasks) * 100 : 0,
    monthlyCompletionRate: tasksPlannedToCompleteThisMonth > 0 ? (completedThisMonth / tasksPlannedToCompleteThisMonth) * 100 : 0,
    deliverablesSubmitted: submittedEvents,
    deliverablesApproved: approvedEvents,
    deliverablesRejected: rejectedEvents,
    openBlockers: engWorkItems.filter((w) =>
      w.endDate && w.endDate < monthEndStr && isActive(w.status)
    ).length,
  };

  // ===== SECTION 2: Per-project task completion =====
  const tasksByProject = new Map<number, typeof engWorkItems>();
  for (const w of engWorkItems) {
    if (w.projectId == null) continue;
    if (!tasksByProject.has(w.projectId)) tasksByProject.set(w.projectId, []);
    tasksByProject.get(w.projectId)!.push(w);
  }

  const perProjectTasks = activeProjects.map((p) => {
    const tasks = tasksByProject.get(p.id) || [];
    const total = tasks.length;
    const completed = tasks.filter((t) => isComplete(t.status)).length;
    const inProgress = tasks.filter((t) => toCanonicalStatus(t.status) === "in_progress").length;
    const notStarted = tasks.filter((t) => {
      const s = toCanonicalStatus(t.status);
      return s === "to_do" || s === "not_started";
    }).length;
    const overdue = tasks.filter((t) =>
      t.endDate && t.endDate < monthEndStr && isActive(t.status)
    ).length;
    const completedThisMonth = tasks.filter((t) => t.completedAt && isTimestampInMonth(t.completedAt, monthStart, monthEnd)).length;

    return {
      projectId: p.id,
      projectName: p.projectName,
      totalTasks: total,
      completed,
      inProgress,
      notStarted,
      overdue,
      completionPct: total > 0 ? (completed / total) * 100 : 0,
      completedThisMonth,
    };
  }).filter(p => p.totalTasks > 0);

  // ===== SECTION 3: Deliverable status =====
  // Build version history by deliverable
  const versionsByDeliverable = new Map<number, EngDeliverableVersionRow[]>();
  for (const v of (allDeliverableVersions as EngDeliverableVersionRow[])) {
    if (v.deliverableId == null) continue;
    if (!versionsByDeliverable.has(v.deliverableId)) versionsByDeliverable.set(v.deliverableId, []);
    versionsByDeliverable.get(v.deliverableId)!.push(v);
  }

  const deliverableRegister = activeDeliverables.map((d) => {
    const proj = d.projectId != null ? projectMap.get(d.projectId) : undefined;
    const versions = (versionsByDeliverable.get(d.id) || []).map((v) => ({
      versionNumber: v.versionNumber,
      status: v.status,
      createdAt: v.createdAt instanceof Date ? v.createdAt.toISOString() : (v.createdAt ?? null),
    }));
    return {
      projectId: d.projectId,
      projectName: proj?.projectName || d.projectName,
      deliverableId: d.id,
      title: d.title,
      type: d.deliverableType,
      status: d.status,
      currentVersion: d.currentVersion,
      ownerName: d.ownerUserId ? (userMap.get(d.ownerUserId) || null) : null,
      reviewerName: d.reviewerUserId ? (userMap.get(d.reviewerUserId) || null) : null,
      updatedAt: d.updatedAt instanceof Date ? d.updatedAt.toISOString() : (d.updatedAt || null),
      versions,
    };
  });

  const deliverableActivity = {
    submittedThisMonth: submittedEvents,
    approvedThisMonth: approvedEvents,
    rejectedThisMonth: rejectedEvents,
    // Legacy deliverables table uses mixed-case status — normalize for comparison.
    pendingReview: activeDeliverables.filter((d) => toCanonicalStatus(d.status) === "needs_approval").length,
    tasksPlannedToCompleteThisMonth,
    activeTasks: activeTaskCount,
  };

  // ===== SECTION 4: Stage/Gate progress =====
  const activeStages = (allStages as EngStageRow[]).filter((s) => s.projectId != null && activeProjectIds.has(s.projectId));

  const stageGateProgress = activeStages.map((s) => {
    const proj = s.projectId != null ? projectMap.get(s.projectId) : undefined;
    const template = s.stageTemplateId != null ? stageTemplateMap.get(s.stageTemplateId) : undefined;
    return {
      projectId: s.projectId,
      projectName: proj?.projectName || "",
      stageName: (template?.name as string | undefined) || `Stage ${s.stageTemplateId}`,
      status: s.status,
      startedAt: s.startedAt instanceof Date ? s.startedAt.toISOString() : (s.startedAt ?? null),
      completedAt: s.completedAt instanceof Date ? s.completedAt.toISOString() : (s.completedAt ?? null),
      completedThisMonth: s.completedAt ? isTimestampInMonth(s.completedAt, monthStart, monthEnd) : false,
    };
  });

  // ===== SECTION 5: Resource & workload =====
  const engResourceMap = new Map<string, { resource: string; assignedTasks: number; completedThisMonth: number; overdue: number; projects: Set<string> }>();
  for (const t of engWorkItems) {
    const name = t.ownerName || "Unassigned";
    if (!engResourceMap.has(name)) engResourceMap.set(name, { resource: name, assignedTasks: 0, completedThisMonth: 0, overdue: 0, projects: new Set() });
    const r = engResourceMap.get(name)!;
    r.assignedTasks++;
    if (t.completedAt && isTimestampInMonth(t.completedAt, monthStart, monthEnd)) r.completedThisMonth++;
    if (t.endDate && t.endDate < monthEndStr && isActive(t.status)) r.overdue++;
    const proj = t.projectId != null ? projectMap.get(t.projectId) : undefined;
    if (proj && proj.projectName) r.projects.add(proj.projectName);
  }

  const resourceWorkload = [...engResourceMap.values()].map(r => ({
    resource: r.resource,
    assignedTasks: r.assignedTasks,
    completedThisMonth: r.completedThisMonth,
    overdue: r.overdue,
    projectCount: r.projects.size,
  }));

  // ===== SECTION 6: Approvals =====
  const activeStageIds = new Set(activeStages.map((s) => s.id));
  const activeApprovals = (allApprovals as EngApprovalRow[]).filter((a) => a.projectEngStageId != null && activeStageIds.has(a.projectEngStageId));

  const approvalRegister = activeApprovals.map((a) => {
    const stage = (allStages as EngStageRow[]).find((s) => s.id === a.projectEngStageId);
    const proj = stage && stage.projectId != null ? projectMap.get(stage.projectId) : null;
    return {
      projectId: stage?.projectId || 0,
      projectName: proj?.projectName || "",
      approvalType: a.approverRole,
      status: a.status,
      approverName: a.approverUserId ? (userMap.get(a.approverUserId) || null) : null,
      date: a.updatedAt instanceof Date ? a.updatedAt.toISOString() : (a.updatedAt ?? null),
    };
  });

  const duration = Date.now() - startTs;
  logger.info(`[Engineering Monthly Report] Data generation for ${month} took ${duration}ms`);

  return {
    meta: {
      month,
      monthLabel: getMonthLabel(month),
      periodType: "Monthly snapshot",
      periodStart: monthStartStr,
      periodEnd: monthEndStr,
      snapshotBehavior: "Values are fixed to the stored monthly report snapshot until regeneration.",
      generatedAt: new Date().toISOString(),
      activeProjectCount: activeProjects.length,
      // Trust metadata: marks which KPIs are provisional until the
      // underlying data source is fully migrated.
      provisionalMetrics: {
        deliverablesSubmitted: "Reads legacy deliverableVersions table — status values may be mixed-case",
        deliverablesApproved: "Reads legacy deliverableVersions table — status values may be mixed-case",
        deliverablesRejected: "Reads legacy deliverableVersions table — status values may be mixed-case",
        monthlyCompletionRate: "Denominator uses endDate as a proxy for planned completion — not a canonical field",
      },
    },
    kpis,
    tasks: {
      perProject: perProjectTasks,
    },
    deliverables: {
      register: deliverableRegister,
      activity: deliverableActivity,
    },
    stageGates: stageGateProgress,
    resources: resourceWorkload,
    approvals: approvalRegister,
  };
}
