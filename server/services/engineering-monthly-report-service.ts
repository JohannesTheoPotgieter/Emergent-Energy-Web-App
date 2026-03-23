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

const INACTIVE_STATUSES = ["Cancelled", "Archived", "Complete", "Closed", "Handover Complete", "Completed"];
const COMPLETED_STATUSES = ["COMPLETE", "COMPLETED", "DONE"];
const CANCELLED_STATUSES = ["CANCELLED", "CANCELED"];

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
    allStages,
    stageTemplates,
    allApprovals,
    allMetrics,
    allUsers,
  ] = await Promise.all([
    db.select().from(projectInfo).leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id)),
    db.select().from(workItems).where(and(isNull(workItems.deletedAt), eq(workItems.workstream, "Engineering"))),
    db.select().from(deliverables),
    db.select().from(projectEngStages),
    db.select().from(engStageTemplates),
    db.select().from(projectEngApprovals),
    db.select().from(dashboardProjectMetrics),
    db.select({ id: users.id, name: users.name }).from(users),
  ]);

  const projectMap = new Map(allProjectRows.map(r => [r.project_info.id, { ...r.project_info, ...r.project_execution_state, id: r.project_info.id }]));
  const userMap = new Map(allUsers.map(u => [u.id, u.name]));
  const stageTemplateMap = new Map(stageTemplates.map(s => [s.id, s]));

  const activeProjects = [...projectMap.values()].filter(p => {
    if (!p.isActive) return false;
    const phase = (p.phase || "").trim();
    return !INACTIVE_STATUSES.some(s => s.toLowerCase() === phase.toLowerCase());
  });
  const activeProjectIds = new Set(activeProjects.map(p => p.id));

  // Filter engineering work items to active projects
  const engWorkItems = allWorkItemRows.filter(w => activeProjectIds.has(w.projectId));

  // ===== SECTION 1: Engineering KPIs =====
  const totalEngTasks = engWorkItems.length;
  const completedThisMonth = engWorkItems.filter(w => w.completedAt && isTimestampInMonth(w.completedAt, monthStart, monthEnd)).length;
  const totalCompleted = engWorkItems.filter(w => COMPLETED_STATUSES.includes((w.status || "").toUpperCase())).length;

  const activeDeliverables = allDeliverables.filter(d => activeProjectIds.has(d.projectId));

  const kpis = {
    totalEngineeringTasks: totalEngTasks,
    tasksCompletedThisMonth: completedThisMonth,
    completionRate: totalEngTasks > 0 ? (totalCompleted / totalEngTasks) * 100 : 0,
    deliverablesSubmitted: activeDeliverables.filter(d => isTimestampInMonth(d.updatedAt, monthStart, monthEnd) && d.status === "NEEDS APPROVAL").length,
    deliverablesApproved: activeDeliverables.filter(d => isTimestampInMonth(d.updatedAt, monthStart, monthEnd) && (d.status === "QC APPROVED" || d.status === "COMPLETE")).length,
    deliverablesRejected: activeDeliverables.filter(d => isTimestampInMonth(d.updatedAt, monthStart, monthEnd) && d.status === "PROVIDE FEEDBACK").length,
    openBlockers: engWorkItems.filter(w => {
      const status = (w.status || "").toUpperCase();
      return w.endDate && w.endDate < monthEndStr && !COMPLETED_STATUSES.includes(status) && !CANCELLED_STATUSES.includes(status);
    }).length,
  };

  // ===== SECTION 2: Per-project task completion =====
  const tasksByProject = new Map<number, typeof engWorkItems>();
  for (const w of engWorkItems) {
    if (!tasksByProject.has(w.projectId)) tasksByProject.set(w.projectId, []);
    tasksByProject.get(w.projectId)!.push(w);
  }

  const perProjectTasks = activeProjects.map(p => {
    const tasks = tasksByProject.get(p.id) || [];
    const total = tasks.length;
    const completed = tasks.filter(t => COMPLETED_STATUSES.includes((t.status || "").toUpperCase())).length;
    const inProgress = tasks.filter(t => (t.status || "").toUpperCase() === "IN PROGRESS").length;
    const notStarted = tasks.filter(t => {
      const s = (t.status || "").toUpperCase();
      return s === "TO DO" || s === "NOT STARTED";
    }).length;
    const overdue = tasks.filter(t => {
      const status = (t.status || "").toUpperCase();
      return t.endDate && t.endDate < monthEndStr && !COMPLETED_STATUSES.includes(status) && !CANCELLED_STATUSES.includes(status);
    }).length;
    const completedThisMonth = tasks.filter(t => t.completedAt && isTimestampInMonth(t.completedAt, monthStart, monthEnd)).length;

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
  const deliverableRegister = activeDeliverables.map(d => {
    const proj = projectMap.get(d.projectId);
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
      updatedAt: d.updatedAt?.toISOString() || null,
    };
  });

  const deliverableActivity = {
    submittedThisMonth: activeDeliverables.filter(d => isTimestampInMonth(d.updatedAt, monthStart, monthEnd) && d.status === "NEEDS APPROVAL").length,
    approvedThisMonth: activeDeliverables.filter(d => isTimestampInMonth(d.updatedAt, monthStart, monthEnd) && (d.status === "QC APPROVED" || d.status === "COMPLETE")).length,
    rejectedThisMonth: activeDeliverables.filter(d => isTimestampInMonth(d.updatedAt, monthStart, monthEnd) && d.status === "PROVIDE FEEDBACK").length,
    pendingReview: activeDeliverables.filter(d => d.status === "NEEDS APPROVAL").length,
  };

  // ===== SECTION 4: Stage/Gate progress =====
  const activeStages = allStages.filter(s => activeProjectIds.has(s.projectId));

  const stageGateProgress = activeStages.map(s => {
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
    const status = (t.status || "").toUpperCase();
    if (t.endDate && t.endDate < monthEndStr && !COMPLETED_STATUSES.includes(status) && !CANCELLED_STATUSES.includes(status)) r.overdue++;
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
  const activeStageIds = new Set(activeStages.map(s => s.id));
  const activeApprovals = allApprovals.filter(a => activeStageIds.has(a.projectEngStageId));

  const approvalRegister = activeApprovals.map(a => {
    const stage = allStages.find(s => s.id === a.projectEngStageId);
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
      generatedAt: new Date().toISOString(),
      activeProjectCount: activeProjects.length,
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
