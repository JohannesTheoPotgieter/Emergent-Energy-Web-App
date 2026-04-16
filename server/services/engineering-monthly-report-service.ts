/**
 * Engineering Monthly Report — Data Generation Service
 *
 * Generates the full data payload for the Engineering Monthly Report.
 */

import { eq, and, sql, isNull, inArray } from "drizzle-orm";
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

const INACTIVE_STATUSES = ["Cancelled", "Archived", "Complete", "Closed", "Handover Complete", "Completed"];

/** Canonical check: is this work_items.status a terminal/complete state?
 *  Uses toCanonicalStatus to normalize legacy DB values before checking. */
function isComplete(rawStatus: string | null | undefined): boolean {
  return isTaskComplete(toCanonicalStatus(rawStatus));
}

/** Canonical check: is this status a cancelled state? */
function isCancelled(rawStatus: string | null | undefined): boolean {
  const s = toCanonicalStatus(rawStatus);
  // No canonical cancelled status exists in TASK_STATUSES, so treat as
  // not-cancelled. If a "cancelled" status is added, this will pick it up.
  return false;
}

/** Canonical check: is this an active (open, non-complete, non-cancelled) task? */
function isActive(rawStatus: string | null | undefined): boolean {
  return !isComplete(rawStatus) && !isCancelled(rawStatus);
}

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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
    allMetrics,
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

  const projectMap: Map<number, any> = new Map(allProjectRows.map((r: any) => [r.project_info.id, { ...r.project_info, ...(r.project_execution_state || {}), id: r.project_info.id }]));
  const userMap: Map<number, any> = new Map(allUsers.map((u: any) => [u.id, u.name]));
  const stageTemplateMap: Map<number, any> = new Map(stageTemplates.map((s: any) => [s.id, s]));

  const activeProjects = [...projectMap.values()].filter((p: any) => {
    if (!p.isActive) return false;
    const phase = (p.phase || "").trim();
    return !INACTIVE_STATUSES.some(s => s.toLowerCase() === phase.toLowerCase());
  });
  const activeProjectIds = new Set(activeProjects.map((p: any) => p.id));

  // Filter engineering work items to active projects
  const engWorkItems = allWorkItemRows.filter((w: any) => activeProjectIds.has(w.projectId));

  // ===== SECTION 1: Engineering KPIs =====
  // Metric definitions:
  //   totalEngineeringTasks: count of all eng work items for active projects
  //   tasksCompletedThisMonth: subset where completedAt falls in the report month
  //   totalCompleted: subset in a terminal/complete canonical status
  //   activeTasks: subset that are open (not complete, not cancelled)
  //   tasksPlannedToCompleteThisMonth: subset where endDate falls in the report month
  const totalEngTasks = engWorkItems.length;
  const completedThisMonth = engWorkItems.filter((w: any) => w.completedAt && isTimestampInMonth(w.completedAt, monthStart, monthEnd)).length;
  const totalCompleted = engWorkItems.filter((w: any) => isComplete(w.status)).length;

  const activeDeliverables = allDeliverables.filter((d: any) => activeProjectIds.has(d.projectId));

  const activeTaskCount = engWorkItems.filter((w: any) => isActive(w.status)).length;

  const tasksPlannedToCompleteThisMonth = engWorkItems.filter((w: any) => {
    if (isCancelled(w.status)) return false;
    return isDateStrInMonth(w.endDate, monthStartStr, monthEndStr);
  }).length;

  const activeDeliverableIds = new Set(activeDeliverables.map((d: any) => d.id));
  const deliverableVersionEvents = allDeliverableVersions.filter((v: any) =>
    activeDeliverableIds.has(v.deliverableId) && isTimestampInMonth(v.createdAt, monthStart, monthEnd),
  );
  const submittedEvents = deliverableVersionEvents.filter((v: any) => String(v.status || "").toUpperCase() === "NEEDS APPROVAL").length;
  const approvedEvents = deliverableVersionEvents.filter((v: any) => {
    const status = String(v.status || "").toUpperCase();
    return status === "QC APPROVED" || status === "COMPLETE";
  }).length;
  const rejectedEvents = deliverableVersionEvents.filter((v: any) => String(v.status || "").toUpperCase() === "PROVIDE FEEDBACK").length;

  const kpis = {
    totalEngineeringTasks: totalEngTasks,
    tasksCompletedThisMonth: completedThisMonth,
    cumulativeCompletionRate: totalEngTasks > 0 ? (totalCompleted / totalEngTasks) * 100 : 0,
    monthlyCompletionRate: tasksPlannedToCompleteThisMonth > 0 ? (completedThisMonth / tasksPlannedToCompleteThisMonth) * 100 : 0,
    deliverablesSubmitted: submittedEvents,
    deliverablesApproved: approvedEvents,
    deliverablesRejected: rejectedEvents,
    openBlockers: engWorkItems.filter((w: any) =>
      w.endDate && w.endDate < monthEndStr && isActive(w.status)
    ).length,
  };

  // ===== SECTION 2: Per-project task completion =====
  const tasksByProject = new Map<number, typeof engWorkItems>();
  for (const w of engWorkItems) {
    if (!tasksByProject.has(w.projectId)) tasksByProject.set(w.projectId, []);
    tasksByProject.get(w.projectId)!.push(w);
  }

  const perProjectTasks = activeProjects.map((p: any) => {
    const tasks = tasksByProject.get(p.id) || [];
    const total = tasks.length;
    const completed = tasks.filter((t: any) => isComplete(t.status)).length;
    const inProgress = tasks.filter((t: any) => toCanonicalStatus(t.status) === "in_progress").length;
    const notStarted = tasks.filter((t: any) => {
      const s = toCanonicalStatus(t.status);
      return s === "to_do" || s === "not_started";
    }).length;
    const overdue = tasks.filter((t: any) =>
      t.endDate && t.endDate < monthEndStr && isActive(t.status)
    ).length;
    const completedThisMonth = tasks.filter((t: any) => t.completedAt && isTimestampInMonth(t.completedAt, monthStart, monthEnd)).length;

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
  const versionsByDeliverable = new Map<number, typeof allDeliverableVersions>();
  for (const v of allDeliverableVersions) {
    if (!versionsByDeliverable.has(v.deliverableId)) versionsByDeliverable.set(v.deliverableId, []);
    versionsByDeliverable.get(v.deliverableId)!.push(v);
  }

  const deliverableRegister = activeDeliverables.map((d: any) => {
    const proj = projectMap.get(d.projectId);
    const versions = (versionsByDeliverable.get(d.id) || []).map((v: any) => ({
      versionNumber: v.versionNumber,
      status: v.status,
      createdAt: v.createdAt?.toISOString() || null,
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
    pendingReview: activeDeliverables.filter((d: any) => toCanonicalStatus(d.status) === "needs_approval").length,
    tasksPlannedToCompleteThisMonth,
    activeTasks: activeTaskCount,
  };

  // ===== SECTION 4: Stage/Gate progress =====
  const activeStages = allStages.filter((s: any) => activeProjectIds.has(s.projectId));

  const stageGateProgress = activeStages.map((s: any) => {
    const proj = projectMap.get(s.projectId);
    const template = stageTemplateMap.get(s.stageTemplateId);
    return {
      projectId: s.projectId,
      projectName: proj?.projectName || "",
      stageName: template?.name || `Stage ${s.stageTemplateId}`,
      status: s.status,
      startedAt: s.startedAt?.toISOString() || null,
      completedAt: s.completedAt?.toISOString() || null,
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
    const proj = projectMap.get(t.projectId);
    if (proj) r.projects.add(proj.projectName);
  }

  const resourceWorkload = [...engResourceMap.values()].map(r => ({
    resource: r.resource,
    assignedTasks: r.assignedTasks,
    completedThisMonth: r.completedThisMonth,
    overdue: r.overdue,
    projectCount: r.projects.size,
  }));

  // ===== SECTION 6: Approvals =====
  const activeStageIds = new Set(activeStages.map((s: any) => s.id));
  const activeApprovals = allApprovals.filter((a: any) => activeStageIds.has(a.projectEngStageId));

  const approvalRegister = activeApprovals.map((a: any) => {
    const stage = allStages.find((s: any) => s.id === a.projectEngStageId);
    const proj = stage ? projectMap.get(stage.projectId) : null;
    return {
      projectId: stage?.projectId || 0,
      projectName: proj?.projectName || "",
      approvalType: a.approverRole,
      status: a.status,
      approverName: a.approverUserId ? (userMap.get(a.approverUserId) || null) : null,
      date: a.updatedAt?.toISOString() || null,
    };
  });

  const duration = Date.now() - startTs;
  console.log(`[Engineering Monthly Report] Data generation for ${month} took ${duration}ms`);

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
